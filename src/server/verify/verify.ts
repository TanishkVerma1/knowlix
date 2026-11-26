import "server-only";
import type { CheckStep, CslItem, FlagInfo, ParsedReference, ReasonCode, RecordSource, VerificationResult } from "@/shared/types";
import { doiUrl, isPreprintDoi, normalizeDoi } from "@/shared/identifiers";
import { doiCsl, doiExists } from "../scholarly/doi";
import { crossrefBibliographic, crossrefToCsl, crossrefUpdates, crossrefWork, type UpdateNotice } from "../scholarly/crossref";
import { openAlexByDoi, openAlexTitleSearch, openAlexToCsl, type OpenAlexWork } from "../scholarly/openalex";
import { openLibraryIsbn, openLibrarySearch } from "../scholarly/openlibrary";
import { googleBooksAvailable, googleBooksIsbn, googleBooksSearch } from "../scholarly/googlebooks";
import { cslYear } from "../scholarly/csl";
import { fetchPageMeta, pageToCsl } from "../scholarly/webpage";
import { norm, titleSimilarity } from "../text/similarity";
import { CHECK_AT, VERIFIED_AT, candidateTitle, isDifferentPaper, scoreCandidate, type MatchScore } from "./match";

/**
 * Lock 1 — the reference check. Plain code, no AI.
 *  1. doi.org: does the DOI exist in ANY registry?
 *  2. Metadata: Crossref, else doi.org content negotiation (DataCite, arXiv, Zenodo…)
 *  3. Field-by-field comparison → score
 *  4. Second opinion (OpenAlex), retraction notices, preprint detection
 * No DOI → Crossref's citation parser + OpenAlex title search (+ Open Library and Google Books for books).
 */

const SOURCE_LABEL: Record<RecordSource, string> = {
  crossref: "Crossref",
  datacite: "DataCite (via doi.org)",
  "doi.org": "doi.org",
  openalex: "OpenAlex",
  openlibrary: "Open Library",
  googlebooks: "Google Books",
  arxiv: "arXiv",
};

class Timeline {
  steps: CheckStep[] = [];
  add(step: CheckStep) {
    this.steps.push(step);
  }
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T | null; ms: number; error: string | null }> {
  const t = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - t, error: null };
  } catch (err) {
    return { value: null, ms: Date.now() - t, error: err instanceof Error ? err.message : String(err) };
  }
}

function parsedSummary(p: ParsedReference): string {
  const bits = [
    p.title ? `title “${p.title.slice(0, 80)}${p.title.length > 80 ? "…" : ""}”` : null,
    p.authors.length ? `${p.authors.length} author${p.authors.length > 1 ? "s" : ""}${p.etAl ? " + et al." : ""}` : null,
    p.year ? `year ${p.year}` : null,
    p.venue ? `in ${p.venue.slice(0, 50)}` : null,
    p.doi ? `DOI ${p.doi}` : null,
    p.isbn ? `ISBN ${p.isbn}` : null,
  ].filter(Boolean);
  return bits.length ? `Read ${bits.join(", ")}.` : "Could not separate the fields; comparing against the full text instead.";
}

function flagsFor(record: CslItem, doi: string | null, oa: OpenAlexWork | null, updates: UpdateNotice[] | null, m: MatchScore | null): FlagInfo[] {
  const flags: FlagInfo[] = [];
  const retraction = updates?.find((u) => /retract|withdraw/i.test(u.type));
  if (retraction || oa?.is_retracted || /^\s*retracted\b/i.test(record.title ?? "")) {
    flags.push({
      code: "retracted",
      label: "Retracted",
      detail: retraction
        ? `A retraction notice was published${retraction.date ? ` on ${retraction.date}` : ""}${retraction.source === "retraction-watch" ? " (Retraction Watch)" : ""}. Cite it only to discuss the retraction.`
        : "Listed as retracted. Cite it only to discuss the retraction.",
      severity: "danger",
      href: retraction ? doiUrl(retraction.noticeDoi) : undefined,
    });
  }
  const correction = updates?.find((u) => /correct|erratum|corrigendum/i.test(u.type));
  if (correction) flags.push({ code: "correction", label: "Corrected", detail: "A correction was published. Check the corrected version.", severity: "info", href: doiUrl(correction.noticeDoi) });
  const concern = updates?.find((u) => /concern/i.test(u.type));
  if (concern) flags.push({ code: "expression-of-concern", label: "Expression of concern", detail: "The publisher raised concerns about this paper.", severity: "warn", href: doiUrl(concern.noticeDoi) });
  const preprint =
    isPreprintDoi(doi) ||
    record.genre === "preprint" ||
    oa?.type === "preprint" ||
    (record.type === "article" && /arxiv|rxiv|ssrn|preprint|research square|osf/i.test(`${record.publisher ?? ""} ${record["container-title"] ?? ""}`));
  if (preprint) flags.push({ code: "preprint", label: "Preprint", detail: "Not peer reviewed. Check whether a published version exists.", severity: "warn" });
  const yearField = m?.fields.find((f) => f.field === "year");
  if (yearField?.verdict === "close") flags.push({ code: "year-off-by-one", label: yearField.note?.includes("edition") ? "Later edition" : "Year ±1", detail: yearField.note ?? "One year apart.", severity: "info" });
  return flags;
}

