import type { CslItem, FieldComparison, ParsedReference } from "@/shared/types";
import { cslVenue, cslYear } from "../scholarly/csl";
import { isPreprintDoi } from "@/shared/identifiers";
import { clamp01, containedIn, familyKey, familyMatch, norm, titleSimilarity, venueSimilarity } from "../text/similarity";

/**
 * Lock 1 scoring: title 40 · authors 30 · year 15 (±1 allowed) · venue 15.
 * ≥90 verified, 70–89 please check, proven-wrong rules live in verify.ts.
 */
export const WEIGHTS = { title: 40, authors: 30, year: 15, venue: 15 } as const;
export const VERIFIED_AT = 90;
export const CHECK_AT = 70;

function ramp(sim: number, zero: number, full: number) {
  return clamp01((sim - zero) / (full - zero));
}

export function candidateTitle(c: CslItem): string {
  // Crossref prefixes retracted papers' titles with "RETRACTED:"; students cite the original title.
  return (c.title ?? "").replace(/^\s*(retracted|withdrawn)\s*[:.-]\s*/i, "");
}

function compareTitle(p: ParsedReference, c: CslItem): FieldComparison {
  const found = candidateTitle(c) || null;
  if (!found) return { field: "title", entered: p.title ?? null, found, similarity: 0, weight: WEIGHTS.title, points: 0, verdict: "missing" };
  if (p.title) {
    const sim = titleSimilarity(p.title, found);
    const points = WEIGHTS.title * ramp(sim, 0.6, 0.93);
    return {
      field: "title",
      entered: p.title,
      found,
      similarity: sim,
      weight: WEIGHTS.title,
      points,
      verdict: sim >= 0.93 ? "match" : sim >= 0.78 ? "close" : "differs",
    };
  }
  // Title could not be parsed: is the record's title inside what the student typed?
  const sim = Math.min(0.95, containedIn(found, p.raw));
  return {
    field: "title",
    entered: null,
    found,
    similarity: sim,
    weight: WEIGHTS.title,
    points: WEIGHTS.title * ramp(sim, 0.7, 0.95),
    verdict: sim >= 0.9 ? "match" : sim >= 0.75 ? "close" : "differs",
    note: "Compared with the full text you pasted (title could not be separated).",
  };
}

function compareAuthors(p: ParsedReference, c: CslItem): FieldComparison {
  const cand = (c.author ?? []).map((a) => a.family ?? a.literal ?? "").filter(Boolean);
  const foundStr = cand.length ? cand.slice(0, 6).join(", ") + (cand.length > 6 ? " et al." : "") : null;
  if (!cand.length) {
    return { field: "authors", entered: p.authors.map((a) => a.family).join(", ") || null, found: null, similarity: 0, weight: WEIGHTS.authors, points: 0, verdict: "missing", note: "The record lists no authors." };
  }
  const entered = p.authors.map((a) => a.family).filter((f) => f && f.length > 1);
  if (entered.length) {
    const matched = entered.filter((e) => cand.some((cf) => familyMatch(e, cf) >= 0.88));
    const firstOk = familyMatch(entered[0], cand[0]) >= 0.88;
    // Invented names lower the score; leaving some real authors out is only a small penalty.
    let sim = matched.length / entered.length;
    if (!firstOk && sim > 0) sim *= 0.85;
    if (!p.etAl && cand.length > entered.length + 2) sim *= 0.97;
    return {
      field: "authors",
      entered: entered.join(", "),
      found: foundStr,
      similarity: clamp01(sim),
      weight: WEIGHTS.authors,
      points: WEIGHTS.authors * ramp(sim, 0.2, 0.99),
      verdict: sim >= 0.99 ? "match" : sim >= 0.5 ? "close" : "differs",
      note: matched.length < entered.length ? `${entered.length - matched.length} of the names you listed are not authors of this record.` : undefined,
    };
  }
  // Authors not parsed: how many of the record's first authors appear in the raw text?
  const rawWords = new Set(norm(p.raw).split(" "));
  const firstFew = cand.slice(0, 3);
  const present = firstFew.filter((f) => familyKey(f).split(" ").every((part) => rawWords.has(part))).length;
  const sim = present / firstFew.length;
  return {
    field: "authors",
    entered: null,
    found: foundStr,
    similarity: sim,
    weight: WEIGHTS.authors,
    points: WEIGHTS.authors * sim,
    verdict: sim >= 0.99 ? "match" : sim > 0 ? "close" : "differs",
    note: "Compared with the full text you pasted.",
  };
}

