/**
 * A formatted reference list with its italics. The citation formatter's HTML is
 * reduced to plain text plus five harmless inline tags, so it can be shown on
 * screen, copied into a word processor, or saved as a Word-readable file.
 */

const ALLOWED = /<(\/?)(i|em|b|sup|sub)>/gi;

/** Keeps only <i> <em> <b> <sup> <sub> (no attributes); every other tag is dropped and stray angle brackets are escaped. */
export function safeInline(html: string): string {
  const kept: string[] = [];
  const marked = html.replace(ALLOWED, (_m, slash: string, tag: string) => {
    kept.push(`<${slash}${tag.toLowerCase()}>`);
    return `\u0000${kept.length - 1}\u0000`;
  });
  const stripped = marked.replace(/<[^>]*>/g, "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return stripped.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => kept[Number(n)]).trim();
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The entries of a citeproc HTML bibliography, in its order, each as safe inline HTML keyed by item id. */
export function bibliographyEntries(html: string): { id: string; html: string }[] {
  // Numbered styles nest more <div>s inside an entry, so entries are cut at their opening tags, not matched as pairs.
  return html
    .split(/<div[^>]*data-csl-entry-id="/)
    .slice(1)
    .map((chunk) => {
      const id = chunk.slice(0, chunk.indexOf('"'));
      const body = chunk.slice(chunk.indexOf(">") + 1).replace(/<\/div>/g, " ");
      return { id, html: safeInline(body).replace(/\s+/g, " ").trim() };
    });
}

/** One paragraph per reference. */
export function entriesToHtml(entries: string[]): string {
  return entries.map((e) => `<p>${e}</p>`).join("");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function rtfText(s: string): string {
  let out = "";
  for (const ch of decodeEntities(s)) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\" || ch === "{" || ch === "}") out += `\\${ch}`;
    else if (code < 128) out += ch;
    else {
      // RTF takes UTF-16 units as signed 16-bit numbers.
      for (let i = 0; i < ch.length; i++) {
        const unit = ch.charCodeAt(i);
        out += `\\u${unit > 32767 ? unit - 65536 : unit}?`;
      }
    }
  }
  return out;
}

const RTF_OPEN: Record<string, string> = { i: "{\\i ", em: "{\\i ", b: "{\\b ", sup: "{\\super ", sub: "{\\sub " };

/**
 * The reference list as a .rtf file, which Word, Pages and Google Docs open:
 * Times New Roman 12, double spaced, with the hanging indent APA asks for.
 */
export function referencesRtf(html: string, heading = "References"): string {
  const paragraphs = html
    .split(/<\/p>/i)
    .map((p) => p.replace(/^\s*<p>/i, "").trim())
    .filter(Boolean)
    .map((p) =>
      p
        .split(/(<\/?(?:i|em|b|sup|sub)>)/i)
        .map((piece) => {
          const tag = piece.match(/^<(\/?)(i|em|b|sup|sub)>$/i);
          if (!tag) return rtfText(piece);
          return tag[1] ? "}" : RTF_OPEN[tag[2].toLowerCase()];
        })
        .join(""),
    );
  return [
    "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}}",
    "\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440\\f0\\fs24",
    `\\pard\\qc\\sl480\\slmult1 {\\b ${rtfText(heading)}}\\par`,
    ...paragraphs.map((p) => `\\pard\\ql\\li720\\fi-720\\sl480\\slmult1 ${p}\\par`),
    "}",
  ].join("\n");
}
