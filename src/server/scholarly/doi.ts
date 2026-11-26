import "server-only";
import type { CslItem } from "@/shared/types";
import { getCached } from "./http";
import { cleanTitle, stripTags, tidyCsl } from "./csl";

function doiPath(doi: string) {
  return doi.split("/").map(encodeURIComponent).join("/");
}

/**
 * Does this DOI exist in ANY registry (Crossref, DataCite, mEDRA, JaLC…)?
 * Uses the doi.org Handle API: responseCode 1 = exists, 100 = not found.
 * Returns null if doi.org could not be reached (never guess).
 */
export async function doiExists(doi: string): Promise<{ exists: boolean | null; ms: number; error?: string }> {
  const t = Date.now();
  try {
    const r = await getCached<{ responseCode: number }>(`https://doi.org/api/handles/${doiPath(doi)}`, {
      okStatuses: [404],
      timeoutMs: 7000,
    });
    if (r.status === 404) return { exists: false, ms: Date.now() - t };
    const code = r.data?.responseCode;
    if (code === 1) return { exists: true, ms: Date.now() - t };
    if (code === 100 || code === 200) return { exists: false, ms: Date.now() - t };
    return { exists: null, ms: Date.now() - t, error: `doi.org responseCode ${code}` };
  } catch (err) {
    return { exists: null, ms: Date.now() - t, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Which registration agency owns the DOI ("Crossref", "DataCite", …). */
export async function doiAgency(doi: string): Promise<string | null> {
  try {
    const r = await getCached<{ RA?: string }[]>(`https://doi.org/ra/${doiPath(doi)}`, { timeoutMs: 6000, retries: 1 });
    return r.data?.[0]?.RA ?? null;
  } catch {
    return null;
  }
}

/** Metadata for any DOI via content negotiation (works for DataCite/arXiv/Zenodo too). */
export async function doiCsl(doi: string): Promise<CslItem | null> {
  try {
    const r = await getCached<Record<string, unknown>>(`https://doi.org/${doiPath(doi)}`, {
      accept: "application/vnd.citationstyles.csl+json",
      okStatuses: [404, 406],
      timeoutMs: 9000,
    });
    if (!r.data) return null;
    const d = r.data as Record<string, unknown> & CslItem;
    const title = Array.isArray(d.title) ? (d.title as string[])[0] : d.title;
    const container = Array.isArray(d["container-title"]) ? (d["container-title"] as string[])[0] : d["container-title"];
    return tidyCsl({
      ...d,
      id: doi,
      type: typeof d.type === "string" ? d.type : "article",
      title: cleanTitle(title as string | undefined),
      "container-title": container ? stripTags(container as string) : undefined,
      DOI: doi,
      abstract: typeof d.abstract === "string" ? stripTags(d.abstract) : undefined,
    });
  } catch {
    return null;
  }
}
