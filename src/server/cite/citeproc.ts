import "server-only";
import type { CslItem } from "@/shared/types";
import type { CitationStyleId } from "@/shared/policy";
import { apaSentenceCase } from "@/shared/sentence-case";
import { bibliographyEntries, entriesToHtml } from "@/shared/rich-refs";

/**
 * citation-js + CSL styles. Seam: add a style by dropping its CSL XML into
 * ./styles and registering it below — every export and "Cite" menu picks it up.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CiteModule = { Cite: any; plugins: any };
let loaded: Promise<CiteModule> | null = null;

export function loadCitationJs(): Promise<CiteModule> {
  loaded ??= (async () => {
    // Load core and plugins through ONE CommonJS require so they share a plugin registry
    // (mixing the ESM and CJS builds silently registers plugins on a different instance).
    const { createRequire } = await import("node:module");
    const req = createRequire(`${process.cwd()}/package.json`);
    const { Cite, plugins } = req("@citation-js/core") as CiteModule;
    req("@citation-js/plugin-csl");
    req("@citation-js/plugin-bibtex");
    req("@citation-js/plugin-ris");
    const styles = plugins.config.get("@csl").styles;
    const [mla, chicago, ieee, harvard] = await Promise.all([
      import("./styles/mla"),
      import("./styles/chicago"),
      import("./styles/ieee"),
      import("./styles/harvard"),
    ]);
    styles.add("mla", mla.default);
    styles.add("chicago", chicago.default);
    styles.add("ieee", ieee.default);
    styles.add("harvard-ctr", harvard.default);
    return { Cite, plugins };
  })();
  return loaded;
}

const TEMPLATE: Record<CitationStyleId, string> = {
  apa: "apa",
  mla: "mla",
  harvard: "harvard-ctr",
  chicago: "chicago",
  ieee: "ieee",
  vancouver: "vancouver",
};

function clean(items: CslItem[], style?: CitationStyleId): CslItem[] {
  return items.map((it, i) => {
    // citation-js dislikes our private fields; keep standard CSL only.
    const rest: CslItem & { openalex?: string } = { ...it };
    delete rest.openalex;
    // A catalogue page is where the record was found, not where the book is read: styles should not print it.
    if (typeof rest.URL === "string" && /openlibrary\.org|books\.google\./i.test(rest.URL)) delete rest.URL;
    // APA 7 sets titles in sentence case. The style file cannot do that, so it is done here.
    if (style === "apa" && typeof rest.title === "string") rest.title = apaSentenceCase(rest.title);
    return { ...rest, id: rest.id || `item-${i}` };
  });
}

export async function formatBibliography(items: CslItem[], style: CitationStyleId, format: "text" | "html" = "text"): Promise<string> {
  if (!items.length) return "";
  const { Cite } = await loadCitationJs();
  const cite = new Cite(clean(items, style));
  return cite.format("bibliography", { format, style: TEMPLATE[style], lang: "en-US" }) as string;
}

/** The bibliography with its italics, as safe HTML: one <p> per reference, in the style's order. */
export async function formatBibliographyHtml(items: CslItem[], style: CitationStyleId): Promise<string> {
  if (!items.length) return "";
  try {
    return entriesToHtml(bibliographyEntries(await formatBibliography(items, style, "html")).map((e) => e.html));
  } catch {
    return "";
  }
}

/** One formatted entry per item with its italics, in the same order as the items. */
export async function formatEachHtml(items: CslItem[], style: CitationStyleId): Promise<string[]> {
  const { Cite } = await loadCitationJs();
  return clean(items, style).map((it) => {
    try {
      const html = new Cite([it]).format("bibliography", { format: "html", style: TEMPLATE[style], lang: "en-US" }) as string;
      return bibliographyEntries(html)[0]?.html ?? "";
    } catch {
      return "";
    }
  });
}

/** One formatted entry per item, in the same order (for per-card "Copy citation"). */
export async function formatEach(items: CslItem[], style: CitationStyleId): Promise<string[]> {
  const { Cite } = await loadCitationJs();
  return Promise.all(
    clean(items, style).map(async (it) => {
      try {
        return (new Cite([it]).format("bibliography", { format: "text", style: TEMPLATE[style], lang: "en-US" }) as string).trim();
      } catch {
        return it.title ?? "";
      }
    }),
  );
}

export async function formatInText(items: CslItem[], style: CitationStyleId): Promise<string> {
  const { Cite } = await loadCitationJs();
  return new Cite(clean(items, style)).format("citation", { format: "text", style: TEMPLATE[style], lang: "en-US" }) as string;
}

export async function toBibtex(items: CslItem[]): Promise<string> {
  const { Cite } = await loadCitationJs();
  return new Cite(clean(items)).format("bibtex", { format: "text" }) as string;
}

export async function toRis(items: CslItem[]): Promise<string> {
  const { Cite } = await loadCitationJs();
  return new Cite(clean(items)).format("ris", { format: "text" }) as string;
}
