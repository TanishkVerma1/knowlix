import "server-only";
import { XMLParser } from "fast-xml-parser";
import type { CslItem } from "@/shared/types";
import { getCached, qs } from "./http";
import { cleanTitle, splitFullName, tidyCsl } from "./csl";
import { keyTerms } from "./terms";

/*
 * arXiv API: https://info.arxiv.org/help/api/user-manual.html (no key, Atom XML).
 * Preprints only: nothing here is peer reviewed, so the research search uses
 * it only when the policy allows preprints.
 */

export const ARXIV_API_HOST = "export.arxiv.org";

export interface ArxivEntry {
  /** New-style "2403.09676" or old-style "hep-th/9901001", without the version. */
  arxivId: string;
  title: string;
  summary: string;
  authors: string[];
  /** Date of the first version, ISO. */
  published: string | null;
  updated: string | null;
  primaryCategory: string | null;
  /** DOI of the published (journal) version, when the authors supplied one. */
  publishedDoi: string | null;
  journalRef: string | null;
}

/** arXiv ORs bare words together, so build an explicit AND of the most telling words. */
export function arxivQuery(query: string, opts: { fromYear?: number | null; toYear?: number | null; maxTerms?: number } = {}): string {
  const terms = keyTerms(query, opts.maxTerms ?? 4);
  if (!terms.length) return "";
  const parts = terms.map((t) => `all:${t.includes("-") ? `"${t}"` : t}`);
  if (opts.fromYear || opts.toYear) parts.push(`submittedDate:[${opts.fromYear ?? 1991}01010000 TO ${opts.toYear ?? 2999}12312359]`);
  return parts.join(" AND ");
}

function text(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return text((v as Record<string, unknown>)["#text"]);
  return String(v).replace(/\s+/g, " ").trim();
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => name === "entry" || name === "author" || name === "link" || name === "category",
});

/** Parses the Atom feed arXiv returns. Pure; returns [] for anything that is not a feed. */
export function parseArxivAtom(xml: string): ArxivEntry[] {
  let doc: { feed?: { entry?: Record<string, unknown>[] } };
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const out: ArxivEntry[] = [];
  for (const e of doc.feed?.entry ?? []) {
    const m = text(e.id).match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/i);
    const title = text(e.title);
    if (!m || !title) continue; // an "Error" entry has no abs link
    out.push({
      arxivId: m[1],
      title,
      summary: text(e.summary),
      authors: ((e.author as { name?: unknown }[] | undefined) ?? []).map((a) => text(a.name)).filter(Boolean),
      published: text(e.published) || null,
      updated: text(e.updated) || null,
      primaryCategory: text((e["arxiv:primary_category"] as Record<string, unknown> | undefined)?.["@_term"]) || null,
      publishedDoi: text(e["arxiv:doi"]).toLowerCase() || null,
      journalRef: text(e["arxiv:journal_ref"]) || null,
    });
  }
  return out;
}

export function arxivDoi(arxivId: string): string {
  return `10.48550/arxiv.${arxivId.toLowerCase()}`;
}

export function arxivToCsl(e: ArxivEntry): CslItem {
  return tidyCsl(arxivToCslRaw(e));
}

function arxivToCslRaw(e: ArxivEntry): CslItem {
  const doi = arxivDoi(e.arxivId);
  const year = e.published ? Number(e.published.slice(0, 4)) || undefined : undefined;
  return {
    id: doi,
    type: "article",
    title: cleanTitle(e.title),
    author: e.authors.slice(0, 30).map(splitFullName),
    issued: year ? { "date-parts": [[year]] } : undefined,
    publisher: "arXiv",
    DOI: doi,
    URL: `https://arxiv.org/abs/${e.arxivId}`,
    abstract: e.summary.length > 40 ? e.summary : undefined,
    genre: "preprint",
    arxiv: e.arxivId,
    publishedDoi: e.publishedDoi ?? undefined,
  };
}

export async function arxivSearch(
  query: string,
  opts: { maxResults?: number; fromYear?: number | null; toYear?: number | null } = {},
): Promise<ArxivEntry[]> {
  const search = arxivQuery(query, opts);
  if (!search) return [];
  const r = await getCached<string>(
    `https://${ARXIV_API_HOST}/api/query?${qs({ search_query: search, start: 0, max_results: opts.maxResults ?? 10, sortBy: "relevance", sortOrder: "descending" })}`,
    { parse: "text", accept: "application/atom+xml", timeoutMs: 12000, retries: 1, cooldownOn429Ms: 60_000, cooldownOnTimeoutMs: 2 * 60_000 },
  );
  return parseArxivAtom(r.data ?? "");
}

/** One paper by arXiv ID (used by the health check). */
export async function arxivById(arxivId: string): Promise<ArxivEntry | null> {
  const r = await getCached<string>(`https://${ARXIV_API_HOST}/api/query?${qs({ id_list: arxivId, max_results: 1 })}`, {
    parse: "text",
    accept: "application/atom+xml",
    timeoutMs: 9000,
    retries: 1,
  });
  return parseArxivAtom(r.data ?? "")[0] ?? null;
}
