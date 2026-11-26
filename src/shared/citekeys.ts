/**
 * Citation keys for the Draft page: a short, readable handle for each library
 * reference, e.g. Hattie2007. In a draft the student writes [@Hattie2007]
 * and Knowlix formats it in the chosen style. A key can only point at a
 * reference that is already in the (checked) library.
 */

export interface KeySource {
  id: string;
  firstAuthor: string | null;
  year: number | null;
  title: string;
  createdAt: string;
}

function ascii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
}

/** id → key. Stable: ties are broken by the order the references were saved. */
export function citeKeys(items: KeySource[]): Map<string, string> {
  const ordered = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const it of ordered) {
    const name = ascii(it.firstAuthor ?? "") || ascii(it.title.split(/\s+/)[0] ?? "") || "Source";
    const base = `${name.charAt(0).toUpperCase()}${name.slice(1, 24)}${it.year ?? "nd"}`;
    const n = used.get(base.toLowerCase()) ?? 0;
    used.set(base.toLowerCase(), n + 1);
    out.set(it.id, n === 0 ? base : `${base}${String.fromCharCode(97 + Math.min(n, 25))}`);
  }
  return out;
}

export interface CiteMarker {
  /** The whole marker as written, e.g. "[@Hattie2007; @Kang2016, p. 4]". */
  raw: string;
  index: number;
  parts: { key: string; locator: string | null }[];
}

const MARKER = /\[\s*@[^\]\n]{1,300}\]/g;

/** Finds every [@Key] marker in a draft. */
export function findMarkers(text: string): CiteMarker[] {
  const out: CiteMarker[] = [];
  for (const m of text.matchAll(MARKER)) {
    const parts = m[0]
      .slice(1, -1)
      .split(";")
      .map((p) => p.trim())
      .filter((p) => p.startsWith("@"))
      .map((p) => {
        const [key, ...rest] = p.slice(1).split(",");
        return { key: key.trim(), locator: rest.join(",").trim() || null };
      })
      .filter((p) => p.key);
    if (parts.length) out.push({ raw: m[0], index: m.index ?? 0, parts });
  }
  return out;
}
