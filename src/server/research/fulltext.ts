import "server-only";
import { XMLParser } from "fast-xml-parser";
import type { CslItem } from "@/shared/types";
import { extractArxivId } from "@/shared/identifiers";
import { getCached } from "../scholarly/http";
import { europePmcFullTextUrl, europePmcOpenAccessPmcid, normalizePmcid } from "../scholarly/europepmc";

/**
 * Open-access full text, so claims can be checked against the paper itself
 * and not only its abstract.
 *   - Europe PMC: JATS XML of the open-access subset (by PMCID, or resolved from the DOI)
 *   - arXiv: the HTML rendering of a preprint (exists for most papers since late 2023)
 * No PDFs are parsed on the server. Every failure is a quiet `null`: the
 * caller then keeps working from the abstract.
 */

export const FULL_TEXT_MAX_CHARS = 40_000;
const MIN_USEFUL_CHARS = 600;
const TIMEOUT_MS = 10_000;

export type FullTextSource = "pmc" | "europepmc" | "arxiv";

export interface FullText {
  text: string;
  source: FullTextSource;
  /** A page where a person can read the same text. */
  url: string;
}

/* ───────────────────────── Shared: ordered XML tree → plain text ───────────────────────── */

type XmlNode = Record<string, unknown>;

const TEXT = "#text";
const ATTRS = ":@";

function tagOf(n: XmlNode): string | null {
  for (const k of Object.keys(n)) if (k !== ATTRS) return k;
  return null;
}

function kids(n: XmlNode, tag: string): XmlNode[] {
  const c = n[tag];
  return Array.isArray(c) ? (c as XmlNode[]) : [];
}

function attr(n: XmlNode, name: string): string {
  const a = n[ATTRS] as Record<string, unknown> | undefined;
  const v = a?.[`@_${name}`];
  return v === undefined || v === null ? "" : String(v);
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", times: "×", minus: "−", plusmn: "±", le: "≤", ge: "≥",
  deg: "°", micro: "µ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", mu: "μ", chi: "χ", kappa: "κ",
};

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return " ";
      try {
        return String.fromCodePoint(n);
      } catch {
        return " ";
      }
    }
    return NAMED[code.toLowerCase()] ?? m;
  });
}

/** Tidies a paragraph after citation markers, formulae and figures were removed from the middle of it. */
function tidy(s: string): string {
  return s
    .replace(/[\u0000-\u001F\u007F  -​ ⁠﻿]/g, " ")
    .replace(/\[\s*(?:[,;–-]\s*)*\]/g, "") // "[ , ]" left by numbered citations
    .replace(/\(\s*(?:[,;–-]\s*)*\)/g, "") // "( ; )" left by author–year citations
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?)\]])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .replace(/([,;])(?:\s*[,;])+/g, "$1")
    .replace(/,\s*\./g, ".")
    .trim();
}

function capParagraphs(paragraphs: string[], max: number): string {
  const out: string[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const p of paragraphs) {
    if (p.length < 30 || seen.has(p)) continue;
    if (total + p.length + 2 > max) break;
    seen.add(p);
    out.push(p);
    total += p.length + 2;
  }
  return out.join("\n\n");
}

/* ───────────────────────── JATS (Europe PMC, PubMed Central) ───────────────────────── */

const jatsParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  // Entities are decoded by hand (decodeEntities): nothing a remote document declares is ever expanded.
  processEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

/** Not prose: reference lists, tables, figures, formulae, footnotes, captions, labels. */
const JATS_SKIP = new Set([
  "ref-list", "table-wrap", "table-wrap-group", "table-wrap-foot", "table", "fig", "fig-group", "caption", "label",
  "disp-formula", "disp-formula-group", "inline-formula", "tex-math", "mml:math", "math", "alternatives",
  "supplementary-material", "graphic", "inline-graphic", "media", "fn-group", "fn", "object-id", "ack",
  "glossary", "def-list", "sig-block", "front-stub", "app-group", "notes", "sec-meta", "statement", "code", "preformat",
]);

/** Sections that are housekeeping, not findings. */
const JATS_SKIP_SECTION =
  /^(acknowledge?ments?|funding( (information|sources?|statement))?|authors?['’]? ?contributions?|competing interests?|conflicts? of interests?|declarations?( of .*)?|abbreviations|supplementary (materials?|information|data)|supporting information|data availability( statement)?|availability of data.*|ethic(s|al) (approval|statement|considerations?).*|publisher['’]?s note|consent (for|to) .*|references|electronic supplementary material)$/i;
