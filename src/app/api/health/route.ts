import { handle } from "@/server/http/api";
import { pingDb, dbDriver } from "@/server/db/client";
import { aiStatus } from "@/server/agents/providers/status";
import { doiExists } from "@/server/scholarly/doi";
import { crossrefWork } from "@/server/scholarly/crossref";
import { openAlexByDoi } from "@/server/scholarly/openalex";
import { europePmcOpenAccessPmcid } from "@/server/scholarly/europepmc";
import { semanticScholarByDoi } from "@/server/scholarly/semanticscholar";
import { arxivById } from "@/server/scholarly/arxiv";
import { googleBooksIsbn } from "@/server/scholarly/googlebooks";
import { sessionSecretSource, env } from "@/server/env";
import { isRateLimited } from "@/server/scholarly/http";

async function probe(fn: () => Promise<unknown>) {
  const t = Date.now();
  try {
    const v = await fn();
    return { ok: Boolean(v), ms: Date.now() - t };
  } catch (err) {
    return { ok: false, ms: Date.now() - t, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Smoke test: is every part of Knowlix reachable right now? */
export const GET = handle(async () => {
  const doi = "10.1038/nature14539";
  // The newer services are optional extras: they are reported, but never decide `ok`.
  const [db, doiOrg, crossref, openalex, europepmc, semanticscholar, arxiv, googlebooks] = await Promise.all([
    pingDb(),
    probe(async () => (await doiExists(doi)).exists),
    probe(() => crossrefWork(doi)),
    probe(() => openAlexByDoi(doi)),
    probe(() => europePmcOpenAccessPmcid("10.1186/s12909-024-06538-0")), // an open-access paper that is in PubMed Central
    probe(() => semanticScholarByDoi("10.1126/science.1152408")),
    probe(() => arxivById("1706.03762")),
    probe(() => googleBooksIsbn("9780262033848")),
  ]);
  // An answer can come from the cache while the service itself is refusing new requests: say so.
  const resting = (name: string, r: { ok: boolean; ms: number; error?: string }, host: string, scope?: string) =>
    r.ok && isRateLimited(host, scope) ? { ok: false, ms: r.ms, error: `${name} is resting (it asked us to slow down)` } : r;
  const openalexNow = resting("OpenAlex", openalex, "api.openalex.org", "paid");
  const crossrefNow = resting("Crossref", crossref, "api.crossref.org");
  const ai = aiStatus();
  return {
    ok: db.ok && (doiOrg.ok || crossref.ok),
    checkedAt: new Date().toISOString(),
    database: { driver: dbDriver(), ...db },
    services: { "doi.org": doiOrg, crossref: crossrefNow, openalex: openalexNow, europepmc, semanticscholar, arxiv, googlebooks },
    ai: { mode: ai.mode, active: ai.active },
    config: { sessionSecret: sessionSecretSource(), contactEmail: Boolean(env.contactEmail), openAlexKey: Boolean(env.openAlexKey), semanticScholarKey: Boolean(env.semanticScholarKey), googleBooksKey: Boolean(env.googleBooksKey) },
  };
});