function finish(
  t0: number,
  entered: ParsedReference,
  partial: Omit<VerificationResult, "entered" | "checkedAt" | "durationMs">,
): VerificationResult {
  return { ...partial, entered, checkedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
}

/* ───────────────────────── DOI path ───────────────────────── */

async function verifyByDoi(p: ParsedReference, doi: string, t0: number, tl: Timeline): Promise<VerificationResult> {
  const [exists, cr, oa, upd] = await Promise.all([
    timed(() => doiExists(doi)),
    timed(() => crossrefWork(doi)),
    timed(() => openAlexByDoi(doi)),
    timed(() => crossrefUpdates(doi)),
  ]);

  const existsVal = exists.value?.exists ?? null;
  if (existsVal === false && !cr.value) {
    tl.add({ id: "doi", label: "DOI registered?", outcome: "fail", detail: `doi.org has no record of ${doi} in any registry (Crossref, DataCite, mEDRA, JaLC…).`, source: "doi.org", ms: exists.ms });
    return finish(t0, p, {
      status: "mismatch",
      score: null,
      reasonCode: "doi-not-registered",
      reason: `The DOI ${doi} does not exist. No registry has ever issued it.`,
      record: null,
      recordSource: null,
      fields: [],
      flags: [],
      checks: tl.steps,
      provenWrong: true,
    });
  }
  tl.add({
    id: "doi",
    label: "DOI registered?",
    outcome: existsVal ? "pass" : "warn",
    detail: existsVal ? `${doi} is registered.` : `doi.org could not be reached (${exists.value?.error ?? exists.error}); continuing with Crossref.`,
    source: "doi.org",
    ms: exists.ms,
  });

  let record: CslItem | null = null;
  let source: RecordSource | null = null;
  if (cr.value) {
    record = crossrefToCsl(cr.value);
    source = "crossref";
    tl.add({ id: "record", label: "Fetched the official record", outcome: "pass", detail: `Crossref: “${(record.title ?? "").slice(0, 90)}”`, source: "Crossref", ms: cr.ms });
  } else {
    const cn = await timed(() => doiCsl(doi));
    if (cn.value) {
      record = cn.value;
      source = /datacite|zenodo|arxiv|figshare/i.test(`${record.publisher ?? ""} ${doi}`) || doi.startsWith("10.48550/") || doi.startsWith("10.5281/") ? "datacite" : "doi.org";
      tl.add({ id: "record", label: "Fetched the official record", outcome: "pass", detail: `${SOURCE_LABEL[source]}: “${(record.title ?? "").slice(0, 90)}”`, source: SOURCE_LABEL[source], ms: cn.ms });
    } else if (oa.value) {
      record = openAlexToCsl(oa.value);
      source = "openalex";
      tl.add({ id: "record", label: "Fetched the official record", outcome: "warn", detail: "Registry metadata unavailable; using OpenAlex's copy.", source: "OpenAlex", ms: oa.ms });
    }
  }

  if (!record) {
    const unreachable = existsVal === null;
    tl.add({ id: "record", label: "Fetched the official record", outcome: "error", detail: unreachable ? "Scholarly databases did not answer." : "The DOI exists but no registry returned its details.", ms: cr.ms });
    return finish(t0, p, {
      status: "check",
      score: null,
      reasonCode: "service-unavailable",
      reason: unreachable ? "The databases could not be reached, so this was not checked. Try again in a minute." : "The DOI exists, but its details could not be fetched. Check it by opening the DOI link.",
      record: null,
      recordSource: null,
      fields: [],
      flags: [{ code: "service-degraded", label: "Not checked", detail: "A database did not answer in time.", severity: "warn" }],
      checks: tl.steps,
      provenWrong: false,
    });
  }

  // Abstracts power the claim check; Crossref often lacks them, OpenAlex usually has them.
  if (!record.abstract && oa.value?.abstract_inverted_index) {
    const abs = openAlexToCsl(oa.value).abstract;
    if (abs) record = { ...record, abstract: abs };
  }

  // Second opinion: does OpenAlex describe the same paper?
  let secondDisagrees = false;
  if (oa.value && source !== "openalex") {
    const sim = titleSimilarity(candidateTitle(record), oa.value.title ?? "");
    const regFamilies = (record.author ?? []).slice(0, 5).map((a) => norm(a.family ?? a.literal ?? "")).filter(Boolean);
    const oaNames = (oa.value.authorships ?? []).slice(0, 5).map((a) => norm(a.author.display_name));
    const authorsAgree = !regFamilies.length || !oaNames.length || regFamilies.some((f) => oaNames.some((n) => n.split(" ").includes(f.split(" ").pop() ?? f)));
    // Disagreement means "a different work", not just a differently formatted title.
    secondDisagrees = sim < 0.6 && !authorsAgree;
    tl.add({ id: "second", label: "Second opinion", outcome: secondDisagrees ? "warn" : "pass", detail: secondDisagrees ? "OpenAlex describes this DOI differently." : "OpenAlex agrees on this record.", source: "OpenAlex", ms: oa.ms });
  } else {
    tl.add({ id: "second", label: "Second opinion", outcome: "skip", detail: oa.error ? "OpenAlex unavailable right now." : "OpenAlex has no entry for this DOI.", source: "OpenAlex", ms: oa.ms });
  }

  tl.add({
    id: "retraction",
    label: "Retraction notices",
    outcome: upd.error ? "skip" : upd.value?.some((u) => /retract|withdraw/i.test(u.type)) || oa.value?.is_retracted ? "fail" : "pass",
    detail: upd.error ? "Crossref's notices could not be checked right now." : upd.value?.length ? `${upd.value.length} notice(s) found.` : "No retraction or correction notices.",
    source: "Crossref + Retraction Watch",
    ms: upd.ms,
  });

  // Only a bare identifier was given: nothing to compare, the registry record IS the reference.
  const onlyIdentifier = p.format === "doi" || p.format === "arxiv";
  if (onlyIdentifier) {
    const flags = flagsFor(record, doi, oa.value, upd.value, null);
    const retracted = flags.some((f) => f.code === "retracted");
    const idName = p.format === "arxiv" ? "arXiv ID" : "DOI";
    tl.add({ id: "compare", label: "Compared details", outcome: "skip", detail: `You gave only the ${idName}, so the full record was filled in from the registry.`, ms: 0 });
    return finish(t0, p, {
      status: retracted || secondDisagrees ? "check" : "verified",
      score: null,
      reasonCode: "match",
      reason: retracted ? "Real record, but it has been retracted." : `The ${idName} is real. The details were filled in from the official record.`,
      record,
      recordSource: source,
      fields: [],
      flags,
      checks: tl.steps,
      provenWrong: false,
    });
  }

  const m = scoreCandidate(p, record);
  const flags = flagsFor(record, doi, oa.value, upd.value, m);
  if (secondDisagrees) flags.push({ code: "second-opinion-disagrees", label: "Databases disagree", detail: "Crossref and OpenAlex describe this DOI differently.", severity: "warn" });
  tl.add({ id: "compare", label: "Compared details", outcome: m.score >= VERIFIED_AT ? "pass" : m.score >= CHECK_AT ? "warn" : "fail", detail: `Match score ${m.score}/100 (title, authors, year, venue).`, ms: 0 });

  if (isDifferentPaper(m)) {
    return finish(t0, p, {
      status: "mismatch",
      score: m.score,
      reasonCode: "doi-other-paper",
      reason: `This DOI belongs to a different paper: “${(record.title ?? "").slice(0, 120)}”.`,
      record,
      recordSource: source,
      fields: m.fields,
      flags,
      checks: tl.steps,
      provenWrong: true,
    });
  }

  const retracted = flags.some((f) => f.code === "retracted");
  let status: VerificationResult["status"] = m.score >= VERIFIED_AT ? "verified" : "check";
  let reasonCode: ReasonCode = m.score >= 100 ? "match" : m.score >= VERIFIED_AT ? "close-match" : "partial-match";
  let reason =
    status === "verified"
      ? m.score >= 100 && !m.fields.some((f) => f.verdict === "close")
        ? "Every detail matches the official record."
        : `Matches the official record, with a small difference in the ${m.fields.filter((f) => f.verdict === "close" || f.verdict === "differs").map((f) => (f.field === "venue" ? "journal" : f.field)).join(" and ") || "details"}.`
      : `Some details differ from the official record: ${m.fields
          .filter((f) => f.verdict === "differs" || f.verdict === "close")
          .map((f) => f.field)
          .join(", ")}.`;
  if (retracted) {
    status = "check";
    reason = "Real record, but it has been retracted. Keep it only to discuss the retraction.";
  }
  if (secondDisagrees && status === "verified") {
    status = "check";
    reasonCode = "partial-match";
    reason = "Crossref and OpenAlex disagree about this DOI. Open it to confirm.";
  }
  return finish(t0, p, { status, score: m.score, reasonCode, reason, record, recordSource: source, fields: m.fields, flags, checks: tl.steps, provenWrong: false });
}

/* ───────────────────────── No-DOI path ───────────────────────── */

interface Candidate {
  csl: CslItem;
  source: RecordSource;
  m: MatchScore;
}

async function verifyWithoutDoi(p: ParsedReference, t0: number, tl: Timeline): Promise<VerificationResult> {
  if (!p.title && p.raw.replace(/[^A-Za-z]/g, "").length < 25 && !p.isbn) {
    tl.add({ id: "search", label: "Searched databases", outcome: "skip", detail: "Too little information to search with.", ms: 0 });
    return finish(t0, p, {
      status: "check",
      score: null,
      reasonCode: "too-little-info",
      reason: "There is not enough detail here to check. Add the title, authors and year.",
      record: null,
      recordSource: null,
      fields: [],
      flags: [{ code: "no-doi", label: "No DOI", detail: "No DOI or ISBN given.", severity: "info" }],
      checks: tl.steps,
      provenWrong: false,
    });
  }

  const looksLikeBook = Boolean(p.isbn) || (!p.volume && !p.pages && Boolean(p.publisher ?? p.venue) && !/journal|review|proceedings|transactions|letters|quarterly/i.test(p.venue ?? ""));
  // Google Books is a second book catalogue; it is skipped while Google is refusing requests (quota).
  const useGoogleBooks = (Boolean(p.isbn) || (looksLikeBook && Boolean(p.title))) && googleBooksAvailable();
  const [cr, oaHits, isbnHit, olHits, gbIsbnHit, gbHits] = await Promise.all([
    timed(() => crossrefBibliographic(p.raw, 5)),
    p.title ? timed(() => openAlexTitleSearch(p.title!, 5)) : Promise.resolve({ value: [] as OpenAlexWork[], ms: 0, error: null }),
    p.isbn ? timed(() => openLibraryIsbn(p.isbn!)) : Promise.resolve({ value: null, ms: 0, error: null }),
    looksLikeBook && p.title ? timed(() => openLibrarySearch(p.title!, p.authors[0]?.family, { year: p.year, publisher: p.publisher ?? p.venue })) : Promise.resolve({ value: [] as CslItem[], ms: 0, error: null }),
    useGoogleBooks && p.isbn ? timed(() => googleBooksIsbn(p.isbn!)) : Promise.resolve({ value: null, ms: 0, error: null }),
    useGoogleBooks && looksLikeBook && p.title ? timed(() => googleBooksSearch(p.title!, p.authors[0]?.family)) : Promise.resolve({ value: [] as CslItem[], ms: 0, error: null }),
  ]);

  const candidates: Candidate[] = [];
  for (const w of cr.value ?? []) candidates.push({ csl: crossrefToCsl(w), source: "crossref", m: null as unknown as MatchScore });
  for (const w of oaHits.value ?? []) candidates.push({ csl: openAlexToCsl(w), source: "openalex", m: null as unknown as MatchScore });
  if (isbnHit.value) candidates.push({ csl: isbnHit.value, source: "openlibrary", m: null as unknown as MatchScore });
  for (const b of olHits.value ?? []) candidates.push({ csl: b, source: "openlibrary", m: null as unknown as MatchScore });
  // After Open Library, so that on an equal score the Open Library record is still the one shown.
  if (gbIsbnHit.value) candidates.push({ csl: gbIsbnHit.value, source: "googlebooks", m: null as unknown as MatchScore });
  for (const b of gbHits.value ?? []) candidates.push({ csl: b, source: "googlebooks", m: null as unknown as MatchScore });
  for (const c of candidates) c.m = scoreCandidate(p, c.csl);
  candidates.sort((a, b) => b.m.score - a.m.score || (b.m.coverage - a.m.coverage));

  const searched = [
    `Crossref ${cr.error ? "(unavailable)" : `(${cr.value?.length ?? 0} candidates)`}`,
    p.title ? `OpenAlex ${oaHits.error ? "(unavailable)" : `(${oaHits.value?.length ?? 0})`}` : null,
    p.isbn || looksLikeBook ? `Open Library (${(isbnHit.value ? 1 : 0) + (olHits.value?.length ?? 0)})` : null,
    useGoogleBooks ? `Google Books ${gbIsbnHit.error || gbHits.error ? "(unavailable)" : `(${(gbIsbnHit.value ? 1 : 0) + (gbHits.value?.length ?? 0)})`}` : null,
  ].filter(Boolean);
  const allFailed = Boolean(cr.error) && (!p.title || Boolean(oaHits.error));
  tl.add({ id: "search", label: "Searched databases", outcome: allFailed ? "error" : "pass", detail: `No DOI given, so searched: ${searched.join(", ")}.`, ms: Math.max(cr.ms, oaHits.ms, isbnHit.ms, olHits.ms, gbIsbnHit.ms, gbHits.ms) });

  // Only an ISBN was given: nothing to compare, the catalogue record is the reference (as with a bare DOI).
  if (p.isbn && !p.title && !p.authors.length) {
    const hit = isbnHit.value ? { csl: isbnHit.value, source: "openlibrary" as const } : gbIsbnHit.value ? { csl: gbIsbnHit.value, source: "googlebooks" as const } : null;
    if (hit?.csl.title) {
      tl.add({ id: "compare", label: "Compared details", outcome: "skip", detail: `You gave only the ISBN, so the book's details were filled in from ${SOURCE_LABEL[hit.source]}.`, ms: 0 });
      return finish(t0, p, {
        status: "verified",
        score: null,
        reasonCode: "match",
        reason: `The ISBN is real. The details were filled in from ${SOURCE_LABEL[hit.source]}.`,
        record: { ...hit.csl, ISBN: hit.csl.ISBN ?? p.isbn },
        recordSource: hit.source,
        fields: [],
        flags: [{ code: "book", label: "Book", detail: `Found by its ISBN in ${SOURCE_LABEL[hit.source]}.`, severity: "info" }],
        checks: tl.steps,
        provenWrong: false,
      });
    }
  }

  const best = candidates[0];
  const flags: FlagInfo[] = [{ code: "no-doi", label: "No DOI", detail: "Cited without a DOI.", severity: "info" }];
  // Name only the databases that really answered, so "not found" never claims more than was searched.
  const answered = ["Crossref", ...(p.title && !oaHits.error ? ["OpenAlex"] : []), ...(p.isbn || looksLikeBook ? ["Open Library"] : []), ...(useGoogleBooks && !gbIsbnHit.error && !gbHits.error ? ["Google Books"] : [])].filter((n) => !(n === "Crossref" && cr.error));
  const silent = [...(cr.error ? ["Crossref"] : []), ...(p.title && oaHits.error ? ["OpenAlex"] : [])];
  const where = answered.length > 1 ? `${answered.slice(0, -1).join(", ")} or ${answered[answered.length - 1]}` : (answered[0] ?? "the databases");

  if (!best || best.m.score < CHECK_AT || best.m.title.similarity < 0.75) {
    tl.add({ id: "compare", label: "Compared details", outcome: allFailed ? "error" : "fail", detail: best ? `Closest record scored ${best.m.score}/100 (not a confident match).` : "No candidate records came back.", ms: 0 });
    return finish(t0, p, {
      status: "check",
      score: best?.m.score ?? null,
      reasonCode: allFailed ? "service-unavailable" : "not-found",
      reason: allFailed
        ? "The databases could not be reached, so this was not checked. Try again in a minute."
        : `No matching record in ${where}${silent.length ? ` (${silent.join(" and ")} did not answer, so ${silent.length > 1 ? "they were" : "it was"} not searched)` : ""}. It may be a book, report or web page that these databases do not hold, or it may be invented. Find the source yourself to confirm it.`,
      // A record is only shown when its title really is this title; anything else would be a misleading "closest".
      record: best && best.m.score >= 55 && best.m.title.similarity >= 0.75 && best.csl.title ? best.csl : null,
      recordSource: best && best.m.score >= 55 && best.m.title.similarity >= 0.75 && best.csl.title ? best.source : null,
      fields: best && best.m.score >= 55 && best.m.title.similarity >= 0.75 && best.csl.title ? best.m.fields : [],
      flags: allFailed ? [...flags, { code: "service-degraded", label: "Not checked", detail: "Databases did not answer.", severity: "warn" }] : flags,
      checks: tl.steps,
      provenWrong: false,
    });
  }

  tl.add({ id: "compare", label: "Compared details", outcome: best.m.score >= VERIFIED_AT ? "pass" : "warn", detail: `Best match from ${SOURCE_LABEL[best.source]} scored ${best.m.score}/100.`, ms: 0 });

  // Promote: if the best match has a DOI, run the full DOI checks on it (retractions, second opinion).
  const record = best.csl;
  if (record.DOI) {
    const upd = await timed(() => crossrefUpdates(record.DOI!));
    const extra = flagsFor(record, record.DOI, null, upd.value, best.m);
    flags.push(...extra.filter((f) => f.code !== "year-off-by-one"));
    flags.push({ code: "doi-suggested", label: "Add the DOI", detail: `This reference has a DOI: ${record.DOI}`, severity: "info", href: doiUrl(record.DOI) });
  } else if (best.source === "openlibrary" || best.source === "googlebooks") {
    flags.push({ code: "book", label: "Book", detail: `Matched a book record in ${SOURCE_LABEL[best.source]}.`, severity: "info" });
  }
  const yearField = best.m.fields.find((f) => f.field === "year");
  if (yearField?.verdict === "close") flags.push({ code: "year-off-by-one", label: yearField.note?.includes("edition") ? "Later edition" : "Year ±1", detail: yearField.note ?? "One year apart.", severity: "info" });

  const retracted = flags.some((f) => f.code === "retracted");
  const verified = best.m.score >= VERIFIED_AT && !retracted;
  return finish(t0, p, {
    status: verified ? "verified" : "check",
    score: best.m.score,
    reasonCode: verified ? (best.m.score >= 100 ? "match" : "close-match") : "partial-match",
    reason: retracted
      ? "Real record, but it has been retracted. Keep it only to discuss the retraction."
      : verified
        ? `Matches a real record in ${SOURCE_LABEL[best.source]}.`
        : `A record with this title exists in ${SOURCE_LABEL[best.source]}, but the ${best.m.fields.filter((f) => f.verdict === "differs" || f.verdict === "close").map((f) => (f.field === "venue" ? "journal" : f.field)).join(" and ") || "details"} you gave ${best.m.fields.filter((f) => f.verdict === "differs" || f.verdict === "close").length === 1 ? "differs" : "differ"}. Compare and fix.`,
    record,
    recordSource: best.source,
    fields: best.m.fields,
    flags,
    checks: tl.steps,
    provenWrong: false,
  });
}

/* ───────────────────────── Entry point ───────────────────────── */

/** For a proven-wrong DOI: is there a real paper with this title and these authors? */
async function findIntended(p: ParsedReference, result: VerificationResult): Promise<VerificationResult> {
  if (!p.title || p.title.length < 12) return result;
  const t = Date.now();
  const alt = await verifyWithoutDoi({ ...p, doi: undefined, arxivId: undefined }, Date.now(), new Timeline());
  const altTitle = alt.fields.find((f) => f.field === "title");
  const altAuthors = alt.fields.find((f) => f.field === "authors");
  const sameWork = Boolean(altTitle && altTitle.similarity >= 0.9 && altAuthors && altAuthors.verdict !== "differs");
  const ok = Boolean(alt.record && alt.record.title && alt.score !== null && (alt.score >= VERIFIED_AT || sameWork) && alt.record.DOI?.toLowerCase() !== p.doi?.toLowerCase());
  const unreachable = alt.reasonCode === "service-unavailable";
  result.checks.push({
    id: "intended",
    label: "Looked for the paper you meant",
    outcome: ok ? "pass" : "fail",
    detail: ok
      ? `Found a real paper with this title: DOI ${alt.record!.DOI ?? "(none)"}.`
      : unreachable
        ? "Could not search for the paper you meant: the databases did not answer."
        : "No real paper matches this title and these authors, so the reference looks invented.",
    ms: Date.now() - t,
  });
  // "Searched and found nothing" is only claimed when the search really ran.
  return { ...result, suggestion: ok ? { record: alt.record!, source: alt.recordSource!, score: alt.score! } : null, searchedForIntended: !unreachable };
}

/**
 * A link on its own. If the page names a DOI (publisher pages do), that DOI is checked like any other.
 * Otherwise it is kept as what it is: a working web page, not a scholarly record.
 */
async function verifyLink(p: ParsedReference, link: string, t0: number, tl: Timeline): Promise<VerificationResult> {
  const page = await timed(() => fetchPageMeta(link));
  if (!page.value) {
    const why = page.error && !/fetch|ENOTFOUND|EAI_AGAIN/i.test(page.error) ? page.error : "That page did not answer.";
    tl.add({ id: "page", label: "Opened the link", outcome: "fail", detail: why, ms: page.ms });
    return finish(t0, p, {
      status: "check",
      score: null,
      reasonCode: "link-unreachable",
      reason: `The link could not be opened. ${why} Check the address.`,
      record: null,
      recordSource: null,
      fields: [],
      flags: [{ code: "web-page", label: "Link", detail: "Given as a web link only.", severity: "info" }],
      checks: tl.steps,
      provenWrong: false,
    });
  }
  const meta = page.value;
  tl.add({ id: "page", label: "Opened the link", outcome: "pass", detail: `The page is titled “${(meta.title ?? "untitled").slice(0, 90)}”${meta.site ? `, on ${meta.site}` : ""}.`, ms: page.ms });
  const pageDoi = normalizeDoi(meta.doi);
  if (pageDoi) {
    tl.add({ id: "page-doi", label: "Found a DOI on the page", outcome: "pass", detail: `The page names DOI ${pageDoi}, so it is checked as a scholarly record.`, ms: 0 });
    const r = await verifyByDoi({ ...p, format: "doi", doi: pageDoi }, pageDoi, t0, tl);
    if (!r.provenWrong) return r;
  }
  return finish(t0, p, {
    status: "check",
    score: null,
    reasonCode: "web-page",
    reason: "A working web page, not a scholarly record. Its title and date were read from the page; judge its reliability yourself.",
    record: pageToCsl(meta),
    recordSource: null,
    fields: [],
    flags: [{ code: "web-page", label: "Web page", detail: "Not peer reviewed, and it can change. The citation records the day it was read.", severity: "info", href: meta.url }],
    checks: tl.steps,
    provenWrong: false,
  });
}

export async function verifyReference(parsed: ParsedReference): Promise<VerificationResult> {
  const t0 = Date.now();
  const tl = new Timeline();
  tl.add({ id: "parse", label: "Read your reference", outcome: "pass", detail: parsedSummary(parsed), ms: 0 });

  const doi = normalizeDoi(parsed.doi ?? parsed.csl?.DOI ?? null) ?? (parsed.arxivId ? `10.48550/arxiv.${parsed.arxivId}` : null);
  try {
    // A bare link with nothing else: open the page and see what it says about itself.
    if (!doi && !parsed.isbn && parsed.url && !parsed.title && !parsed.authors.length) return await verifyLink(parsed, parsed.url, t0, tl);
    if (doi) {
      const r = await verifyByDoi({ ...parsed, doi }, doi, t0, tl);
      if (r.provenWrong) return { ...(await findIntended({ ...parsed, doi }, r)), durationMs: Date.now() - t0 };
      return r;
    }
    return await verifyWithoutDoi(parsed, t0, tl);
  } catch (err) {
    console.error("[knowlix] verifyReference failed", err);
    tl.add({ id: "error", label: "Check stopped", outcome: "error", detail: "Something went wrong during the check.", ms: Date.now() - t0 });
    return finish(t0, parsed, {
      status: "check",
      score: null,
      reasonCode: "service-unavailable",
      reason: "This reference could not be checked right now. Try again in a minute.",
      record: null,
      recordSource: null,
      fields: [],
      flags: [{ code: "service-degraded", label: "Not checked", detail: "The check did not finish.", severity: "warn" }],
      checks: tl.steps,
      provenWrong: false,
    });
  }
}

export { cslYear };
