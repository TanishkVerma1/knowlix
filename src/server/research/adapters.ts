import "server-only";
import type { CslItem, PlanQuery } from "@/shared/types";
import { crossrefSearch, crossrefToCsl } from "../scholarly/crossref";
import { OPENALEX_HOST, OPENALEX_PAID_SCOPE, openAlexSearch, openAlexToCsl } from "../scholarly/openalex";
import { EUROPE_PMC_HOST, europePmcIsPreprint, europePmcOpenAccessUrl, europePmcSearch, europePmcToCsl } from "../scholarly/europepmc";
import { SEMANTIC_SCHOLAR_HOST, semanticScholarIsPreprint, semanticScholarOpenAccessUrl, semanticScholarSearch, semanticScholarToCsl } from "../scholarly/semanticscholar";
import { ARXIV_API_HOST, arxivSearch, arxivToCsl } from "../scholarly/arxiv";
import { isRateLimited, UpstreamError } from "../scholarly/http";
import { env } from "../env";

/**
 * Source adapters (seam): each scholarly database is one object with the same
 * shape. A day-of request like "also search PubMed" is one new adapter here.
 */
export interface AdapterHit {
  csl: CslItem;
  citedByCount: number | null;
  openAccessUrl: string | null;
}

export interface SourceAdapter {
  id: string;
  label: string;
  available: () => boolean;
  search: (q: PlanQuery, opts: { allowPreprints: boolean; rows: number }) => Promise<AdapterHit[]>;
}

/**
 * At most this many databases are asked per plan query, so a run with 5
 * queries makes at most 20 searches however many adapters exist. When one of
 * the first four is resting, the next in line takes its place.
 */
export const MAX_ADAPTERS_PER_QUERY = 4;

const openalex: SourceAdapter = {
  id: "openalex",
  label: "OpenAlex",
  // Keyless OpenAlex search has a tiny daily budget; skip it once it says "slow down".
  available: () => !isRateLimited(OPENALEX_HOST, OPENALEX_PAID_SCOPE),
  search: async (q, opts) => {
    const works = await openAlexSearch(q.text, { perPage: opts.rows, fromYear: q.fromYear, toYear: q.toYear, allowPreprints: opts.allowPreprints });
    return works.map((w) => ({ csl: openAlexToCsl(w), citedByCount: w.cited_by_count ?? null, openAccessUrl: w.open_access?.oa_url ?? null }));
  },
};

const crossref: SourceAdapter = {
  id: "crossref",
  label: "Crossref",
  available: () => !isRateLimited("api.crossref.org"),
  search: async (q, opts) => {
    const works = await crossrefSearch(q.text, { rows: opts.rows, fromYear: q.fromYear, toYear: q.toYear });
    return works.map((w) => ({ csl: crossrefToCsl(w), citedByCount: w["is-referenced-by-count"] ?? null, openAccessUrl: null }));
  },
};

const europepmc: SourceAdapter = {
  id: "europepmc",
  label: "Europe PMC",
  available: () => !isRateLimited(EUROPE_PMC_HOST),
  search: async (q, opts) => {
    const hits = await europePmcSearch(q.text, { pageSize: opts.rows, fromYear: q.fromYear, toYear: q.toYear, allowPreprints: opts.allowPreprints });
    return hits
      .filter((r) => opts.allowPreprints || !europePmcIsPreprint(r))
      .map((r) => ({ csl: europePmcToCsl(r), citedByCount: r.citedByCount ?? null, openAccessUrl: europePmcOpenAccessUrl(r) }));
  },
};

const semanticscholar: SourceAdapter = {
  id: "semanticscholar",
  label: "Semantic Scholar",
  // Without a key the pool is shared with everyone; once it says "too many requests" it is rested.
  available: () => !isRateLimited(SEMANTIC_SCHOLAR_HOST),
  search: async (q, opts) => {
    let papers;
    try {
      papers = await semanticScholarSearch(q.text, { limit: opts.rows, fromYear: q.fromYear, toYear: q.toYear });
    } catch (err) {
      // "Too many requests" is the normal state of the keyless pool, not a failure worth reporting:
      // the host is now resting, `available()` is false, and the other databases carry the search.
      if (err instanceof UpstreamError && err.status === 429) return [];
      throw err;
    }
    return papers
      .filter((p) => opts.allowPreprints || !semanticScholarIsPreprint(p))
      .map((p) => ({ csl: semanticScholarToCsl(p), citedByCount: p.citationCount ?? null, openAccessUrl: semanticScholarOpenAccessUrl(p) }));
  },
};

const arxiv: SourceAdapter = {
  id: "arxiv",
  label: "arXiv",
  available: () => !isRateLimited(ARXIV_API_HOST),
  search: async (q, opts) => {
    // Everything on arXiv is a preprint: never asked when the policy excludes them.
    if (!opts.allowPreprints) return [];
    const entries = await arxivSearch(q.text, { maxResults: opts.rows, fromYear: q.fromYear, toYear: q.toYear });
    return entries.map((e) => ({ csl: arxivToCsl(e), citedByCount: null, openAccessUrl: `https://arxiv.org/abs/${e.arxivId}` }));
  },
};

/**
 * Every adapter, best first. Databases that return abstracts lead, because
 * abstracts are what the claim check reads:
 *  1. OpenAlex, when it has its own key (all subjects, abstracts, dependable budget)
 *  2. Semantic Scholar (all subjects, abstracts; often busy without a key)
 *  3. Europe PMC (abstracts and open-access full text; health, life sciences, psychology)
 *  4. Crossref (every subject and always up, but few abstracts)
 *  5. arXiv (abstracts, preprints only: listed only when preprints are allowed)
 *  6. OpenAlex without a key (a small daily budget shared by the whole network: last resort)
 */
export function adapterOrder(opts: { allowPreprints?: boolean } = {}): SourceAdapter[] {
  return [
    ...(env.openAlexKey ? [openalex] : []),
    semanticscholar,
    europepmc,
    crossref,
    ...(opts.allowPreprints ? [arxiv] : []),
    ...(env.openAlexKey ? [] : [openalex]),
  ];
}

/**
 * The adapters to use for a search: the first MAX_ADAPTERS_PER_QUERY that are
 * available right now, in `adapterOrder`. If fewer than that are available,
 * resting ones fill the remaining places so the caller can still tell the
 * student which database was skipped (it checks `available()` before searching).
 *
 * Pass `{ allowPreprints: policy.allowPreprints }` to include arXiv; without
 * it arXiv is left out.
 */
export function adapters(opts: { allowPreprints?: boolean } = {}): SourceAdapter[] {
  const all = adapterOrder(opts);
  const picked = new Set(all.filter((a) => a.available()).slice(0, MAX_ADAPTERS_PER_QUERY));
  for (const a of all) {
    if (picked.size >= MAX_ADAPTERS_PER_QUERY) break;
    picked.add(a);
  }
  return all.filter((a) => picked.has(a));
}
