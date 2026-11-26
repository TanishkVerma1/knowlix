import "server-only";
import type { CslItem, ParsedReference } from "@/shared/types";
import { normalizeDoi, normalizeIsbn } from "@/shared/identifiers";
import { cslVenue, cslYear } from "../scholarly/csl";
import { loadCitationJs } from "../cite/citeproc";
import { parseReference, splitReferences, MAX_REFERENCES } from "./parse";

/** citation-js turns "Springer Science and Business Media LLC" into an array of names: put it back together. */
function oneString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const parts = v.map((x) => oneString(x)).filter((x): x is string => Boolean(x));
    return parts.length ? parts.join(" and ") : undefined;
  }
  if (typeof v === "object") {
    const o = v as { literal?: unknown; family?: unknown; given?: unknown };
    return oneString(o.literal) ?? ([oneString(o.given), oneString(o.family)].filter(Boolean).join(" ") || undefined);
  }
  const s = String(v).trim();
  return s || undefined;
}

/** What citation-js is given: tolerant of the two slips that are safe to repair. */
function candidates(block: string): string[] {
  const src = block.trim();
  if (src.startsWith("@")) {
    // An entry whose closing brace was not pasted.
    const missing = src.split("{").length - src.split("}").length;
    return missing > 0 ? [src, src + "\n" + "}".repeat(missing)] : [src];
  }
  // RIS wants exactly "TY  - " (two spaces); pasting often collapses them to one.
  const ris = src.replace(/^([A-Z][A-Z0-9])[ \t]+-[ \t]*/gm, "$1  - ");
  return [/^ER\s{2}-/m.test(ris) ? ris : `${ris}\nER  - `];
}

/** BibTeX / RIS → CSL via citation-js, then into the same ParsedReference shape as pasted text. */
export async function parseStructured(block: string): Promise<ParsedReference | null> {
  for (const src of candidates(block)) {
    try {
      const { Cite } = await loadCitationJs();
      const cite = await Cite.async(src);
      const first = (cite.data as CslItem[])[0];
      if (!first) continue;
      // Every field used as text below must be ONE string, whatever citation-js made of it.
      const item: CslItem = { ...first, id: first.id ?? "item" };
      for (const key of ["title", "publisher", "container-title", "container-title-short", "publisher-place", "volume", "issue", "page", "DOI", "ISBN", "URL"]) {
        const value = (first as Record<string, unknown>)[key];
        if (value !== undefined && typeof value !== "string") {
          const joined = oneString(value);
          if (joined === undefined) delete (item as Record<string, unknown>)[key];
          else (item as Record<string, unknown>)[key] = joined;
        }
      }
      const title = item.title ? item.title.replace(/[{}]/g, "") : undefined;
      return {
        raw: block.trim(),
        format: block.trim().startsWith("@") ? "bibtex" : "ris",
        title,
        authors: (item.author ?? []).map((a) => ({ family: (a.family ?? a.literal ?? "").replace(/[{}]/g, ""), given: a.given })),
        year: cslYear(item) ?? undefined,
        venue: cslVenue(item) ?? undefined,
        publisher: item.publisher,
        volume: item.volume ? String(item.volume) : undefined,
        issue: item.issue ? String(item.issue) : undefined,
        pages: item.page ? String(item.page) : undefined,
        doi: normalizeDoi(item.DOI ?? null) ?? undefined,
        isbn: normalizeIsbn(item.ISBN ?? null) ?? undefined,
        url: item.URL,
        csl: item,
      };
    } catch {
      /* try the repaired form, if there is one */
    }
  }
  return null;
}

/**
 * Everything a student can paste → a list of parsed references (max 60).
 * `unreadable` counts BibTeX / RIS entries that could not be read; they are not in `items`.
 */
export async function parseInput(text: string): Promise<{ items: ParsedReference[]; truncated: boolean; unreadable: number }> {
  const split = splitReferences(text);
  const items: ParsedReference[] = [];
  let unreadable = 0;
  for (const block of [...split.bibtex, ...split.ris]) {
    const p = await parseStructured(block);
    if (p) items.push(p);
    else unreadable++;
  }
  for (const line of split.plain) items.push(parseReference(line));
  return { items: items.slice(0, MAX_REFERENCES), truncated: items.length > MAX_REFERENCES, unreadable };
}