const JATS_SKIP_SEC_TYPE = /supplementary|coi|conflict|data-availability|ethics|funding|ack|author-contrib/i;

function jatsInline(nodes: XmlNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (TEXT in n) {
      out += decodeEntities(String(n[TEXT]));
      continue;
    }
    const tag = tagOf(n);
    if (!tag || JATS_SKIP.has(tag)) continue;
    const inner = jatsInline(kids(n, tag));
    if (tag === "xref") {
      // Numbered citation markers ("1", "2–4") are noise; "Smith et al., 2020" and "Figure 2" read as text.
      if (attr(n, "ref-type") === "bibr" && /^[\s\d,;–-]*$/.test(inner)) continue;
      out += inner;
    } else if (tag === "sup") {
      if (/^[\s,;–-]*$/.test(inner)) continue; // only citation markers were inside
      out += /\d$/.test(out) && /^[\d−-]/.test(inner) ? `^${inner}` : inner; // 10^3 must not read as 103
    } else if (tag === "p" || tag === "list-item" || tag === "title" || tag === "break" || tag === "disp-quote") {
      out += ` ${inner} `;
    } else out += inner;
  }
  return out;
}

function jatsTitle(sec: XmlNode[]): string {
  for (const n of sec) if (tagOf(n) === "title") return tidy(jatsInline(kids(n, "title"))).replace(/^[\d.\s]+/, "");
  return "";
}

function jatsBlocks(nodes: XmlNode[], out: string[]) {
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag || tag === TEXT || JATS_SKIP.has(tag) || tag === "title") continue;
    const children = kids(n, tag);
    if (tag === "p") {
      const text = tidy(jatsInline(children));
      if (text) out.push(text);
    } else if (tag === "sec") {
      if (JATS_SKIP_SEC_TYPE.test(attr(n, "sec-type")) || JATS_SKIP_SECTION.test(jatsTitle(children))) continue;
      jatsBlocks(children, out);
    } else jatsBlocks(children, out);
  }
}

function findFirst(nodes: XmlNode[], want: string, depth = 0): XmlNode[] | null {
  if (depth > 6) return null;
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag || tag === TEXT) continue;
    if (tag === want) return kids(n, tag);
    if (tag === "front" || tag === "back") continue;
    const deeper = findFirst(kids(n, tag), want, depth + 1);
    if (deeper) return deeper;
  }
  return null;
}

/**
 * JATS article XML → the body's paragraphs as plain text (blank line between
 * paragraphs). The reference list, tables, figures, formulae and housekeeping
 * sections are left out. Returns null when there is no readable body. Pure.
 */
export function jatsToText(xml: string, maxChars = FULL_TEXT_MAX_CHARS): string | null {
  if (!xml || !/<body[\s>]/.test(xml) || !/<(article|pmc-articleset)[\s>]/.test(xml)) return null; // not JATS (e.g. an HTML error page)
  let tree: XmlNode[];
  try {
    tree = jatsParser.parse(xml) as XmlNode[];
  } catch {
    return null;
  }
  const body = findFirst(tree, "body");
  if (!body) return null;
  const paragraphs: string[] = [];
  jatsBlocks(body, paragraphs);
  const text = capParagraphs(paragraphs, maxChars);
  return text.length >= MIN_USEFUL_CHARS ? text : null;
}

/* ───────────────────────── arXiv HTML (LaTeXML) ───────────────────────── */

const htmlParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  allowBooleanAttributes: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  unpairedTags: ["br", "hr", "img", "input", "link", "meta", "source", "wbr", "col", "area", "base", "embed", "track"],
});

const HTML_SKIP_TAG = new Set(["figure", "table", "cite", "nav", "header", "footer", "script", "style", "svg", "button", "annotation", "annotation-xml", "figcaption", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "code"]);
const HTML_SKIP_CLASS = /\bltx_(bibliography|note|authors|abstract|acknowledgements|pagination|TOC|dates|role_footnote|ERROR|equation|equationgroup|listing|tag|keywords|classification)\b/;

