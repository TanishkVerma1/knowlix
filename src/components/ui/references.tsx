"use client";

import { escapeHtml, referencesRtf } from "@/shared/rich-refs";
import { cn, copyText, download } from "@/lib/utils";

/**
 * A formatted reference list shown the way the style prints it: italics where
 * the style asks for them, and a hanging indent. Falls back to plain text when
 * there is no italic version (BibTeX, RIS and the like).
 */
export function ReferenceList({ html, text, className }: { html?: string | null; text: string; className?: string }) {
  if (!html) {
    return <pre className={cn("max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-xl border border-rule bg-paper p-4 font-record text-[0.88rem] leading-relaxed text-ink [overflow-wrap:anywhere]", className)}>{text}</pre>;
  }
  // The HTML is built on the server from the citation formatter and reduced to <p>, <i>, <b>, <sup> and <sub>.
  return <div className={cn("reference-list max-h-[45vh] overflow-auto rounded-xl border border-rule bg-paper p-4 text-[0.95rem] leading-relaxed text-ink [overflow-wrap:anywhere]", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The list as it should land in a word processor: Times New Roman 12, double spaced, hanging indent. */
export function referencesForPaste(html: string): string {
  return `<div style="font-family:'Times New Roman',serif;font-size:12pt">${html.replace(/<p>/g, '<p style="margin:0 0 0 0.5in;text-indent:-0.5in;line-height:2">')}</div>`;
}

export function paragraphsForPaste(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p style="font-family:'Times New Roman',serif;font-size:12pt;line-height:2">${escapeHtml(p.trim())}</p>`)
    .join("");
}

/** Copies with italics for word processors and as plain text for everything else. */
export async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      return true;
    }
  } catch {
    /* fall through to plain text */
  }
  return copyText(text);
}

export function copyReferences(html: string | null | undefined, text: string): Promise<boolean> {
  return html ? copyRich(referencesForPaste(html), text) : copyText(text);
}

/** Saves the list as a file Word, Pages and Google Docs open, with its italics and hanging indent. */
export function downloadForWord(html: string, name = "references") {
  download(`${name}.rtf`, referencesRtf(html), "application/rtf");
}
