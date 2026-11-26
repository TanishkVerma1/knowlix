/** DOI / ISBN / arXiv helpers. Pure functions, used on both client and server. */

/**
 * A DOI token: "10.<registrant>/<suffix>". The separator may still be percent-encoded ("%2F") when
 * the DOI was copied out of a URL. Old Wiley SICI / AMS DOIs legitimately contain < > ; : so those
 * are allowed; the token stops at whitespace, a double quote or a character no DOI contains.
 */
const DOI_TOKEN = /10\.\d{4,9}(?:\/|%2F)[^\s"“”{}|\\^`\]]+/i;

/** Decodes %XX escapes. A malformed escape is left exactly as typed instead of throwing. */
function safeDecode(s: string): string {
  if (!s.includes("%")) return s;
  try {
    return decodeURIComponent(s);
  } catch {
    return s.replace(/(?:%[0-9a-f]{2})+/gi, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        return m;
      }
    });
  }
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

const CLOSERS: Record<string, string> = { ")": "(", "]": "[", ">": "<" };

/** Strip trailing punctuation that is not part of the DOI, keeping balanced brackets. */
function trimDoi(doi: string): string {
  // Markup after the DOI ("10.1038/x</a>") is not part of it; neither is a "<" that never closes.
  let d = doi.replace(/<\/.*$/, "");
  for (;;) {
    const open = d.lastIndexOf("<");
    if (open === -1 || d.indexOf(">", open) !== -1) break;
    d = d.slice(0, open);
  }
  for (;;) {
    const last = d[d.length - 1];
    if (!last) break;
    if (".,;:'\"’”".includes(last)) {
      d = d.slice(0, -1);
      continue;
    }
    const opener = CLOSERS[last];
    if (opener && count(d, last) > count(d, opener)) {
      d = d.slice(0, -1);
      continue;
    }
    break;
  }
  return d;
}