function simpleMath(alt: string): string {
  const a = decodeEntities(alt).trim();
  // "N=6", "0.9", "p<0.05" read fine as text; real LaTeX ("\frac{…}") is dropped.
  return a.length <= 24 && /^[\w\s.,=<>+\-*/%()≤≥±×]+$/.test(a) ? a : "";
}

function htmlInline(nodes: XmlNode[]): string {
  let out = "";
  for (const n of nodes) {
    if (TEXT in n) {
      out += decodeEntities(String(n[TEXT]));
      continue;
    }
    const tag = tagOf(n);
    if (!tag) continue;
    if (tag === "math") {
      out += simpleMath(attr(n, "alttext"));
      continue;
    }
    if (HTML_SKIP_TAG.has(tag) || HTML_SKIP_CLASS.test(attr(n, "class"))) continue;
    const inner = htmlInline(kids(n, tag));
    out += tag === "br" || tag === "li" || tag === "p" || tag === "div" ? ` ${inner} ` : inner;
  }
  return out;
}

/** The heading of a <section>, without its number ("5.1 Training data" → "Training data"). */
function htmlHeading(section: XmlNode[]): string {
  for (const n of section) {
    const tag = tagOf(n);
    if (tag && /^h[1-6]$/.test(tag)) return tidy(htmlInline(kids(n, tag))).replace(/^[\dA-Z]{0,3}[.\d]*\s+(?=\p{L})/u, "");
  }
  return "";
}

function htmlBlocks(nodes: XmlNode[], out: string[]) {
  for (const n of nodes) {
    const tag = tagOf(n);
    if (!tag || tag === TEXT || tag === "math" || HTML_SKIP_TAG.has(tag) || HTML_SKIP_CLASS.test(attr(n, "class"))) continue;
    const children = kids(n, tag);
    if (tag === "p") {
      const text = tidy(htmlInline(children));
      if (text && !/^(key ?words|index terms)\b/i.test(text)) out.push(text);
    } else if (tag === "section" && JATS_SKIP_SECTION.test(htmlHeading(children))) continue;
    else htmlBlocks(children, out);
  }
}

/**
 * arXiv's HTML rendering of a paper → the body's paragraphs as plain text.
 * The bibliography, figures, tables, display equations, footnotes, the author
 * block and the abstract (already a source of passages) are left out. Pure.
 */
export function arxivHtmlToText(html: string, maxChars = FULL_TEXT_MAX_CHARS): string | null {
  if (!html || !/ltx_(document|page_main|para)\b/.test(html)) return null; // not a LaTeXML page (e.g. "no HTML for this paper")
  // Scripts, styles and comments are not markup worth parsing, and they are where stray "<" live.
  const lean = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!doctype[^>]*>/gi, " ");
  const start = lean.search(/<article\b/i);
  const end = lean.lastIndexOf("</article>");
  const scope = start >= 0 && end > start ? lean.slice(start, end + "</article>".length) : lean;
  let tree: XmlNode[];
  try {
    tree = htmlParser.parse(scope) as XmlNode[];
  } catch {
    return null;
  }
  const paragraphs: string[] = [];
  htmlBlocks(tree, paragraphs);
  const text = capParagraphs(paragraphs, maxChars);
  return text.length >= MIN_USEFUL_CHARS ? text : null;
}

/* ───────────────────────── Fetching ───────────────────────── */

function pmcidOf(csl: CslItem, openAccessUrl?: string | null): string | null {
  const own = typeof csl.PMCID === "string" || typeof csl.PMCID === "number" ? normalizePmcid(csl.PMCID) : null;
  if (own) return own;
  for (const u of [openAccessUrl, csl.URL]) {
    if (u && /europepmc\.org|ncbi\.nlm\.nih\.gov|pmc\.ncbi/i.test(u)) {
      const fromUrl = normalizePmcid(u);
      if (fromUrl) return fromUrl;
    }
  }
  return null;
}

function arxivIdOf(csl: CslItem, openAccessUrl?: string | null): string | null {
  // Only when the cited work IS the arXiv paper, or its open copy lives on arXiv.
  for (const s of [csl.DOI, typeof csl.arxiv === "string" ? `arXiv:${csl.arxiv}` : null, openAccessUrl, csl.URL]) {
    if (!s) continue;
    const id = extractArxivId(s);
    if (id) return id;
  }
  return null;
}

