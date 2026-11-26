import "server-only";
import type { CslItem, CslName } from "@/shared/types";
import { getCached, qs } from "./http";
import { cleanTitle, stripTags, tidyCsl } from "./csl";
import { keyTerms } from "./terms";

/*
 * Europe PMC: https://europepmc.org/RestfulWebService (no key).
 * ~45M life-science, medical, psychology and public-health records, most
 * with an abstract, plus the open-access full text of ~10M of them.
 */

export const EUROPE_PMC_HOST = "www.ebi.ac.uk";
const BASE = `https://${EUROPE_PMC_HOST}/europepmc/webservices/rest`;

export interface EuropePmcResult {
  id: string;
  /** MED = PubMed, PMC = PubMed Central, PPR = preprint, AGR = Agricola, … */
  source: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  authorList?: { author?: { fullName?: string; firstName?: string; lastName?: string; initials?: string; collectiveName?: string }[] };
  journalInfo?: {
    issue?: string;
    volume?: string;
    yearOfPublication?: number;
    journal?: { title?: string; isoabbreviation?: string; medlineAbbreviation?: string };
  };
  /** "lite" results carry the journal as flat fields instead of journalInfo. */
  journalTitle?: string;
  journalVolume?: string;
  issue?: string;
  pubYear?: string;
  pageInfo?: string;
  abstractText?: string;
  language?: string;
  pubTypeList?: { pubType?: string[] };
  pubType?: string;
  bookOrReportDetails?: { publisher?: string; yearOfPublication?: number };
  isOpenAccess?: "Y" | "N";
  inEPMC?: "Y" | "N";
  citedByCount?: number;
  fullTextUrlList?: { fullTextUrl?: { availability?: string; availabilityCode?: string; documentStyle?: string; site?: string; url?: string }[] };
}

/** "PMC1234567" from "pmc1234567", "PMC 1234567", "1234567" or a PMC article URL; null if it is not one. */
export function normalizePmcid(input: string | number | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  const m = s.match(/PMC\s*(\d{4,9})\b/i) ?? s.match(/^(\d{4,9})$/);
  return m ? `PMC${m[1]}` : null;
}

function authors(r: EuropePmcResult): CslName[] | undefined {
  const list = r.authorList?.author;
  if (list?.length) {
    return list.slice(0, 30).map((a) => {
      if (a.lastName) return { family: a.lastName, given: a.firstName ?? a.initials };
      return { literal: a.collectiveName ?? a.fullName ?? "" };
    });
  }
  // "lite" results: "van Wijk EV, de Jonge M." (family first, then initials)
  const flat = r.authorString?.replace(/\.\s*$/, "");
  if (!flat) return undefined;
  return flat
    .split(/,\s*/)
    .filter(Boolean)
    .slice(0, 30)
    .map((name) => {
      const m = name.match(/^(.+?)\s+([A-Z]{1,4})$/);
      return m ? { family: m[1], given: m[2].split("").join(". ") + "." } : { literal: name };
    });
}

/** Europe PMC abstracts are HTML: "<h4>Background</h4>Text…". Keep the headings as plain "Background: ". */
export function europePmcAbstract(html: string | null | undefined): string | undefined {
  if (!html) return undefined;
  const text = stripTags(html.replace(/<h\d[^>]*>\s*([^<]{1,60}?)\s*:?\s*<\/h\d>/gi, " $1: "));
  return text.length > 40 ? text : undefined;
}

function cslType(r: EuropePmcResult): string {
  const types = (r.pubTypeList?.pubType ?? (r.pubType ? r.pubType.split(/;\s*/) : [])).map((t) => t.toLowerCase());
  if (r.source === "PPR" || types.includes("preprint")) return "article";
  if (types.includes("book") || types.includes("books and documents")) return "book";
  if (types.includes("book chapter")) return "chapter";
  if (types.includes("thesis")) return "thesis";
  return "article-journal";
}

export function europePmcIsPreprint(r: EuropePmcResult): boolean {
  const types = r.pubTypeList?.pubType ?? (r.pubType ? r.pubType.split(/;\s*/) : []);
  return r.source === "PPR" || types.some((t) => t.toLowerCase() === "preprint");
}

/** A page where anyone can read the paper, when Europe PMC knows of one. */
export function europePmcOpenAccessUrl(r: EuropePmcResult): string | null {
  const pmcid = normalizePmcid(r.pmcid);
  if (pmcid && r.isOpenAccess === "Y") return `https://europepmc.org/articles/${pmcid}`;
  const free = r.fullTextUrlList?.fullTextUrl?.find((u) => u.url && (u.availabilityCode === "OA" || u.availabilityCode === "F"));
  return free?.url ?? null;
}

export function europePmcToCsl(r: EuropePmcResult): CslItem {
  return tidyCsl(europePmcToCslRaw(r));
}

