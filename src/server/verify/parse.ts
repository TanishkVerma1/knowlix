import type { ParsedAuthor, ParsedReference } from "@/shared/types";
import { extractArxivId, extractDoi, extractIsbn, extractUrl, normalizeIsbn } from "@/shared/identifiers";

/**
 * Turns whatever a student pastes into individual references with best-effort
 * fields. Parsing does not need to be perfect: every field is later compared
 * against the real record, and unparsed fields fall back to "is it in the raw
 * text?" checks. Pure functions → unit tested in tests/unit/lock1.test.ts and
 * tests/unit/parse-edge.test.ts.
 */

export const MAX_REFERENCES = 60;

/* ───────────────────────── Shared name patterns ───────────────────────── */

// "Capital" letters of any script. Scripts without case (Han, Arabic, Devanagari…) count as capitals.
const UP = "\\p{Lu}\\p{Lt}\\p{Lo}";
const NAME = `[${UP}][\\p{L}\\p{M}'’\\-]*`;
// One particle word; "van der" / "de la" are two of them. (Kept to single words and bounded repeats so that
// no input can make these patterns backtrack exponentially.)
const PARTICLE_WORD = "(?:van|von|der|den|de|del|della|dello|di|da|das|dos|du|des|le|la|los|las|el|al|bin|ibn|ben|ter|ten|te|af|av|zu|zur)";
const PARTICLE = `(?:${PARTICLE_WORD}(?:\\s+${PARTICLE_WORD})?)`;
const PARTICLE_WORDS = new Set(
  "van von der den de del della dello di da das dos du des le la los las el al bin ibn ben ter ten te af av zu zur y e".split(" "),
);
/** A family name: optional lowercase particles, then one to three capitalised words ("van der Maaten", "Lopez de Castilla", "d'Alembert"). */
const FAMILY = `(?:${PARTICLE_WORD}\\s+){0,3}(?:[dDlL]['’]|al-|el-|['’]t\\s+)?${NAME}(?:\\s+(?:${PARTICLE_WORD}\\s+){0,2}${NAME}){0,2}`;
const INITIALS = "(?:\\p{Lu}(?:-\\p{Lu})?\\.[ \\-]?){1,4}";
const GIVEN = `${NAME}(?:\\s(?:\\p{Lu}\\.|${NAME}))*`;
const YEAR = "(?:1[5-9]\\d\\d|20\\d\\d)";

/* ───────────────────────── Splitting ───────────────────────── */

export interface SplitResult {
  plain: string[];
  bibtex: string[];
  ris: string[];
}