async function europePmcText(pmcid: string): Promise<FullText | null> {
  const r = await getCached<string | null>(europePmcFullTextUrl(pmcid), {
    parse: "text",
    accept: "application/xml",
    okStatuses: [404], // not in the open-access subset
    timeoutMs: TIMEOUT_MS,
    retries: 0,
    cooldownOnTimeoutMs: 3 * 60_000,
    // Cache the extracted text, not megabytes of XML.
    transform: (xml) => (typeof xml === "string" ? jatsToText(xml) : null),
  });
  return r.data ? { text: r.data, source: "europepmc", url: `https://europepmc.org/articles/${pmcid}` } : null;
}

/** PubMed Central's own API: the same JATS document as Europe PMC, and usually much quicker to answer. */
async function pmcText(pmcid: string): Promise<FullText | null> {
  const r = await getCached<string | null>(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=${encodeURIComponent(pmcid)}`, {
    parse: "text",
    accept: "application/xml",
    okStatuses: [400, 404],
    timeoutMs: TIMEOUT_MS,
    retries: 1,
    cooldownOn429Ms: 60_000,
    cooldownOnTimeoutMs: 2 * 60_000,
    transform: (xml) => (typeof xml === "string" ? jatsToText(xml) : null),
  });
  return r.data ? { text: r.data, source: "pmc", url: `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/` } : null;
}

/** DOI → PMCID through PubMed Central's ID converter. null when the paper is not in PubMed Central. */
async function pmcidForDoi(doi: string): Promise<string | null> {
  const r = await getCached<string | null>(`https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=${encodeURIComponent(doi)}&format=json&tool=knowlix`, {
    okStatuses: [400, 404],
    timeoutMs: 8000,
    retries: 1,
    cooldownOn429Ms: 60_000,
    cooldownOnTimeoutMs: 2 * 60_000,
    transform: (j) => normalizePmcid((j as { records?: { pmcid?: string }[] })?.records?.[0]?.pmcid ?? null),
  });
  return r.data ?? null;
}

async function arxivText(arxivId: string): Promise<FullText | null> {
  const url = `https://arxiv.org/html/${arxivId}`;
  const r = await getCached<string | null>(url, {
    parse: "text",
    accept: "text/html",
    okStatuses: [404], // older papers have no HTML rendering
    timeoutMs: TIMEOUT_MS,
    retries: 0,
    cooldownOn429Ms: 2 * 60_000,
    cooldownOnTimeoutMs: 2 * 60_000,
    transform: (html) => (typeof html === "string" ? arxivHtmlToText(html) : null),
  });
  return r.data ? { text: r.data, source: "arxiv", url } : null;
}

async function quiet<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * The open-access full text of a source as clean plain text (paragraphs
 * separated by a blank line, at most ~40,000 characters), or null when there
 * is none we may read. Never throws; each request gives up after 10 seconds.
 */
export async function fetchFullText(csl: CslItem, openAccessUrl?: string | null): Promise<{ text: string; source: FullTextSource; url: string } | null> {
  try {
    const knownPmcid = pmcidOf(csl, openAccessUrl);
    if (knownPmcid) {
      const hit = (await quiet(() => pmcText(knownPmcid))) ?? (await quiet(() => europePmcText(knownPmcid)));
      if (hit) return hit;
    }
    const arxivId = arxivIdOf(csl, openAccessUrl);
    if (arxivId) {
      const hit = await quiet(() => arxivText(arxivId));
      if (hit) return hit;
    }
    const doi = typeof csl.DOI === "string" ? csl.DOI.trim() : "";
    if (!knownPmcid && doi && !/^10\.48550\//i.test(doi)) {
      const viaPmc = await quiet(() => pmcidForDoi(doi));
      if (viaPmc) {
        const hit = (await quiet(() => pmcText(viaPmc))) ?? (await quiet(() => europePmcText(viaPmc)));
        if (hit) return hit;
        return null;
      }
      // PubMed Central did not answer or does not hold it: try Europe PMC's open-access subset.
      const pmcid = await quiet(() => europePmcOpenAccessPmcid(doi));
      if (pmcid) return await quiet(() => europePmcText(pmcid));
    }
    return null;
  } catch {
    return null;
  }
}