function europePmcToCslRaw(r: EuropePmcResult): CslItem {
  const doi = r.doi ? r.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase() : undefined;
  const year = Number(r.pubYear) || r.journalInfo?.yearOfPublication || r.bookOrReportDetails?.yearOfPublication;
  const pmcid = normalizePmcid(r.pmcid) ?? undefined;
  const preprint = europePmcIsPreprint(r);
  return {
    id: doi ?? `epmc:${r.source}:${r.id}`,
    type: cslType(r),
    title: cleanTitle(r.title),
    author: authors(r),
    issued: year ? { "date-parts": [[year]] } : undefined,
    "container-title": r.journalInfo?.journal?.title ?? r.journalTitle ?? undefined,
    "container-title-short": r.journalInfo?.journal?.isoabbreviation ?? r.journalInfo?.journal?.medlineAbbreviation ?? undefined,
    publisher: r.bookOrReportDetails?.publisher ?? undefined,
    volume: r.journalInfo?.volume ?? r.journalVolume ?? undefined,
    issue: r.journalInfo?.issue ?? r.issue ?? undefined,
    page: r.pageInfo ?? undefined,
    DOI: doi,
    URL: doi ? `https://doi.org/${doi}` : `https://europepmc.org/abstract/${r.source}/${r.id}`,
    abstract: europePmcAbstract(r.abstractText),
    language: r.language ?? undefined,
    PMID: r.pmid ?? undefined,
    PMCID: pmcid,
    genre: preprint ? "preprint" : undefined,
  };
}

/** Free text from a plan query → safe Europe PMC query text (its syntax gives : " ( ) [ ] special meaning). */
function safeTerms(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\b(AND|OR|NOT)\b/g, (m) => m.toLowerCase())
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export interface EuropePmcSearchOptions {
  pageSize?: number;
  fromYear?: number | null;
  toYear?: number | null;
  allowPreprints?: boolean;
}

/** A focused search that finds fewer papers than this is topped up from the broad search. */
const FOCUSED_ENOUGH = 3;

/**
 * Europe PMC's plain search also matches the full text of every paper and lists the newest
 * first, which buries the papers that are actually about the topic. So:
 *  - "focused" (default): each of the first five key terms must be in the title, or each in
 *    the abstract, and the record must have an abstract. Precise, but exact-word matching
 *    makes it narrow.
 *  - "broad": the plain all-fields search, used to top up when the focused one finds
 *    fewer than three papers.
 * Both ask for records with a DOI (no DOI, no citation).
 */
export function europePmcQuery(query: string, opts: EuropePmcSearchOptions & { mode?: "focused" | "broad" } = {}): string {
  const terms = keyTerms(query, 5).join(" ");
  const focused = opts.mode !== "broad" && Boolean(terms);
  const parts = [focused ? `(TITLE:(${terms}) OR ABSTRACT:(${terms}))` : `(${safeTerms(query)})`];
  if (opts.fromYear || opts.toYear) parts.push(`PUB_YEAR:[${opts.fromYear ?? 1500} TO ${opts.toYear ?? 3000}]`);
  parts.push("HAS_DOI:y");
  if (focused) parts.push("HAS_ABSTRACT:y");
  return parts.join(" AND ") + (opts.allowPreprints === false ? " NOT SRC:PPR" : "");
}

async function europePmcQueryOnce(q: string, pageSize: number): Promise<EuropePmcResult[]> {
  const r = await getCached<{ resultList?: { result?: EuropePmcResult[] } }>(
    `${BASE}/search?${qs({ query: q, format: "json", resultType: "core", pageSize })}`,
    // No retry, and a rest after a time-out: when Europe PMC is slow it is slow for minutes,
    // and a second 12-second wait would only hold the whole search up.
    { timeoutMs: 12000, retries: 0, cooldownOnTimeoutMs: 3 * 60_000 },
  );
  return r.data?.resultList?.result ?? [];
}

export async function europePmcSearch(query: string, opts: EuropePmcSearchOptions = {}): Promise<EuropePmcResult[]> {
  if (!safeTerms(query)) return [];
  const focused = europePmcQuery(query, { ...opts, mode: "focused" });
  const broad = europePmcQuery(query, { ...opts, mode: "broad" });
  const pageSize = opts.pageSize ?? 10;
  const hits = await europePmcQueryOnce(focused, pageSize);
  if (hits.length >= FOCUSED_ENOUGH || focused === broad) return hits;
  // The focused hits were hard to find: keep them even if the top-up cannot be fetched.
  const more = await europePmcQueryOnce(broad, pageSize).catch((err) => {
    if (hits.length) return [] as EuropePmcResult[];
    throw err;
  });
  const seen = new Set(hits.map((h) => `${h.source}:${h.id}`));
  return [...hits, ...more.filter((m) => !seen.has(`${m.source}:${m.id}`))].slice(0, pageSize);
}

/** The PMCID of the open-access full text for a DOI, or null when Europe PMC has none. */
export async function europePmcOpenAccessPmcid(doi: string): Promise<string | null> {
  const clean = doi.replace(/"/g, "").trim();
  if (!clean) return null;
  const r = await getCached<{ resultList?: { result?: EuropePmcResult[] } }>(
    `${BASE}/search?${qs({ query: `DOI:"${clean}" AND OPEN_ACCESS:y`, format: "json", resultType: "lite", pageSize: 3 })}`,
    { timeoutMs: 10000, retries: 0, cooldownOnTimeoutMs: 3 * 60_000 },
  );
  for (const hit of r.data?.resultList?.result ?? []) {
    if (hit.doi?.toLowerCase() !== clean.toLowerCase()) continue;
    const pmcid = normalizePmcid(hit.pmcid);
    if (pmcid) return pmcid;
  }
  return null;
}

/** URL of the JATS XML full text (open-access subset only; 404 otherwise). */
export function europePmcFullTextUrl(pmcid: string): string {
  return `${BASE}/${pmcid}/fullTextXML`;
}