function extractBibtexBlocks(text: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let rest = "";
  let i = 0;
  while (i < text.length) {
    const at = text.slice(i).search(/@[a-zA-Z]+\s*\{/);
    if (at === -1) {
      rest += text.slice(i);
      break;
    }
    rest += text.slice(i, i + at);
    const j = i + at;
    const open = text.indexOf("{", j);
    let depth = 0;
    let k = open;
    for (; k < text.length; k++) {
      if (text[k] === "{") depth++;
      else if (text[k] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    let end = k + 1;
    if (k >= text.length) {
      // The entry never closes. Do not let it swallow everything pasted after it:
      // it ends at the next entry or at the first blank line.
      const tail = text.slice(open);
      const stops = [tail.search(/\n\s*@[a-zA-Z]+\s*\{/), tail.search(/\n[ \t]*\n/)].filter((n) => n !== -1);
      end = stops.length ? open + Math.min(...stops) : text.length;
    }
    blocks.push(text.slice(j, end));
    rest += "\n";
    i = end;
  }
  return { blocks, rest };
}

const RIS_TAG = /^[A-Z][A-Z0-9][ \t]{1,2}-(?:\s|$)/;

/** RIS records. A record ends at "ER  -", at the next "TY  -", or at a blank line followed by ordinary text. */
function extractRisBlocks(text: string): { blocks: string[]; rest: string } {
  if (!/^[ \t]*TY[ \t]{1,2}-\s/m.test(text)) return { blocks: [], rest: text };
  const blocks: string[] = [];
  const rest: string[] = [];
  let cur: string[] | null = null;
  let blankSeen = false;
  const close = () => {
    if (cur) blocks.push(cur.join("\n"));
    cur = null;
    blankSeen = false;
    rest.push("");
  };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (/^TY[ \t]{1,2}-\s/.test(t + " ")) {
      if (cur) close();
      cur = [t];
      continue;
    }
    if (!cur) {
      rest.push(line);
      continue;
    }
    if (/^ER[ \t]{1,2}-/.test(t)) {
      (cur as string[]).push(t);
      close();
      continue;
    }
    if (!t) {
      blankSeen = true;
      continue;
    }
    if (RIS_TAG.test(t)) {
      (cur as string[]).push(t);
      blankSeen = false;
      continue;
    }
    if (blankSeen) {
      close();
      rest.push(line);
      continue;
    }
    (cur as string[]).push(t); // a long field value wrapped onto the next line
  }
  if (cur) close();
  return { blocks, rest: rest.join("\n") };
}

type Marker = "num" | "softnum" | "bullet" | "dash" | null;
type IdKind = "link" | "arxiv" | "isbn" | "pmid";

interface Line {
  raw: string;
  /** The line without its list marker. */
  body: string;
  marker: Marker;
  blankBefore: boolean;
  idKind: IdKind | null;
}

interface Item {
  text: string;
  lastLen: number;
  lines: number;
  marker: Marker;
  blankBefore: boolean;
  idOnly: boolean;
}

const HEADING =
  /^(?:#{1,6}\s*)?[*_]{0,2}(?:references?(?:\s+list)?|list\s+of\s+references|bibliography|works\s+cited|literature\s+cited|sources|citations)[*_]{0,2}\s*:?\s*[*_]{0,2}$/i;

function readMarker(s: string): { marker: Marker; body: string } {
  let m = s.match(/^\[\d{1,3}\]\s*/);
  if (m) return { marker: "num", body: s.slice(m[0].length) };
  m = s.match(/^(?:\(\d{1,3}\)|\d{1,3}[.)])\s+/);
  if (m) return { marker: "softnum", body: s.slice(m[0].length) };
  m = s.match(/^[•*▪●◦·‣⁃]\s+/);
  if (m) return { marker: "bullet", body: s.slice(m[0].length) };
  m = s.match(/^[-–—]\s+/);
  if (m) return { marker: "dash", body: s.slice(m[0].length) };
  return { marker: null, body: s };
}

/** Is this line nothing but an identifier or a link (DOI, URL, ISBN, arXiv id, PMID)? */
function identifierKind(line: string): IdKind | null {
  const s = line
    .replace(/^<(.*)>$/, "$1")
    .replace(/[.,;]+$/, "")
    .trim();
  if (!s) return null;
  if (/^(?:(?:https?:\/\/|www\.)\S+|(?:doi:?\s*)?10\.\d{4,9}(?:\/|%2F)\S+)$/i.test(s)) return "link";
  if (/^arxiv:?\s*\S+$/i.test(s) && extractArxivId(s)) return "arxiv";
  if (!/\s/.test(s) && /^[a-z-]+(?:\.[A-Za-z-]+)?\/\d{7}(?:v\d+)?$/.test(s) && extractArxivId(s)) return "arxiv";
  if (/^ISBN(?:-1[03])?:?\s*[\dXx][\dXx\s-]{8,16}$/i.test(s)) return "isbn";
  if (/^[\dXx][\dXx\s-]{8,16}$/.test(s) && normalizeIsbn(s)) return "isbn";
  if (/^(?:PMID:?\s*\d{1,9}|PMCID:?\s*PMC\d+|PMC\d{3,9})$/i.test(s)) return "pmid";
  return null;
}

function hasIdentifier(text: string, kind: IdKind): boolean {
  if (kind === "link") return /(?:https?:\/\/|www\.|doi:|10\.\d{4,9}\/)/i.test(text);
  if (kind === "arxiv") return /arxiv/i.test(text);
  if (kind === "isbn") return /ISBN|97[89][\d-]{10}/i.test(text);
  return /PMID|PMC\d/i.test(text);
}

const DATE_WORD = /\b(?:n\.\s?d\.|in press|forthcoming|no date)/i;
const YEAR_RE = new RegExp(`\\b${YEAR}[a-z]?\\b`);

/** A year (not one that is really a page range or a volume, "1813–1826", "1993(2)") or "n.d." / "in press". */
function hasDate(s: string): boolean {
  return YEAR_RE.test(s.replace(/\d+\s*[–-]\s*\d+/g, " ").replace(/\d+\(\d/g, " ")) || DATE_WORD.test(s);
}

function endsWithLink(s: string): boolean {
  return /(?:https?:\/\/|www\.)\S+$/i.test(s) || /10\.\d{4,9}\/\S+$/.test(s);
}

/** Does the text so far end the way a finished reference ends? */
function endsTerminal(s: string): boolean {
  if (endsWithLink(s)) return true;
  if (/(?:^|[\s(])(?:vol|no|pp?|et al|vs)\.$/i.test(s) || /(?:^|[\s(.])\p{Lu}\.$/u.test(s)) return false;
  return /[.?!)\]"”’'\d]$/.test(s);
}

/** A word that can stand in an author list: a capitalised name, initials, a particle, "and", "&", "et al.". */
const AUTHOR_TOKEN = new RegExp(`^(?:[${UP}][\\p{L}\\p{M}'’.\\-]*[,.;]*|&|and|et|al\\.?,?|${PARTICLE_WORD})$`, "u");

/** The text so far cannot be a whole reference: it stops on a comma, "and", "in", "vol." … */
function hardOpen(s: string): boolean {
  if (/doi\.org\/$/i.test(s)) return true;
  if (endsWithLink(s)) return false;
  if (/[,;:&(\[\/–—-]$/.test(s)) return true;
  // "Cloud, P., . . ." (APA's ellipsis before the last author), "ISBN" / "doi:" / "arXiv preprint" with the number still to come.
  if (/(?:…|\.\s?\.\s?\.)$/.test(s) || /(?:^|\s)(?:(?:ISBN(?:-1[03])?|DOI|PMID|URL):?|arXiv:|preprint)$/i.test(s)) return true;
  if (
    /(?:^|\s)(?:and|in|In|of|the|for|on|an?|et|from|at|to|with|by|und|de|del|della|der|den|van|von|la|le|du|dos|das|di|da|issue|volume|number|chapter|part|pages?|edition)$/.test(
      s,
    )
  )
    return true;
  return /(?:^|[\s(])(?:vol|no|pp?|et al)\.$/i.test(s);
}

/** "Page, M.J., McKenzie, J.E. et al. (2021)": only the authors and the date so far, the title is still to come. */
function authorsAndDateOnly(s: string): boolean {
  const dated = s.match(/^(.*?)\s*\((?:\d{4}[a-z]?(?:,[^)]*)?|n\.\s?d\.?|in press|forthcoming)\)\.?$/i);
  return Boolean(dated) && dated![1].split(/\s+/).every((w) => AUTHOR_TOKEN.test(w));
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}

/** An opened bracket or quotation that has not closed yet. */
function unbalanced(s: string): boolean {
  return count(s, "(") > count(s, ")") || count(s, "[") > count(s, "]") || count(s, "“") > count(s, "”") || count(s, '"') % 2 === 1;
}

const PLACE_INITIALS = /^(?:D\.\s?C|U\.\s?K|U\.\s?S(?:\.\s?A)?|N\.\s?Y|N\.\s?J|B\.\s?C)\.?\s*$/;
// "Smith, J." / "van der Maaten, L.," / "Иванов, П. С.,"
const START_APA = new RegExp(`^${FAMILY},\\s*(${INITIALS})(?=\\s*(?:[,;&(]|and\\b|et\\s+al|[${UP}]|\\d{4}|$))`, "u");
// "Smith, JA, & Lee, K" / "Smith, J (2020)"
const START_APA_BARE = new RegExp(`^${FAMILY},\\s*\\p{Lu}{1,3}(?=\\s*(?:,\\s*(?:&|and\\b|${NAME},)|&\\s|and\\b|et\\s+al|\\((?:\\d{4}|n\\.)))`, "u");
// "K. He, X. Zhang" / "C. E. Shannon,"
const START_IEEE = new RegExp(`^${INITIALS}\\s?(?:${PARTICLE}\\s+)?${NAME}(?:\\s+${NAME})?(?=,|\\s+and\\b|\\s+&|\\s+et\\s+al|\\s*$|\\s*\\((?:\\d{4}|n\\.))`, "u");
// "Kahneman, Daniel, and Amos Tversky." / "Lévi-Strauss, Claude. “…" / "Akerlof, George A. 1970."
const START_MLA = new RegExp(
  `^${FAMILY},\\s+${GIVEN}(?:\\.\\s+["“«‘]|\\.?\\s+\\(?${YEAR}\\b|,\\s+(?:and\\s+)?${NAME}\\s+(?:\\p{Lu}\\.\\s+)?(?:${PARTICLE}\\s+)?${NAME}|,?\\s+and\\s+${NAME}\\s+(?:\\p{Lu}\\.\\s+)?${NAME}|,\\s+et\\s+al|,\\s+${FAMILY},\\s+${NAME})`,
  "u",
);
// "Kahneman, Daniel. Thinking, Fast and Slow." A place and publisher ("Springer, Berlin.") look the same, so this is weak.
const START_MLA_TITLE = new RegExp(`^${FAMILY},\\s+${GIVEN}\\.\\s+[${UP}\\d]`, "u");
// "Tumanov VI, Shchetilina EA," / "Smith JA. Title" / "Smith J (2020)"
const START_VANCOUVER = new RegExp(`^${FAMILY}\\s+\\p{Lu}{1,3}(,\\s+${FAMILY}\\s+\\p{Lu}{1,3}\\b|\\.\\s+[${UP}]\\p{Ll}|\\s+\\(${YEAR}|,?\\s+et\\s+al)`, "u");
// Anything followed by a bracketed date: "World Health Organization. (2021)."
const START_DATED = new RegExp(`^[^\\d()]{2,150}?\\s?\\((?:${YEAR}[a-z]?(?:,[^)]{0,30})?|n\\.\\s?d\\.?|in press|forthcoming)\\)`, "i");
const START_QUOTED = new RegExp(`^["“‘'«][${UP}\\d]`, "u");

/** How much the beginning of a line looks like the beginning of a reference. */
function startKind(line: string): "strong" | "weak" | null {
  let m = line.match(START_APA);
  if (m && !PLACE_INITIALS.test(m[1])) return "strong";
  if (START_APA_BARE.test(line) || START_IEEE.test(line)) return "strong";
  if (START_MLA.test(line)) return "strong";
  m = line.match(START_VANCOUVER);
  if (m) return m[1].startsWith(",") && !/et\s+al/.test(m[1]) ? "strong" : "weak";
  if (START_MLA_TITLE.test(line) || START_DATED.test(line) || START_QUOTED.test(line)) return "weak";
  return null;
}

/** Lines that open a trailing note, never a reference. */
const CONTINUATION_OPENER =
  /^(?:Retrieved\b|Available\s+(?:at|from|online)\b|Accessed\b|Last\s+accessed\b|In:?\s+\p{Lu}|pp?\.\s*\d|Vol(?:ume)?\.?\s*\d|No\.\s*\d|ISSN\b|ISBN\b|PMID\b|PMCID\b|URL\b|doi\b|https?:|www\.)/iu;

/** Splits the plain-text part of a paste (no BibTeX / RIS) into references. */
function splitPlain(remaining: string): string[] {
  const lines: Line[] = [];
  let blank = false;
  for (const rawLine of remaining.split("\n")) {
    const raw = rawLine.trim();
    if (!raw) {
      blank = true;
      continue;
    }
    if (HEADING.test(raw)) {
      blank = true;
      continue;
    }
    const { marker, body } = readMarker(raw);
    lines.push({ raw, body, marker, blankBefore: blank && lines.length > 0, idKind: identifierKind(body) });
    blank = false;
  }
  if (!lines.length) return [];

  // What kind of paste is this?
  const width = Math.max(...lines.map((l) => l.raw.length));
  const paragraphs: number[] = [];
  for (const l of lines) {
    if (l.blankBefore || !paragraphs.length) paragraphs.push(1);
    else paragraphs[paragraphs.length - 1]++;
  }
  // Blank-line separated references, each possibly wrapped over a few lines.
  const paragraphMode = paragraphs.length > 1 && paragraphs.some((n) => n > 1) && paragraphs.every((n) => n <= 6);
  // A line break in the middle of a sentence means the text was hard-wrapped (pasted from a PDF or an e-mail).
  const midSentenceBreak = lines.some((l, i) => i > 0 && !l.blankBefore && !l.marker && !l.idKind && !lines[i - 1].idKind && !endsTerminal(lines[i - 1].raw));
  const wrapped = width <= 140 && (paragraphMode || midSentenceBreak);
  // Does the paste list identifiers as items in their own right (rather than a DOI wrapped under its reference)?
  const standaloneIds = lines.some((l, i) => l.idKind && (l.marker || i === 0 || l.blankBefore || lines[i - 1].idKind));
  const dashList = lines[0].marker === "dash";

  /** Is there a date on this line or soon after it, before the next reference obviously begins? */
  const dateAhead = (i: number, reach: number, stopAtStart: boolean) => {
    for (let k = i; k < Math.min(lines.length, i + reach); k++) {
      if (k > i && (lines[k].blankBefore || lines[k].marker === "num" || lines[k].marker === "bullet")) return false;
      if (k > i && stopAtStart && startKind(lines[k].body) === "strong") return false;
      if (hasDate(lines[k].raw)) return true;
    }
    return false;
  };

  const startsNew = (prev: Item | undefined, i: number): boolean => {
    const line = lines[i];
    if (!prev || line.blankBefore) return true;
    const hard = hardOpen(prev.text);
    if (line.marker === "num" || line.marker === "bullet") return true;
    if (line.marker === "softnum" && !hard) return true;
    if (line.marker === "dash" && !hard) {
      // "– " is a bullet, but a wrapped title can also break before a dash ("Covid-19\n— Final report").
      if (prev.idOnly || dashList || (endsTerminal(prev.text) && !/\d$/.test(prev.text) && startKind(line.body) !== null)) return true;
    }
    const text = line.marker ? line.raw : line.body;
    const idKind = line.marker ? identifierKind(line.raw) : line.idKind;
    if (idKind) {
      if (hard) return false;
      // (Between blank-line separated entries a link inside an entry's own paragraph is that entry's link.)
      if (prev.idOnly || (standaloneIds && !paragraphMode)) return true;
      // A DOI / link on its own line directly under a reference that has none yet belongs to that reference.
      return hasIdentifier(prev.text, idKind);
    }
    if (prev.idOnly) return true;
    if (hard) return false;
    const prevDate = hasDate(prev.text);
    const prevEnds = endsTerminal(prev.text);
    // Still inside the author list or the title: no date yet and no sentence end.
    if (!prevDate && !prevEnds) return false;
    const kind = startKind(text);
    const lineDate = hasDate(text);
    // The title has not come yet, so this line is it, unless it plainly opens another author-date entry.
    if (authorsAndDateOnly(prev.text) && kind !== "strong" && !START_DATED.test(text)) return false;
    const open = unbalanced(prev.text);
    if (kind === "strong") {
      if (lineDate && (!open || (prevDate && prevEnds))) return true;
      if (open) return false;
      return prevEnds && (!wrapped || dateAhead(i, 30, false));
    }
    if (open) return false;
    if (CONTINUATION_OPENER.test(text)) return false;
    // Was the line break deliberate? In wrapped text a line only ends early when the paragraph ends.
    const firstWord = text.split(/\s/)[0].length;
    const deliberate = !wrapped || prev.lastLen + 1 + firstWord <= width * 0.7;
    if (kind === "weak") {
      return deliberate ? prevEnds : prevDate && prevEnds && dateAhead(i, 3, true);
    }
    if (!deliberate || !prevEnds) return false;
    if (new RegExp(`^[${UP}\\d"“‘'«]`, "u").test(text)) return true;
    // A lowercase start ("elsaied ahmed, fayza mohamed. “…” 2020") is a reference of its own when both sides are dated.
    return /^\p{Ll}/u.test(text) && prevDate && lineDate && text.length >= 40;
  };

  const items: Item[] = [];
  lines.forEach((line, i) => {
    const prev = items[items.length - 1];
    if (startsNew(prev, i)) {
      items.push({ text: line.body, lastLen: line.raw.length, lines: 1, marker: line.marker, blankBefore: line.blankBefore, idOnly: line.idKind !== null });
    } else {
      prev.text = /doi\.org\/$/i.test(prev.text) ? prev.text + line.raw : `${prev.text} ${line.raw}`;
      prev.lastLen = line.raw.length;
      prev.lines++;
      prev.idOnly = false;
    }
  });

  // A consistently numbered list: an unnumbered line in the middle of it continues the entry above.
  const numbered = items.filter((it) => it.marker === "num" || it.marker === "softnum").length;
  if (numbered >= 2 && (items[0].marker === "num" || items[0].marker === "softnum") && numbered / items.length >= 0.7) {
    const merged: Item[] = [];
    for (const it of items) {
      const prev = merged[merged.length - 1];
      if (prev && !it.marker && !it.blankBefore && !prev.idOnly && !it.idOnly) prev.text = `${prev.text} ${it.text}`;
      else merged.push(it);
    }
    return merged.map((it) => it.text);
  }
  return items.map((it) => it.text);
}

export function splitReferences(input: string): SplitResult {
  const text = input.replace(/\r\n?/g, "\n").replace(/[   ]/g, " ");
  const bib = extractBibtexBlocks(text);
  const ris = extractRisBlocks(bib.rest);
  return {
    plain: splitPlain(ris.rest)
      .map((p) => p.trim())
      .filter((p) => p.length >= 6),
    bibtex: bib.blocks,
    ris: ris.blocks,
  };
}

/* ───────────────────────── Field extraction ───────────────────────── */

function stripIdentifiers(s: string): string {
  return s
    .replace(/(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)10\.\d{4,9}\/\S+/gi, " ")
    .replace(/\b10\.\d{4,9}\/\S+/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bRetrieved from\b.*$/i, " ")
    .replace(/([.?!]\s+)Retrieved\s[^.]{0,40}?\bfrom\b.*$/, "$1")
    .replace(/\b(?:Available at|Accessed)\b.*$/i, " ")
    .replace(/ISBN(?:-1[03])?:?\s*[\dXx\- ]{10,17}/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAuthorChunk(s: string) {
  return s.replace(/^[\s,;.&]+|[\s,;&]+$/g, "").trim();
}

const ORG_WORD =
  /\b(?:Universit(?:y|ies|ät|é|à)|Universidad|Institutes?|Institution|Organi[sz]ation|Association|Society|Department|Ministry|Committee|Council|Commission|Agency|Foundation|Consortium|Collaboration|Group|Team|Cent(?:er|re)s?|Office|Bureau|Board|Bank|Nations|Union|Federation|Academy|Academies|College|School|Company|Corporation|Corp|Inc|Ltd|LLC|GmbH|Press|Network|Project|Program(?:me)?|Services?|Authority|Administration|Government|Parliament|Congress|Library|Laborator(?:y|ies)|Research|Alliance|Initiative|Fund|Trust|Forum|Panel|Task Force|Staff|Contributors|Developers|Community|International|National|World|Federal|Royal|Statistics|Publishing|Editors|Secretariat|Observatory|Survey|Museum|Hospital)\b/i;

/**
 * Is the whole author field one organisation ("World Health Organization", "The pandas development team")?
 * `inverted` = the reference style writes people as "Family, I." (APA / Harvard), so a multi-word
 * name without any comma cannot be a person.
 */
function looksLikeOrganisation(s: string, inverted: boolean): boolean {
  const t = s.replace(/\b(?:U\.\s?S\.(?:\s?A\.)?|U\.\s?K\.|U\.\s?N\.|E\.\s?U\.)/g, "X");
  if (/(?:^|[\s,(])\p{Lu}\.(?=[\s,\-]|\p{Lu}\.|$)/u.test(t)) return false; // initials: these are people
  if (/\s(?:of|for|on|the|in|to)\s/.test(s) || /^The\s/.test(s)) return true;
  if (s.includes(",")) return false;
  const words = s.split(" ");
  if (words.length < 2) return false;
  if (new RegExp(`^${NAME}(?:\\s${NAME})?\\s\\p{Lu}{1,3}$`, "u").test(s) && /\p{Ll}/u.test(words[0])) return false; // "Smith JA"
  const signal = ORG_WORD.test(s) || words.some((w) => /^\p{Ll}/u.test(w) && !PARTICLE_WORDS.has(w) && !["and", "et", "al"].includes(w));
  if (/\s(?:and|&)\s/.test(s)) return signal; // "John Smith and Jane Doe" are two people
  return signal || words.length >= 5 || inverted;
}

const NAME_WORD = new RegExp(`^${NAME}$`, "u");

/** One to four words that could be a compound family name: "Daee Abedin", "Pérouse de Montclos". */
function compoundFamily(c: string): boolean {
  const w = c.split(" ");
  const name = (x: string) => NAME_WORD.test(x) && !/^\p{Lu}{1,5}$/u.test(x); // "Novotný J" is a surname plus initials, not a compound
  return w.length >= 2 && w.length <= 4 && name(w[0]) && name(w[w.length - 1]) && w.every((x) => name(x) || PARTICLE_WORDS.has(x));
}

/** One given name, optionally with initials: "Samira", "Marc-Antoine", "George A." */
function singleGiven(c: string): boolean {
  return new RegExp(`^${NAME}(?:\\s\\p{Lu}\\.?)*$`, "u").test(c) && /\p{Ll}/u.test(c);
}

function personFromChunk(c: string): ParsedAuthor {
  const parts = c.split(" ");
  if (parts.length < 2) return { family: c };
  if (parts.length >= 5 || (parts.length >= 3 && ORG_WORD.test(c))) return { family: c }; // organisation
  const last = parts[parts.length - 1];
  // Vancouver: "Smith JA" / "Smith J.A."
  if (/^(?:\p{Lu}{1,2}|(?:\p{Lu}\.){1,3})$/u.test(last) && /\p{Ll}/u.test(parts[0])) return { family: parts.slice(0, -1).join(" "), given: last };
  return { family: last, given: parts.slice(0, -1).join(" ") };
}

/**
 * Parses author lists in APA ("Smith, J. A., & Lee, K."), IEEE ("J. A. Smith and K. Lee") and MLA
 * ("Smith, John, and Kim Lee") forms. An organisation is kept as ONE author whose family is its full name.
 * Pass style "inverted" when the reference style always writes people as "Family, I." (APA / Harvard).
 */
export function parseAuthors(input: string, style: "inverted" | "any" = "any"): { authors: ParsedAuthor[]; etAl: boolean } {
  let s = input.replace(/\s+/g, " ").trim();
  // APA 7 writes 20+ authors as "A, B, … Z" (sometimes ". . ." with spaces).
  const etAl = /\bet\s+al\.?/i.test(s) || /…|\.\s?\.\s?\./.test(s);
  s = s.replace(/\bet\s+al\.?/gi, "").replace(/…|\.\s?\.\s?\./g, ",").replace(/\(Eds?\.\)/gi, "");
  const whole = cleanAuthorChunk(s.replace(/\.$/, ""));
  if (whole && looksLikeOrganisation(whole, style === "inverted")) return { authors: [{ family: whole }], etAl };
  s = s.replace(/\s*&\s*/g, ", ").replace(/,?\s+and\s+/gi, ", ").replace(/;\s*/g, ", ");
  s = cleanAuthorChunk(s.replace(/\.$/, ""));
  if (!s) return { authors: [], etAl };

  const authors: ParsedAuthor[] = [];

  // APA / Harvard: Family, I. I.
  const apa = [...s.matchAll(/([\p{Lu}][\p{L}'’\- ]*?[\p{L}]),\s*((?:[\p{Lu}]\.?\s?-?){1,4})(?=,|$)/gu)];
  if (apa.length && apa.map((m) => m[0]).join("").length > s.replace(/[, ]/g, "").length * 0.5) {
    for (const m of apa) authors.push({ family: m[1].trim(), given: m[2].trim() });
    return { authors, etAl };
  }

  // IEEE: I. I. Family
  const ieee = [...s.matchAll(/((?:[\p{Lu}]\.\s?-?){1,4})\s*([\p{Lu}][\p{L}'’-]+(?:\s[\p{Lu}][\p{L}'’-]+)?)/gu)];
  if (ieee.length && ieee.length >= s.split(",").length * 0.6) {
    for (const m of ieee) authors.push({ family: m[2].trim(), given: m[1].trim() });
    return { authors, etAl };
  }

  // MLA / Chicago: "Family, Given, Given Family, Given Family". The first family may be a compound
  // ("Daee Abedin, Samira, and Shahriar Zarshenas") when what follows it is clearly one given name.
  const chunks = s.split(",").map(cleanAuthorChunk).filter(Boolean);
  // (In scripts without capitals, "张伟, 李明" in an APA list is two people; in MLA "Family, Given" is one.)
  const mlaFirst =
    chunks.length >= 2 &&
    (style === "inverted" ? /^\p{Lu}/u : /^[\p{Lu}\p{Lo}]/u).test(chunks[1]) &&
    (!chunks[0].includes(" ") || (compoundFamily(chunks[0]) && singleGiven(chunks[1]) && (chunks.length === 2 || chunks[2].includes(" "))));
  if (mlaFirst) {
    authors.push({ family: chunks[0], given: chunks[1] });
    for (const c of chunks.slice(2)) {
      const parts = c.split(" ");
      authors.push(parts.length > 1 ? { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") } : { family: c });
    }
    return { authors, etAl };
  }
  // Vancouver: every name is "Family INITIALS" ("Luz LKD, Souza MEDS, Pereira AL").
  if (chunks.length >= 2 && chunks.every((c) => /^\S.*\s\p{Lu}{1,5}$/u.test(c) && /\p{Ll}/u.test(c))) {
    for (const c of chunks) authors.push({ family: c.slice(0, c.lastIndexOf(" ")), given: c.slice(c.lastIndexOf(" ") + 1) });
    return { authors, etAl };
  }
  for (const c of chunks) authors.push(personFromChunk(c));
  return { authors, etAl };
}

type Tail = Pick<ParsedReference, "venue" | "volume" | "issue" | "pages" | "publisher">;

const PAGES = "[A-Za-z]?\\d+(?:\\s*[–-]\\s*[A-Za-z]?\\d+)?";

/** Journal-title abbreviations whose full stop does not end the venue ("Proc. IEEE Conf. Comput. Vis."). */
const VENUE_ABBREVIATIONS = new Set(
  (
    "proc conf int intl natl acad sci comput vis recognit syst tech technol trans j rev lett res soc psychol pers eng mech phys chem biol med am eur assoc univ dept inst symp adv appl math stat econ educ commun mag bull ann arch electron cybern ed eds vol no pp anal mach intell learn inf process lang linguist artif netw autom signal softw mater struct environ geophys astron astrophys clin exp gen behav cogn dev philos hist polit sociol anthropol manag organ mark financ account bus stud q quart r roy ser sect suppl st nat mol genet microbiol immunol pharmacol physiol neurosci surg oncol cardiol pediatr psychiatr epidemiol nutr agric ecol evol zool bot entomol geol meteorol oceanogr opt acoust nucl theor comp numer geom topol probab oper optim knowl discov retr multimed hum interact ergon natl pathol radiol dermatol neurol urol obstet gynecol ophthalmol orthop anesth nurs dent vet toxicol endocrinol gastroenterol hepatol nephrol rheumatol hematol infect dis sci. u.s u.k"
  ).split(" "),
);

/** Where the venue name ends in "<venue>. <rest>" / "<venue>, vol. 3 …" text. Returns -1 when it runs to the end. */
function venueCut(t: string): number {
  const hard = t.search(/,\s*(?:vol\.|no\.|pp?\.|\d)|\s+\d{4}[.,]|,\s*\(?\d{4}\)?/i);
  let dot = -1;
  const re = /\.(?=\s+[\p{Lu}\p{Lo}\p{N}]|$)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index < t.length - 1) {
      const before = t.slice(0, m.index).split(/[\s(]+/).pop() ?? "";
      if (/^\p{Lu}$/u.test(before) || VENUE_ABBREVIATIONS.has(before.toLowerCase())) continue; // an abbreviation, not a sentence end
    }
    dot = m.index;
    break;
  }
  if (hard === -1) return dot;
  if (dot === -1 || hard < dot) return hard;
  // "Journal. Series B, 157–164" is one name running up to its numbers; "Journal. Publisher, 2022" is two things.
  const yearNext = /^(?:,\s*\(?|\s+)\d{4}\)?(?![\d–-])/.test(t.slice(hard));
  return yearNext ? dot : hard;
}

function cleanVenue(v: string | undefined): string | undefined {
  if (!v) return undefined;
  let out = v.replace(/[,;:\s]+$/, "").trim();
  const lastWord = out.replace(/\.$/, "").split(/[\s(]+/).pop() ?? "";
  // Keep the full stop of a final abbreviation ("Bell Syst. Tech. J."), drop a sentence-ending one.
  const abbreviated = out.endsWith(".") && /\.\s/.test(out) && (/^\p{Lu}$/u.test(lastWord) || VENUE_ABBREVIATIONS.has(lastWord.toLowerCase()));
  if (!abbreviated) out = out.replace(/[.,;:]+$/, "").trim();
  return out.length >= 2 && out.length <= 200 && !/^\d+$/.test(out) ? out : undefined;
}

function cleanPublisher(p: string | undefined): string | undefined {
  const out = (p ?? "").replace(/^[\s.,;:]+|[\s.,;:]+$/g, "").trim();
  return out.length >= 2 && out.length <= 100 && !/\d{3}/.test(out) ? out : undefined;
}

function parseVenueTail(tail: string, opts: { commaStyle?: boolean } = {}): Tail {
  let t = tail.replace(/^[\s.,:;]+/, "").trim();
  const out: Tail = {};
  if (!t) return out;
  // Chapter in edited book: "In A. Editor (Ed.), Book title (pp. 1–20). Publisher."
  const chapter = t.match(/^In\s+.*?\(Eds?\.\),\s*(.+?)\s*\((?:\d+(?:st|nd|rd|th) ed\.,\s*)?pp\.\s*([\d–-]+)\)\.\s*(.*)$/i);
  if (chapter) {
    out.venue = chapter[1].trim();
    out.pages = chapter[2];
    out.publisher = chapter[3].replace(/\.$/, "").trim() || undefined;
    return out;
  }
  t = t.replace(/^In[:\s]+(?:Proceedings of (?:the )?)?/i, (m) => (/proceedings/i.test(m) ? "Proceedings of the " : ""));
  // "arXiv preprint arXiv:1810.04805" / "arXiv:1810.04805 [cs.CL]" / "CoRR, abs/1810.04805"
  if (/^(?:arXiv\b|CoRR\b)/i.test(t)) {
    out.venue = "arXiv";
    return out;
  }
  // APA: "Journal, 77(1), 81–112"; Harvard: "Journal, 9(8), pp. 1735–1780"
  const apaNums =
    t.match(new RegExp(`,\\s*(\\d+)\\s*(?:\\(([^)]+)\\))?\\s*,\\s*(${PAGES})`)) ?? t.match(new RegExp(`,\\s*(\\d+)\\s*\\(([^)]+)\\)\\s*,\\s*pp?\\.\\s*(${PAGES})`));
  if (apaNums && apaNums.index !== undefined) {
    const v = t.slice(0, apaNums.index).replace(/[.,;:]+$/, "").trim();
    if (v.length >= 2) out.venue = v;
    out.volume = apaNums[1];
    out.issue = apaNums[2];
    out.pages = apaNums[3]?.replace(/\s/g, "");
  } else {
    // Chicago: "Econometrica 47 (2): 263–91" / "Journal of Literacy 12, no. 3 (2020): 45–67"
    const chicago = t.match(new RegExp(`^(.+?)[,\\s]\\s*(\\d{1,4})\\s*(?:,\\s*no\\.\\s*([\\w–-]+)\\s*)?(?:\\(([^)]{1,30})\\)\\s*)?:\\s*(${PAGES})`));
    const v = chicago ? cleanVenue(chicago[1]) : undefined;
    if (chicago && v && /\p{L}{2}/u.test(v)) {
      out.venue = v;
      out.volume = chicago[2];
      out.issue = chicago[3] ?? (/^\d{1,3}(?:[–-]\d{1,3})?$/.test(chicago[4] ?? "") ? chicago[4] : undefined);
      out.pages = chicago[5].replace(/\s/g, "");
    } else {
      // Chicago without a volume: "Экономика. Информатика (2022): 684–692"
      const dated = t.match(new RegExp(`^(.+?)\\s*\\((?:[\\p{L}.]+\\s+)?${YEAR}\\)\\s*:\\s*(${PAGES})`, "u"));
      const name = dated ? cleanVenue(dated[1]) : undefined;
      if (dated && name && /\p{L}{2}/u.test(name)) {
        out.venue = name;
        out.pages = dated[2].replace(/\s/g, "");
      }
    }
  }
  const vol = t.match(/\bvol(?:ume)?\.?\s*(\d+)/i);
  const no = t.match(/\b(?:no|issue)\.?\s*(\d+)/i);
  const pp = t.match(/\bpp?\.\s*([\d–-]+)/i);
  out.volume ??= vol?.[1];
  out.issue ??= no?.[1];
  out.pages ??= pp?.[1];
  if (out.venue) return out;
  // "Book or proceedings title (pp. 1–20). Publisher."
  const paged = t.match(new RegExp(`^(.+?)\\s*\\((?:[^()]*?,\\s*)?pp?\\.\\s*(${PAGES})\\)[.,]?\\s*(.*)$`));
  if (paged) {
    out.venue = cleanVenue(paged[1]);
    out.pages = paged[2].replace(/\s/g, "");
    out.publisher = cleanPublisher(paged[3]);
    if (out.venue) return out;
  }
  let v: string;
  if (opts.commaStyle) {
    // IEEE / Harvard separate fields with commas, so a full stop inside the venue is an abbreviation.
    const cut = t.search(/,\s*(?:vol\.|no\.|pp?\.|\d|\(?\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|doi\b)/i);
    v = cut === -1 ? t : t.slice(0, cut);
    // "Proc. … (MCC '12), Helsinki, Finland": the place after the bracketed acronym is not part of the name.
    const acronym = v.match(/^(.*?\([^)]{2,20}\)),\s/);
    if (acronym) v = acronym[1];
  } else {
    const cut = venueCut(t);
    v = cut === -1 ? t : t.slice(0, cut);
  }
  out.venue = cleanVenue(v);
  return out;
}

const DESCRIPTOR_PAREN =
  /\s*\((?:arXiv|Version|Report|Doctoral|Master|Tech(?:nical)?|Working paper|Preprint|Original work|Vol\.|No\.|\d+(?:st|nd|rd|th)\s+ed|[^)]*\bTrans\.|[^)]*\bEds?\.)[^)]*\)/gi;
const ABBREVIATIONS = new Set(["vs", "e.g", "i.e", "etc", "al", "st", "dr", "no", "vol", "ed", "eds", "u.s", "u.k", "jr", "sr", "mr", "ms", "inc", "co", "ltd"]);

/** Removes APA descriptors that are not part of a title: "(Version 3.1)", "[Computer software]", "(M. Ramos, Trans.)". */
export function stripDescriptors(s: string): string {
  return s.replace(/\s*\[[^\]]{2,160}\]/g, "").replace(DESCRIPTOR_PAREN, "").replace(/\s+/g, " ").trim();
}

const CONNECTIVE = "(?:of|and|the|in|for|on|de|la|le|les|des|du|der|und|für|et|y|e|di|del|to|an?|at|by|with|en|och|do|da|dos|das|&)";
const TITLE_CASE_WORD = `(?:[${UP}\\d][\\p{L}\\p{M}\\p{N}'’\\-]*\\.?|\\([^)]{1,20}\\)|${CONNECTIVE})`;
// A journal name (Title Case words, possibly abbreviated) running straight into its numbers: "Proc. Natl. Acad. Sci. USA, 79(8)".
const VENUE_WITH_NUMBERS = new RegExp(`^(?:${TITLE_CASE_WORD}[,:]?\\s+){0,15}?${TITLE_CASE_WORD}(?:,\\s*(?:vol(?:ume)?\\.?\\s*)?\\d+[A-Za-z]?\\s*(?:[(,:;.]|$)|\\s+\\d+\\s*(?:\\(|,\\s*no\\.|:))`, "u");
const PUBLISHER_LIKE = new RegExp(`^(?:${TITLE_CASE_WORD},?\\s+){0,6}${TITLE_CASE_WORD}$`, "u");

/** Does the text after a full stop read like where a reference continues after its title? */
function looksLikeVenue(after: string): boolean {
  const r = after.trim();
  if (!r) return false;
  if (new RegExp(`^In:?\\s+[${UP}\\d]`, "u").test(r)) return true;
  if (/^(?:arXiv|bioRxiv|medRxiv|ChemRxiv|PsyArXiv|SocArXiv|SSRN|Zenodo|OSF|CoRR|Research Square)\b/i.test(r)) return true;
  if (VENUE_WITH_NUMBERS.test(r)) return true;
  if (/^[^.?!]{2,80}\.\s+(?:vol(?:ume)?\.?\s*\d|no\.\s*\d|pp?\.\s*\d|\d{4}\s*[;:,.]|\d+\s*[(:;]|Advance online publication|In press|Unpublished|Manuscript)/i.test(r)) return true;
  if (/^\d+(?:st|nd|rd|th)\s+edn?\b/i.test(r)) return true;
  // The last thing in the reference, short and in Title Case: a publisher or a website name.
  const last = r.replace(/[.\s]+$/, "");
  return last.length <= 60 && !/[.?!]\s/.test(last) && !/^(?:Advance online|In press|Unpublished|Manuscript)/i.test(last) && PUBLISHER_LIKE.test(last);
}

/**
 * Index of the full stop that ends a title. Initials and abbreviations ("U.S.", "vs.") never end it;
 * among the remaining full stops the first one followed by something that reads like a venue wins
 * ("… Sp. Nov., a New Species … in Malaya. Annals of Tropical Medicine & Parasitology, 56(2)").
 */
export function titleEnd(s: string): number {
  const re = /[.?!](?=\s+|$)|[。？！]/g;
  let m: RegExpExecArray | null;
  const firm: number[] = [];
  const doubtful: number[] = [];
  while ((m = re.exec(s))) {
    const after = s.slice(m.index + 1);
    if (m[0] === ".") {
      let from = m.index;
      while (from > 0 && !/\s/.test(s[from - 1])) from--;
      const before = s.slice(from, m.index);
      const word = before.toLowerCase().replace(/^[("'“‘]+/, "");
      if (/^\p{Lu}$/u.test(before) || ABBREVIATIONS.has(word)) continue;
      if (m.index <= 4 && /^\d{1,3}$/.test(s.slice(0, m.index).trim())) continue; // "8. Le verdissement du paysage urbain": a chapter number
    }
    if (looksLikeVenue(after)) return m.index;
    const next = after.match(/^\s+(\S+)/)?.[1] ?? "";
    // ". I. Mathematical model" (a part number) and "Sp. Nov., a new species" (an abbreviation) continue the title.
    if (m[0] === "." && (/^(?:\p{Lu}|[IVX]{1,4})\.$/u.test(next) || /^\p{L}{1,5}\.,$/u.test(next))) doubtful.push(m.index);
    else firm.push(m.index);
  }
  if (firm.length) return firm[0];
  return doubtful.length ? doubtful[0] : -1;
}

const QUOTE_PAIRS: Record<string, string> = { "‘": "’'", "'": "'’", "“": '”"', '"': '"”', "«": "»" };

/** Harvard/MLA titles in quotes right after the year: (1997) 'Long short-term memory', Neural Computation… */
function leadingQuotedTitle(rest: string): { title: string; after: string } | null {
  const closers = QUOTE_PAIRS[rest[0]];
  if (!closers) return null;
  const limit = Math.min(rest.length, 400);
  // The closing quote is of the same kind as the opening one, so an inner "phrase" or an apostrophe does not end the title.
  for (const follows of [/[,.;:]/, /\s/]) {
    for (let i = 5; i < limit; i++) {
      if (!closers.includes(rest[i])) continue;
      const next = rest[i + 1];
      if (next === undefined || follows.test(next)) return { title: rest.slice(1, i).replace(/[,.]\s*$/, "").trim(), after: rest.slice(i + 1) };
    }
  }
  return null;
}

const YEARS_G = new RegExp(`\\b(${YEAR})\\b`, "g");

/** The last year in the text that is not part of a page range ("pp. 1735–1780" is not 1780). */
function lastYear(s: string): number | undefined {
  const withoutPages = s.replace(/\bpp?\.\s*[A-Za-z]?\d+(?:\s*[–-]\s*[A-Za-z]?\d+)?/gi, " ").replace(/\d+\s*[–-]\s*\d+/g, " ");
  const found = [...withoutPages.matchAll(YEARS_G)];
  const all = found.length ? found : [...s.matchAll(YEARS_G)];
  return all.length ? Number(all[all.length - 1][1]) : undefined;
}

const DATE_PAREN = /\(\s*(?:(1\d{3}|20\d\d)[a-z]?(?:,\s*[^)]*)?|(n\.\s?d\.?|no date|in press|forthcoming|in preparation|submitted))\s*\)/i;
const THESIS =
  /\[(?:Doctoral (?:dissertation|thesis)|Master['’]?s (?:thesis|dissertation)|Bachelor['’]?s thesis|Ph\.?\s?D\.? (?:thesis|dissertation)|Undergraduate thesis|Thesis|Dissertation)[^\],]*,\s*([^\]]+)\]/i;
// "Family, Given, et al. " / "Family, Given, and Given Family. " at the very start (MLA / Chicago without a quoted title).
const MLA_LEAD = new RegExp(
  `^(${FAMILY},\\s+${GIVEN}(?:,\\s+${NAME}\\s+(?:\\p{Lu}\\.\\s+)?(?:${PARTICLE}\\s+)?${NAME})*(?:,?\\s+and\\s+${NAME}\\s+(?:\\p{Lu}\\.\\s+)?(?:${PARTICLE}\\s+)?${NAME})?(?:,?\\s+et\\s+al)?)\\.\\s+(?=\\S)`,
  "u",
);
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** How much real text (letters of any script) is left once identifiers are removed. One CJK character counts as a word. */
function textWeight(body: string): number {
  const s = body
    .replace(/\barxiv\b[:\s]*\S*/gi, " ")
    .replace(/(?:^|\s)[a-z-]+(?:\.[A-Za-z-]+)?\/\d{7}(?:v\d+)?/g, " ")
    .replace(/\b(?:PMC?ID|ISBN|DOI|URL)\b/gi, " ");
  return s.replace(/[^\p{L}]/gu, "").length + 3 * (s.match(CJK)?.length ?? 0);
}

/**
 * The first quoted span, as [whole, inside] with its index. Curly quotes nest, so
 * “… applied analysis to the “Alzira Model” (…).” ends at the quote that closes the first one.
 */
function quotedSpan(body: string): { 0: string; 1: string; index: number } | null {
  const m = body.match(/[“"]([^”"]{6,})[”"]/);
  if (!m || m.index === undefined) return null;
  if (body[m.index] === "“") {
    let depth = 0;
    for (let i = m.index; i < body.length; i++) {
      if (body[i] === "“") depth++;
      else if (body[i] === "”" && --depth === 0) {
        if (i - m.index > 6) return { 0: body.slice(m.index, i + 1), 1: body.slice(m.index + 1, i), index: m.index };
        break;
      }
    }
  }
  return { 0: m[0], 1: m[1], index: m.index };
}

export function parseReference(rawInput: string): ParsedReference {
  const raw = rawInput.replace(/\s+/g, " ").trim();
  const doi = extractDoi(raw) ?? undefined;
  const isbn = extractIsbn(raw) ?? undefined;
  const arxivId = extractArxivId(raw) ?? undefined;
  const url = extractUrl(raw) ?? undefined;
  const base: ParsedReference = { raw, format: "text", authors: [], doi, isbn, arxivId, url };

  const body = stripIdentifiers(raw).replace(/\s*\(Original work published[^)]*\)/gi, "").trim();
  if (textWeight(body) < 8) {
    if (doi) return { ...base, format: "doi" };
    if (isbn) return { ...base, format: "isbn" };
    if (arxivId) return { ...base, format: "arxiv" };
    if (url) return { ...base, format: "url" };
  }

  const yearParen = body.match(DATE_PAREN);
  const afterYear = yearParen && yearParen.index !== undefined ? yearParen.index + yearParen[0].length : -1;

  // Quoted title → MLA / IEEE / Chicago style. A quoted phrase INSIDE a title is not the title:
  // the quotation must open where a title starts (after the authors or the year), not after title words.
  const quoted = quotedSpan(body);
  if (quoted && quoted.index !== undefined) {
    const before = body.slice(0, quoted.index);
    const titleAlreadyStarted = afterYear !== -1 && afterYear <= quoted.index && /[\p{L}\p{N}]{2}/u.test(body.slice(afterYear, quoted.index));
    const opensATitle = !before.trim() || /(?:[.,:;)]|\d{4}[a-z]?)$/.test(before.trim());
    if (!titleAlreadyStarted && opensATitle) {
      const after = body.slice(quoted.index + quoted[0].length);
      // Chicago author-date puts the year between the authors and the title: "Tversky. 1979. “Prospect Theory…”"
      const lead = before.match(new RegExp(`^(.*?)[\\s.,(]+(${YEAR})[a-z]?\\)?[.,:]?\\s*$`));
      const authorsPart = (lead ? lead[1] : before).replace(/[.,]\s*$/, "");
      const { authors, etAl } = parseAuthors(authorsPart);
      const isIeee = /^\s*(?:\p{Lu}\.\s?)+\p{Lu}/u.test(before.trim());
      const commaStyle = /,\s*$/.test(quoted[1]) || /^\s*,/.test(after);
      return {
        ...base,
        format: isIeee ? "ieee" : "mla",
        title: quoted[1].replace(/[,.]\s*$/, "").trim(),
        authors,
        etAl,
        year: lead ? Number(lead[2]) : (lastYear(after) ?? lastYear(body)),
        ...parseVenueTail(after, { commaStyle }),
      };
    }
  }

  // APA / Harvard: Authors (Year). Title. Venue…
  if (yearParen && yearParen.index !== undefined && (body.length - afterYear >= 10 || (body.length - afterYear >= 4 && yearParen.index <= body.length * 0.6))) {
    const authorsPart = body.slice(0, yearParen.index);
    const afterDate = body.slice(afterYear).replace(/^[\s.,:]+/, "");
    // "[Master's thesis, Massachusetts Institute of Technology]": the institution is the publisher.
    const thesis = afterDate.match(THESIS);
    // "(Eds.)," marks the editors of the book a chapter is in; keep it so the book title can be found.
    let rest = stripDescriptors(afterDate.replace(/\((Eds?\.)\)(?=,)/g, "⟦$1⟧")).replace(/⟦(Eds?\.)⟧/g, "($1)");
    let title: string;
    const quotedLead = leadingQuotedTitle(rest);
    if (quotedLead) {
      title = quotedLead.title;
      rest = quotedLead.after;
    } else {
      const end = titleEnd(rest);
      title = end === -1 ? rest : rest.slice(0, end + 1);
      rest = end === -1 ? "" : rest.slice(end + 1);
    }
    title = title.replace(/[.。]\s*$/, "").trim();
    const { authors, etAl } = parseAuthors(authorsPart, "inverted");
    const year = yearParen[1] ? Number(yearParen[1]) : undefined;
    const tail = parseVenueTail(rest, { commaStyle: Boolean(quotedLead) && /^\s*,/.test(rest) });
    if (thesis) tail.publisher ??= cleanPublisher(thesis[1]);
    return {
      ...base,
      format: /\)\s*\./.test(body.slice(yearParen.index, afterYear + 2)) ? "apa" : "harvard",
      title: title || undefined,
      authors,
      etAl,
      year,
      ...tail,
    };
  }

  // Harvard without brackets: "Smith, J. 2020. Title. Journal…"
  const yearBare = body.match(/[,.]\s*(1[5-9]\d\d|20\d\d)[a-z]?\.\s+/);
  if (yearBare && yearBare.index !== undefined && yearBare.index < 160) {
    const authorsPart = body.slice(0, yearBare.index);
    let rest = body.slice(yearBare.index + yearBare[0].length);
    const end = rest.search(/[.?!]\s+(?=[\p{Lu}\p{Lo}\p{N}])|[.?!]\s*$/u);
    const title = (end === -1 ? rest : rest.slice(0, end)).trim();
    rest = end === -1 ? "" : rest.slice(end + 1);
    const { authors, etAl } = parseAuthors(authorsPart, "inverted");
    return { ...base, format: "harvard", title: title || undefined, authors, etAl, year: Number(yearBare[1]), ...parseVenueTail(rest) };
  }

  // MLA / Chicago with an unquoted (italic) title: "Family, Given, et al. Title. Publisher, Year."
  const mla = body.match(MLA_LEAD);
  if (mla && body.length - mla[0].length >= 10) {
    const { authors, etAl } = parseAuthors(mla[1]);
    const rest = stripDescriptors(body.slice(mla[0].length));
    const end = titleEnd(rest);
    const title = (end === -1 ? rest : rest.slice(0, end + 1)).replace(/[.。]\s*$/, "").trim();
    // Only the MLA shape ("Family, Given …" with a spelled-out given name) is read here; other unbracketed
    // styles keep falling through to raw-text matching, as before.
    if (authors.length && title.length >= 4 && /\p{Ll}/u.test(authors[0].given ?? "")) {
      return { ...base, format: "mla", title, authors, etAl, year: lastYear(body), ...parseVenueTail(end === -1 ? "" : rest.slice(end + 1)) };
    }
  }

  // Unknown format: keep raw; the matcher will use raw-text containment.
  const years = [...body.matchAll(/\b(1[5-9]\d\d|20\d\d)\b/g)].map((m) => Number(m[1]));
  return { ...base, format: "text", year: years.length ? years[years.length - 1] : undefined };
}