/** Finds the first DOI in a string and cleans it (URL query / fragment, percent-escapes, trailing punctuation). */
function findDoi(text: string): string | null {
  const m = text.match(DOI_TOKEN);
  if (!m || m.index === undefined) return null;
  // Was it written as a link? Look at the run of non-space characters just before the DOI.
  const lead = text.slice(0, m.index).match(/\S*$/)?.[0] ?? "";
  const fromUrl = /https?:\/\/|doi\.org\//i.test(lead);
  let d = m[0];
  // "?" is never part of a real DOI: what follows is a URL query string (?utm_source=…).
  d = d.replace(/\?.*$/, "");
  // "#…" is a page anchor when the DOI came from a link, or when it reads like one (#Abs1, #Sec2, #citeas).
  d = fromUrl ? d.replace(/#.*$/, "") : d.replace(/#[A-Za-z][\w.:=-]*$/, "");
  d = safeDecode(d);
  // Decoding can reveal a space or quote (%20, %22): the DOI ends there.
  const again = d.match(/^10\.\d{4,9}\/[^\s"“”{}|\\^`\]]+/);
  if (!again) return null;
  const out = trimDoi(again[0]).toLowerCase();
  return /^10\.\d{4,9}\/./.test(out) ? out : null;
}

export function normalizeDoi(input: string | null | undefined): string | null {
  if (!input) return null;
  return findDoi(String(input).trim());
}

export function extractDoi(text: string): string | null {
  return text ? findDoi(text) : null;
}

export function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}

function isbn10Valid(d: string): boolean {
  if (!/^\d{9}[\dX]$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (d[i] === "X" ? 10 : Number(d[i])) * (10 - i);
  return sum % 11 === 0;
}

function isbn13Valid(d: string): boolean {
  if (!/^\d{13}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(d[i]) * (i % 2 === 0 ? 1 : 3);
  return sum % 10 === 0;
}

export function normalizeIsbn(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = input.toUpperCase().replace(/[^0-9X]/g, "");
  if (d.length === 13 && isbn13Valid(d)) return d;
  if (d.length === 10 && isbn10Valid(d)) return d;
  return null;
}

export function extractIsbn(text: string): string | null {
  const m = text.match(/ISBN(?:-1[03])?:?\s*((?:97[89][\s-]?)?(?:\d[\s-]?){9}[\dXx])/i);
  if (m) return normalizeIsbn(m[1]);
  const bare = text.match(/\b(97[89][\d-]{10,14})\b/);
  if (bare) {
    const n = normalizeIsbn(bare[1]);
    if (n) return n;
  }
  // Unlabelled ISBN-10. Ten digits are easily something else, so the check digit must be right and the
  // number must either be hyphenated like an ISBN (0-262-03384-4) or be the only thing on the line.
  const outside = text.replace(/https?:\/\/\S+/gi, " ").replace(/10\.\d{4,9}\/\S+/g, " ");
  const hyphenated = outside.match(/(?:^|[^\w./-])(\d{1,5}-\d{1,7}-\d{1,7}-[\dXx])(?![\w-])/);
  if (hyphenated) {
    const n = normalizeIsbn(hyphenated[1]);
    if (n) return n;
  }
  const alone = text.trim().replace(/[.,;]+$/, "");
  if (/^\d{9}[\dXx]$/.test(alone)) return normalizeIsbn(alone);
  return null;
}

/** arXiv archives that used the pre-2007 identifier scheme "archive/YYMMNNN" (hep-th/9711200). */
const ARXIV_OLD =
  "(astro-ph|cond-mat|gr-qc|hep-ex|hep-lat|hep-ph|hep-th|math-ph|nlin|nucl-ex|nucl-th|physics|quant-ph|math|cs|q-bio|q-fin|stat|alg-geom|adap-org|chao-dyn|cmp-lg|comp-gas|dg-ga|funct-an|mtrl-th|patt-sol|q-alg|solv-int|supr-con|acc-phys|ao-sci|atom-ph|bayes-an|chem-ph|plasm-ph)(?:\\.[A-Za-z]{2}(?:-[A-Za-z]+)?)?\\/(\\d{7})";
const ARXIV_OLD_LABELLED = new RegExp(`arxiv(?:\\.org\\/(?:abs|pdf)\\/|:\\s*|\\s+|\\.)${ARXIV_OLD}`, "i");
const ARXIV_OLD_BARE = new RegExp(`(?:^|[\\s(\\[,;])${ARXIV_OLD}(?:v\\d+)?(?=$|[\\s)\\].,;])`);

/**
 * New-style ids come back as "1706.03762"; old-style ones as "hep-th/9711200" (the subject class of
 * "math.GT/0309136" is dropped: arXiv's canonical id, and its DOI 10.48550/arXiv.math/0309136, omit it).
 */
export function extractArxivId(text: string): string | null {
  const m =
    text.match(/arxiv(?:\.org\/(?:abs|pdf)\/|:\s*|\s+)(\d{4}\.\d{4,5})(?:v\d+)?/i) ??
    text.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i);
  if (m) return m[1];
  const old = text.match(ARXIV_OLD_LABELLED) ?? text.match(ARXIV_OLD_BARE);
  return old ? `${old[1].toLowerCase()}/${old[2]}` : null;
}

export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"]+[^\s<>".,;)]/i);
  return m ? m[0] : null;
}

/** Known preprint DOI prefixes (arXiv, bioRxiv/medRxiv, PsyArXiv/OSF, SSRN, Research Square, Preprints.org, TechRxiv, ChemRxiv). */
export const PREPRINT_PREFIXES = ["10.48550", "10.31234", "10.31219", "10.31235", "10.2139", "10.21203", "10.20944", "10.36227", "10.26434", "10.31222"];

export function isPreprintDoi(doi: string | null | undefined): boolean {
  if (!doi) return false;
  const d = doi.toLowerCase();
  // 10.1101 is shared by bioRxiv/medRxiv (date-style suffixes) and Cold Spring Harbor journals (gad., gr., …).
  if (d.startsWith("10.1101/")) return /^10\.1101\/(\d{4}\.\d{2}\.\d{2}\.\d+|\d{6})/.test(d);
  return PREPRINT_PREFIXES.some((p) => d.startsWith(p + "/"));
}
