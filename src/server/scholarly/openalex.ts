import "server-only";
import type { CslItem } from "@/shared/types";
import { env } from "../env";
import { getCached, qs } from "./http";
import { cleanTitle, tidyCsl } from "./csl";

/* OpenAlex: https://api.openalex.org — open catalogue of ~250M works. */

export const OPENALEX_HOST = "api.openalex.org";
/**
 * Searches and lists cost money from a daily budget (tiny without a key); single-record
 * look-ups are free. When the budget is spent only this scope rests, so `openAlexByDoi`
 * (Lock 1's second opinion and its abstracts) keeps working for the rest of the day.
 */
export const OPENALEX_PAID_SCOPE = "paid";

export interface OpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  publication_date?: string | null;
  type?: string | null;
  language?: string | null;
  authorships?: { author: { display_name: string; id?: string }; raw_author_name?: string }[];
  primary_location?: {
    source?: { display_name?: string; host_organization_name?: string; type?: string } | null;
    landing_page_url?: string | null;
    pdf_url?: string | null;
    version?: string | null;
  } | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null; oa_status?: string } | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  cited_by_count?: number;
  is_retracted?: boolean;
  is_paratext?: boolean;
  referenced_works?: string[];
  related_works?: string[];
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null };
  ids?: { isbn?: string } & Record<string, string>;
}

const SELECT =
  "id,doi,title,display_name,publication_year,publication_date,type,language,authorships,primary_location,open_access,abstract_inverted_index,cited_by_count,is_retracted,referenced_works,related_works,biblio";

function auth() {
  return {
    ...(env.openAlexKey ? { api_key: env.openAlexKey } : {}),
    ...(env.contactEmail ? { mailto: env.contactEmail } : {}),
  };
}

export function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string | null {
  if (!inv) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inv)) for (const p of positions) words[p] = word;
  const text = words.filter((w) => w !== undefined).join(" ").replace(/\s+([.,;:!?])/g, "$1").trim();
  return text.length > 40 ? text : null;
}

const TYPE_MAP: Record<string, string> = {
  article: "article-journal",
  "journal-article": "article-journal",
  preprint: "article",
  book: "book",
  "book-chapter": "chapter",
  dissertation: "thesis",
  dataset: "dataset",
  review: "article-journal",
  report: "report",
  "proceedings-article": "paper-conference",
};

function splitName(full: string) {
  if (full.includes(",")) {
    const [family, given] = full.split(",").map((s) => s.trim());
    return { family, given: given || undefined };
  }
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

export function shortId(openAlexId: string): string {
  return openAlexId.replace(/^https?:\/\/openalex\.org\//i, "");
}

export function openAlexToCsl(w: OpenAlexWork): CslItem {
  return tidyCsl(openAlexToCslRaw(w));
}

function openAlexToCslRaw(w: OpenAlexWork): CslItem {
  const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() : undefined;
  const pages = w.biblio?.first_page ? [w.biblio.first_page, w.biblio.last_page].filter(Boolean).join("–") : undefined;
  const isConference = w.primary_location?.source?.type === "conference";
  return {
    id: doi ?? shortId(w.id),
    type: isConference ? "paper-conference" : (TYPE_MAP[w.type ?? ""] ?? "article-journal"),
    title: cleanTitle(w.title ?? w.display_name ?? ""),
    author: (w.authorships ?? []).slice(0, 30).map((a) => splitName(a.author.display_name)),
    issued: w.publication_year ? { "date-parts": [[w.publication_year]] } : undefined,
    "container-title": w.primary_location?.source?.display_name ?? undefined,
    publisher: w.primary_location?.source?.host_organization_name ?? undefined,
    volume: w.biblio?.volume ?? undefined,
    issue: w.biblio?.issue ?? undefined,
    page: pages,
    DOI: doi,
    URL: doi ? `https://doi.org/${doi}` : (w.primary_location?.landing_page_url ?? undefined),
    abstract: reconstructAbstract(w.abstract_inverted_index) ?? undefined,
    language: w.language ?? undefined,
    openalex: shortId(w.id),
    genre: w.type === "preprint" ? "preprint" : undefined,
  };
}

export async function openAlexByDoi(doi: string): Promise<OpenAlexWork | null> {
  const r = await getCached<OpenAlexWork>(
    `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?${qs({ select: SELECT, ...auth() })}`,
    { okStatuses: [404], timeoutMs: 9000 },
  );
  return r.data;
}

export async function openAlexSearch(
  query: string,
  opts: { perPage?: number; fromYear?: number | null; toYear?: number | null; allowPreprints?: boolean } = {},
): Promise<OpenAlexWork[]> {
  const filter = [
    opts.fromYear ? `from_publication_date:${opts.fromYear}-01-01` : null,
    opts.toYear ? `to_publication_date:${opts.toYear}-12-31` : null,
    opts.allowPreprints === false ? "type:article|review|book|book-chapter" : "type:article|review|book|book-chapter|preprint",
    "is_paratext:false",
  ]
    .filter(Boolean)
    .join(",");
  const r = await getCached<{ results: OpenAlexWork[] }>(
    `https://api.openalex.org/works?${qs({ search: query.slice(0, 300), filter, "per-page": opts.perPage ?? 10, select: SELECT, ...auth() })}`,
    { timeoutMs: 12000, rateLimitScope: OPENALEX_PAID_SCOPE },
  );
  return r.data?.results ?? [];
}

export async function openAlexTitleSearch(title: string, perPage = 5): Promise<OpenAlexWork[]> {
  const clean = title.replace(/[,:|!?()"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 250);
  if (!clean) return [];
  const r = await getCached<{ results: OpenAlexWork[] }>(
    `https://api.openalex.org/works?${qs({ filter: `title.search:${clean}`, "per-page": perPage, select: SELECT, ...auth() })}`,
    { timeoutMs: 10000, rateLimitScope: OPENALEX_PAID_SCOPE },
  );
  return r.data?.results ?? [];
}

/** Fetch up to 50 works by OpenAlex ID in one request. */
export async function openAlexByIds(ids: string[]): Promise<OpenAlexWork[]> {
  const clean = ids.map(shortId).filter(Boolean).slice(0, 50);
  if (!clean.length) return [];
  const r = await getCached<{ results: OpenAlexWork[] }>(
    `https://api.openalex.org/works?${qs({ filter: `openalex:${clean.join("|")}`, "per-page": 50, select: SELECT, ...auth() })}`,
    { timeoutMs: 12000, rateLimitScope: OPENALEX_PAID_SCOPE },
  );
  return r.data?.results ?? [];
}

export async function openAlexCitedBy(id: string, perPage = 12): Promise<OpenAlexWork[]> {
  const r = await getCached<{ results: OpenAlexWork[] }>(
    `https://api.openalex.org/works?${qs({ filter: `cites:${shortId(id)}`, sort: "cited_by_count:desc", "per-page": perPage, select: SELECT, ...auth() })}`,
    { timeoutMs: 12000, rateLimitScope: OPENALEX_PAID_SCOPE },
  );
  return r.data?.results ?? [];
}
