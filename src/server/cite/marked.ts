import "server-only";
import type { CslItem } from "@/shared/types";
import type { CitationStyleId } from "@/shared/policy";
import { entriesToHtml, escapeHtml } from "@/shared/rich-refs";
import { formatBibliography, formatBibliographyHtml, formatEach, formatEachHtml } from "./citeproc";

const NUMBERED: CitationStyleId[] = ["ieee", "vancouver"];

/**
 * A formatted reference list in which warnings travel with the reference.
 * A confirmed record is formatted in the chosen style. A reference the student
 * kept unconfirmed is printed exactly as they wrote it (re-formatting a
 * best-guess parse could change it). Anything that is not Verified carries its
 * status in square brackets after the entry, in the text and the italic version.
 */
export async function formatMarkedList(records: CslItem[], style: CitationStyleId, opts: { asWritten?: (string | null)[]; marks?: (string | null)[] } = {}): Promise<{ text: string; html: string }> {
  if (!records.length) return { text: "", html: "" };
  const asWritten = opts.asWritten ?? records.map(() => null);
  const marks = opts.marks ?? records.map(() => null);
  if (!asWritten.some(Boolean) && !marks.some(Boolean)) {
    const [text, html] = await Promise.all([formatBibliography(records, style, "text"), formatBibliographyHtml(records, style)]);
    return { text, html };
  }
  const [each, eachHtml] = await Promise.all([formatEach(records, style), formatEachHtml(records, style)]);
  const unnumber = (e: string) => e.replace(/^\s*(?:\[\d+\]|\d+\.)\s*/, "");
  // Each line keeps its plain text and its italic version together, so sorting cannot separate them.
  const lines = each.map((e, i) => {
    const mark = marks[i];
    return {
      text: (asWritten[i] ?? unnumber(e)) + (mark ? ` [${mark}]` : ""),
      html: (asWritten[i] ? escapeHtml(asWritten[i]!) : unnumber(eachHtml[i] || escapeHtml(e))) + (mark ? ` <b>[${escapeHtml(mark)}]</b>` : ""),
    };
  });
  const ordered = NUMBERED.includes(style)
    ? lines.map((l, i) => {
        const n = style === "ieee" ? `[${i + 1}] ` : `${i + 1}. `;
        return { text: n + l.text, html: n + l.html };
      })
    : [...lines].sort((a, b) => a.text.localeCompare(b.text, "en", { sensitivity: "base" }));
  return { text: ordered.map((l) => l.text).join("\n"), html: entriesToHtml(ordered.map((l) => l.html)) };
}
