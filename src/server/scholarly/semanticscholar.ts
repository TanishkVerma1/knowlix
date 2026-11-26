import "server-only";
import type { CslItem } from "@/shared/types";
import { isPreprintDoi } from "@/shared/identifiers";
import { env } from "../env";
import { getCached, qs } from "./http";
import { cleanTitle, splitFullName, stripTags, tidyCsl } from "./csl";
import { normalizePmcid } from "./europepmc";

/*
 * Semantic Scholar Graph API: https://api.semanticscholar.org/api-docs/graph
 * Works without a key, but the keyless pool is shared by everyone and often
 * answers 429. With SEMANTIC_SCHOLAR_API_KEY the limit is 1 request per second.
 */

export const SEMANTIC_SCHOLAR_HOST = "api.semanticscholar.org";
const BASE = `https://${SEMANTIC_SCHOLAR_HOST}/graph/v1`;

export interface SemanticScholarPaper {
  paperId: string;
  title?: string | null;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  publicationDate?: string | null;
  authors?: { authorId?: string | null; name?: string | null }[];
  externalIds?: { DOI?: string; ArXiv?: string; PubMed?: string; PubMedCentral?: string; CorpusId?: number } | null;
  citationCount?: number | null;
  /** status: GOLD | GREEN | HYBRID | BRONZE | CLOSED | null. The url is "" when there is no PDF. */
  openAccessPdf?: { url?: string | null; status?: string | null } | null;
  publicationTypes?: string[] | null;
  journal?: { name?: string | null; volume?: string | null; pages?: string | null } | null;
}

const FIELDS = "title,abstract,year,venue,authors,externalIds,citationCount,openAccessPdf,publicationTypes,journal,publicationDate";

function headers(): Record<string, string> | undefined {
  return env.semanticScholarKey ? { "x-api-key": env.semanticScholarKey } : undefined;
}

/** Semantic Scholar gives arXiv papers an arXiv ID but often no DOI; every arXiv paper has the DOI 10.48550/arXiv.<id>. */
export function semanticScholarDoi(p: SemanticScholarPaper): string | undefined {
  const doi = p.externalIds?.DOI?.trim().toLowerCase();
  if (doi) return doi;
  const arxiv = p.externalIds?.ArXiv?.trim().toLowerCase();
  return arxiv ? `10.48550/arxiv.${arxiv}` : undefined;
}

export function semanticScholarIsPreprint(p: SemanticScholarPaper): boolean {
  const doi = semanticScholarDoi(p);
  return isPreprintDoi(doi) || /\b(arxiv|biorxiv|medrxiv|ssrn|psyarxiv|preprint)/i.test(`${p.venue ?? ""} ${p.journal?.name ?? ""}`);
}

function cslType(p: SemanticScholarPaper, preprint: boolean): string {
  if (preprint) return "article";
  const t = p.publicationTypes ?? [];
  if (t.includes("JournalArticle") || t.includes("Review")) return "article-journal";
  if (t.includes("Conference")) return "paper-conference";
  if (t.includes("Book")) return "book";
  if (t.includes("BookSection")) return "chapter";
  if (t.includes("Dataset")) return "dataset";
  return "article-journal";
}

/**
 * A link to a free copy, when Semantic Scholar is sure of one. Links it marks
 * CLOSED (or does not classify) are ignored: live data shows they can point at
 * a different paper's PDF, and a wrong link is worse than none.
 */
export function semanticScholarOpenAccessUrl(p: SemanticScholarPaper): string | null {
  const url = p.openAccessPdf?.url?.trim();
  if (url && /^(gold|green|hybrid|bronze)$/i.test(p.openAccessPdf?.status ?? "")) return url;
  const arxiv = p.externalIds?.ArXiv?.trim();
  return arxiv ? `https://arxiv.org/abs/${arxiv}` : null;
}

export function semanticScholarToCsl(p: SemanticScholarPaper): CslItem {
  return tidyCsl(semanticScholarToCslRaw(p));
}

function semanticScholarToCslRaw(p: SemanticScholarPaper): CslItem {
  const doi = semanticScholarDoi(p);
  const preprint = semanticScholarIsPreprint(p);
  const year = p.year ?? (p.publicationDate ? Number(p.publicationDate.slice(0, 4)) || undefined : undefined);
  const abstract = stripTags(p.abstract);
  const venue = p.journal?.name?.trim() || p.venue?.trim() || undefined;
  return {
    id: doi ?? `s2:${p.paperId}`,
    type: cslType(p, preprint),
    title: cleanTitle(p.title),
    author: (p.authors ?? [])
      .filter((a) => a.name)
      .slice(0, 30)
      .map((a) => splitFullName(a.name!)),
    issued: year ? { "date-parts": [[year]] } : undefined,
    "container-title": venue,
    volume: p.journal?.volume?.trim() || undefined,
    page: p.journal?.pages?.replace(/\s+/g, "") || undefined,
    DOI: doi,
    URL: doi ? `https://doi.org/${doi}` : `https://www.semanticscholar.org/paper/${p.paperId}`,
    abstract: abstract.length > 40 ? abstract : undefined,
    PMID: p.externalIds?.PubMed ?? undefined,
    PMCID: normalizePmcid(p.externalIds?.PubMedCentral) ?? undefined,
    semanticscholar: p.paperId,
    genre: preprint ? "preprint" : undefined,
  };
}

function yearRange(fromYear?: number | null, toYear?: number | null): string | undefined {
  if (!fromYear && !toYear) return undefined;
  return `${fromYear ?? ""}-${toYear ?? ""}`;
}

/** Relevance search. Throws UpstreamError (status 429) when the shared pool is busy; the host is then rested. */
export async function semanticScholarSearch(
  query: string,
  opts: { limit?: number; fromYear?: number | null; toYear?: number | null } = {},
): Promise<SemanticScholarPaper[]> {
  // The search endpoint treats "-" and "+" as operators in some positions; plain words are safest.
  const clean = query.replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!clean) return [];
  const r = await getCached<{ total?: number; data?: SemanticScholarPaper[] }>(
    `${BASE}/paper/search?${qs({ query: clean, limit: Math.min(opts.limit ?? 10, 100), year: yearRange(opts.fromYear, opts.toYear), fields: FIELDS })}`,
    {
      timeoutMs: 12000,
      headers: headers(),
      // Without a key one quick second try is worth it; after that, leave the shared pool alone for a while.
      retries: 1,
      cooldownOn429Ms: env.semanticScholarKey ? 20_000 : 2 * 60_000,
      cooldownOnTimeoutMs: 2 * 60_000,
    },
  );
  return r.data?.data ?? [];
}

/** One paper by DOI (used by the health check). Null when Semantic Scholar does not have it. */
export async function semanticScholarByDoi(doi: string): Promise<SemanticScholarPaper | null> {
  const r = await getCached<SemanticScholarPaper>(`${BASE}/paper/DOI:${doi.split("/").map(encodeURIComponent).join("/")}?${qs({ fields: "title,year,externalIds" })}`, {
    okStatuses: [404],
    timeoutMs: 9000,
    headers: headers(),
    // No cooldown here: a busy answer to the health check must not put the search adapter to rest.
    retries: 0,
  });
  return r.data;
}