function compareYear(p: ParsedReference, c: CslItem): FieldComparison {
  const cy = cslYear(c);
  if (!cy) return { field: "year", entered: p.year ? String(p.year) : null, found: null, similarity: 0, weight: WEIGHTS.year, points: 0, verdict: "missing", note: "The record has no year." };
  let ey = p.year ?? null;
  if (!ey) {
    const rawYears = [...p.raw.matchAll(/\b(1[5-9]\d\d|20\d\d)\b/g)].map((m) => Number(m[1]));
    ey = rawYears.find((y) => Math.abs(y - cy) <= 1) ?? null;
    if (!ey) return { field: "year", entered: null, found: String(cy), similarity: 0, weight: WEIGHTS.year, points: 0, verdict: "missing" };
  }
  const diff = Math.abs(ey - cy);
  if (diff > 1 && c.type === "book" && ey > cy) {
    // Books are reprinted: citing a later edition of a book first published earlier is normal.
    return {
      field: "year",
      entered: String(ey),
      found: String(cy),
      similarity: 0.8,
      weight: WEIGHTS.year,
      points: WEIGHTS.year * 0.8,
      verdict: "close",
      note: `First published in ${cy}; ${ey} is likely a later edition.`,
    };
  }
  return {
    field: "year",
    entered: String(ey),
    found: String(cy),
    similarity: diff === 0 ? 1 : diff === 1 ? 0.95 : 0,
    weight: WEIGHTS.year,
    points: diff <= 1 ? WEIGHTS.year : 0,
    verdict: diff === 0 ? "match" : diff === 1 ? "close" : "differs",
    note: diff === 1 ? "One year apart. Usually online-first vs print date, which is allowed." : diff > 1 ? `${diff} years apart.` : undefined,
  };
}

const PREPRINT_SERVER = /\b(arxiv|biorxiv|medrxiv|chemrxiv|psyarxiv|socarxiv|edarxiv|ssrn|research square|osf preprints?|preprints\.org|zenodo|authorea|techrxiv|eartharxiv)\b/i;

function compareVenue(p: ParsedReference, c: CslItem): FieldComparison {
  const options = [c["container-title"], c["container-title-short"], c.publisher].filter((x): x is string => Boolean(x));
  const found = cslVenue(c);
  if (!options.length) return { field: "venue", entered: p.venue ?? p.publisher ?? null, found: null, similarity: 0, weight: WEIGHTS.venue, points: 0, verdict: "missing", note: "The record names no journal or publisher." };
  const entered = p.venue ?? p.publisher;
  // A preprint is cited by its server's name ("SSRN", "Research Square", "arXiv"), while the registry lists the
  // company behind the server ("Elsevier BV", "Springer Science and Business Media LLC"). Both are right.
  if (entered && PREPRINT_SERVER.test(entered) && (isPreprintDoi(c.DOI ?? null) || c.genre === "preprint" || c.type === "posted-content" || PREPRINT_SERVER.test(options.join(" ")))) {
    return { field: "venue", entered, found, similarity: 1, weight: WEIGHTS.venue, points: WEIGHTS.venue, verdict: "match", note: "A preprint server. The registry lists the organisation that runs it." };
  }
  if (entered) {
    let sim = venueSimilarity(entered, options);
    if (p.publisher && p.venue) sim = Math.max(sim, venueSimilarity(p.publisher, options));
    return {
      field: "venue",
      entered,
      found,
      similarity: sim,
      weight: WEIGHTS.venue,
      points: WEIGHTS.venue * ramp(sim, 0.55, 0.9),
      verdict: sim >= 0.9 ? "match" : sim >= 0.7 ? "close" : "differs",
    };
  }
  const sim = Math.max(...options.map((o) => containedIn(o, p.raw)));
  if (sim < 0.75) return { field: "venue", entered: null, found, similarity: sim, weight: WEIGHTS.venue, points: 0, verdict: "missing" };
  return { field: "venue", entered: null, found, similarity: sim, weight: WEIGHTS.venue, points: WEIGHTS.venue * ramp(sim, 0.75, 0.95), verdict: sim >= 0.9 ? "match" : "close", note: "Found in the text you pasted." };
}

export interface MatchScore {
  score: number;
  fields: FieldComparison[];
  /** Fraction of the total weight that could actually be compared. */
  coverage: number;
  title: FieldComparison;
  authors: FieldComparison;
}

export function scoreCandidate(p: ParsedReference, c: CslItem): MatchScore {
  const title = compareTitle(p, c);
  const authors = compareAuthors(p, c);
  const year = compareYear(p, c);
  const venue = compareVenue(p, c);
  const fields = [title, authors, year, venue];
  const compared = fields.filter((f) => f.verdict !== "missing");
  const available = compared.reduce((s, f) => s + f.weight, 0);
  const points = compared.reduce((s, f) => s + f.points, 0);
  let score = available > 0 ? Math.round((100 * points) / available) : 0;
  // A match needs a title. A record that agrees only on year and journal (or has no title at all)
  // proves nothing, however high the remaining fields score.
  if (title.verdict === "missing") score = Math.min(score, authors.verdict === "missing" ? 30 : 60);
  return { score, fields, coverage: available / 100, title, authors };
}

/** "This DOI belongs to a different paper": the title and the authors both disagree. */
export function isDifferentPaper(m: MatchScore): boolean {
  const titleKnown = m.title.entered !== null || m.title.note !== undefined;
  const titleOff = titleKnown && m.title.similarity < 0.55;
  const authorsOff = m.authors.verdict === "differs" || (m.authors.entered !== null && m.authors.similarity < 0.34);
  return titleOff && (authorsOff || m.authors.verdict === "missing");
}
