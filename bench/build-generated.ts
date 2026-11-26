/**
 * Builds bench/data/generated.json: ~300 reference-check cases made from REAL
 * records sampled at random from Crossref and DataCite, plus fakes derived by
 * mutating those real records.
 *
 *   node --conditions=react-server --import tsx bench/build-generated.ts
 *
 * - Deterministic: one seed (SEED below) drives every random choice. Raw API
 *   answers are cached in bench/.cache/, so a rebuild makes no network calls
 *   and produces the same file. Delete bench/.cache/ to draw a fresh sample.
 * - Independent of the verifier: this file imports NOTHING from src/. The
 *   reference strings are rendered by the small hand-written templates below,
 *   so the benchmark does not test the app's formatter against itself.
 * - Polite: one request at a time per host, >= 1.2 s apart, back-off on 429.
 *   A `mailto` is added only if the CONTACT_EMAIL environment variable is set.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// BENCH_SEED draws a different sample (its own cache folder and output file), so a fresh,
// never-seen test set can be built after the checker has been changed.
const DEFAULT_SEED = 20261125;
const SEED = Number(process.env.BENCH_SEED) || DEFAULT_SEED;
const SUFFIX = SEED === DEFAULT_SEED ? "" : `-${SEED}`;
const CACHE_DIR = path.join(__dirname, `.cache${SUFFIX}`);
const OUT = path.join(__dirname, "data", `generated${SUFFIX}.json`);
const CONTACT = process.env.CONTACT_EMAIL?.trim() || "";
const UA = CONTACT ? `KnowlixBench/1.0 (mailto:${CONTACT})` : "KnowlixBench/1.0";

/* ───────────────────────── Seeded randomness ───────────────────────── */

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
type Rng = () => number;
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** One independent stream per purpose, so adding a category never reshuffles another. */
const rngFor = (name: string) => mulberry32(hash32(`${SEED}:${name}`));
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const pickOne = <T>(r: Rng, xs: T[]): T => xs[Math.floor(r() * xs.length)];
function shuffled<T>(r: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ───────────────────────── Polite cached HTTP ───────────────────────── */

interface Cached {
  url: string;
  status: number;
  fetchedAt: string;
  body: unknown;
}
const lastCall = new Map<string, number>();
let networkCalls = 0;

async function cachedGet(key: string, url: string, okStatuses: number[] = []): Promise<Cached> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as Cached;
  const host = new URL(url).host;
  const full = CONTACT && /crossref|datacite/.test(host) ? `${url}${url.includes("?") ? "&" : "?"}mailto=${encodeURIComponent(CONTACT)}` : url;
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = (lastCall.get(host) ?? 0) + 1200 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall.set(host, Date.now());
    networkCalls++;
    let res: Response | null = null;
    try {
      res = await fetch(full, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(45000) });
    } catch {
      res = null;
    }
    lastCall.set(host, Date.now());
    if (res && (res.ok || okStatuses.includes(res.status))) {
      const text = await res.text();
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      const out: Cached = { url, status: res.status, fetchedAt: new Date().toISOString(), body };
      fs.writeFileSync(file, JSON.stringify(out));
      return out;
    }
    const backoff = [4000, 10000, 20000, 40000, 60000][attempt] ?? 60000;
    process.stdout.write(`\n  [${host} answered ${res?.status ?? "nothing"}; waiting ${backoff / 1000}s]`);
    await new Promise((r) => setTimeout(r, backoff));
  }
  throw new Error(`Could not fetch ${url}`);
}
const urlKey = (prefix: string, url: string) => `${prefix}-${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;

/** doi.org Handle API: is this DOI registered with ANY agency? */
async function doiRegistered(doi: string): Promise<boolean> {
  const url = `https://doi.org/api/handles/${doi.split("/").map(encodeURIComponent).join("/")}`;
  const r = await cachedGet(urlKey("handle", url), url, [404]);
  const code = (r.body as { responseCode?: number } | null)?.responseCode;
  if (r.status === 404 || code === 100) return false;
  if (code === 1) return true;
  throw new Error(`doi.org gave an unclear answer for ${doi}: ${r.status}/${code}`);
}
/** Does Open Library know this ISBN? */
async function isbnKnown(isbn: string): Promise<boolean> {
  const url = `https://openlibrary.org/isbn/${isbn}.json`;
  const r = await cachedGet(urlKey("isbn", url), url, [404]);
  return r.status !== 404;
}
/** Closest existing Crossref title to an invented one (0..1), to make sure an "invented" title is not a real paper. */
async function closestRealTitle(title: string): Promise<{ sim: number; title: string; doi: string } | null> {
  const url = `https://api.crossref.org/works?query.title=${encodeURIComponent(title)}&rows=3&select=DOI,title`;
  const r = await cachedGet(urlKey("titlecheck", url), url);
  const items = ((r.body as { message?: { items?: { DOI: string; title?: string[] }[] } })?.message?.items ?? []).filter((i) => i.title?.[0]);
  let best: { sim: number; title: string; doi: string } | null = null;
  for (const it of items) {
    const sim = diceWords(title, it.title![0]);
    if (!best || sim > best.sim) best = { sim, title: it.title![0], doi: it.DOI };
  }
  return best;
}

/* ───────────────────────── Text helpers ───────────────────────── */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—" };
function clean(s: string | undefined | null): string {
  if (!s) return "";
  // Entities first: some registries store markup escaped ("&lt;h1&gt;…"), which must then be removed as markup.
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}
const letters = (s: string) => s.replace(/[^\p{L}]/gu, "");
const isAllCaps = (s: string) => {
  const l = letters(s);
  return l.length >= 6 && l === l.toUpperCase() && l !== l.toLowerCase();
};
function sentenceCase(s: string): string {
  const low = s.toLowerCase();
  return low.replace(/(^|[:?!]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}
function nameCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}
// Character classes are built from code points so the source file stays plain ASCII-safe to edit.
const codeRanges = (pairs: [number, number][]) => pairs.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join("");
const COMBINING_MARKS = new RegExp(`[${codeRanges([[0x300, 0x36f]])}]`, "g");
/** U+FFFD, the mark left behind when a registry record was saved in the wrong encoding. */
const BROKEN_CHAR = String.fromCodePoint(0xfffd);
function words(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
/** Word-overlap similarity (Dice). Deliberately NOT the verifier's own similarity function. */
function diceWords(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return (2 * both) / (x.size + y.size);
}
/** Greek, Cyrillic, Hebrew + Arabic, Indic scripts, Thai, Japanese kana, CJK ideographs, Korean. */
const NON_LATIN = new RegExp(`[${codeRanges([[0x370, 0x3ff], [0x400, 0x4ff], [0x590, 0x6ff], [0x900, 0xdff], [0xe00, 0xe7f], [0x3040, 0x30ff], [0x3400, 0x9fff], [0xac00, 0xd7af]])}]`);
/** Accented Latin letters (Latin-1 Supplement to Latin Extended-B). */
const DIACRITIC = new RegExp(`[${codeRanges([[0xc0, 0x24f]])}]`);
const FOREIGN_WORDS = new Set("de la el los las del en y un una para por con sobre e do da dos das em no na um uma como entre und der die das des zur zum für über bei von mit im le les du et sur dans pour aux une au di il della nel per degli sulla".split(" "));
const ENGLISH_WORDS = new Set("the of and in on for with to from by an at as is are".split(" "));
function looksNonEnglish(title: string): boolean {
  if (NON_LATIN.test(title)) return true;
  const w = title.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const f = w.filter((x) => FOREIGN_WORDS.has(x)).length;
  const e = w.filter((x) => ENGLISH_WORDS.has(x)).length;
  return f >= 2 && f > e;
}

/* ───────────────────────── Real works ───────────────────────── */

interface Author {
  family?: string;
  given?: string;
  literal?: string;
}
interface Work {
  doi: string;
  type: "journal-article" | "book-chapter" | "proceedings-article" | "book" | "posted-content" | "dataset" | "datacite-preprint" | "datacite-other";
  title: string;
  /** Title exactly as the registry holds it (after removing markup). */
  registryTitle: string;
  authors: Author[];
  year: number;
  container?: string;
  shortContainer?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  source: "crossref" | "datacite";
  pool: string;
  tags: string[];
  dataciteKind?: string;
}

const JUNK_TITLE =
  /^(front|back)\s?matter|\b(front|back) matter\b|^index\b|^indice\b|editorial|erratum|errata|corrigend|correction|^book reviews?|^reviews?\b|^review of|table of contents|^contents|^preface|^foreword|^introduction$|^abstracts?\b|obituar|masthead|issue information|\bcover\b|announcement|^news\b|^notes?\b|letters? to the editor|^letter\b|in memoriam|^repl(y|ies)\b|^untitled|^discussion\b|books? received|^literatur\b|^bibliograph|taxonomic abstract|^retracted|^withdrawn|^comment|^response to|^author index|^subject index|^list of|^title page|^acknowledg|^appendix|^chapter \d+$|^part \d+|^volume \d+|faculty opinions recommendation|^peer review|^decision letter|^review for|^supplementary|^data from:|^figure|^table \d|^cheminform abstract|\bISBN\b|^about the authors?|\(review\)$/i;

/**
 * Students name the preprint server ("SSRN", "Research Square"), not the company that registered the DOI
 * ("Elsevier BV", "Springer Science and Business Media LLC"), so preprints are written the way APA 7 asks.
 */
const PREPRINT_SERVERS: Record<string, string> = { "10.2139": "SSRN", "10.21203": "Research Square", "10.20944": "Preprints.org", "10.26434": "ChemRxiv", "10.31234": "PsyArXiv", "10.31219": "OSF Preprints", "10.36227": "TechRxiv", "10.22541": "Authorea", "10.31235": "SocArXiv", "10.35542": "EdArXiv" };

interface CrossrefRecord {
  DOI: string;
  type?: string;
  title?: string[];
  subtitle?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  "container-title"?: string[];
  "short-container-title"?: string[];
  publisher?: string;
  issued?: { "date-parts"?: (number | null)[][] };
  volume?: string;
  issue?: string;
  page?: string;
  "updated-by"?: { type?: string }[];
  "update-to"?: { type?: string }[];
}

function cleanAuthors(list: { given?: string; family?: string; name?: string }[] | undefined): Author[] {
  const out: Author[] = [];
  for (const a of list ?? []) {
    // Footnote marks ("Xue*", "Felix †") are typesetting leftovers, not part of the name.
    let family = clean(a.family).replace(/\s*[*†‡§]+/g, "");
    const given = clean(a.given).replace(/\s*[*†‡§]+/g, "").replace(/,+$/, "");
    const literal = clean(a.name).replace(/[\s,.;]+$/, "");
    if (/^(&?n\/?a;?|et\.? al\.?|anon\.?|anonymous)$/i.test(family)) continue; // placeholders, not people
    if (family) {
      if (isAllCaps(family) || (family.length > 2 && family === family.toUpperCase() && family !== family.toLowerCase())) family = nameCase(family);
      out.push({ family, given: given ? (isAllCaps(given) ? nameCase(given) : given) : undefined });
    } else if (literal && !/rights (now )?managed|^anonymous$|^unknown$/i.test(literal)) out.push({ literal });
  }
  return out;
}

function hasRepeatedAuthor(authors: Author[]): boolean {
  const names = authors.map((a) => `${a.family ?? a.literal}|${a.given ?? ""}`.toLowerCase());
  return new Set(names).size !== names.length;
}

function tagsFor(w: Pick<Work, "title" | "authors" | "year">): string[] {
  const t: string[] = [];
  if (w.authors.length >= 8) t.push("many-authors");
  if (w.authors.length === 1) t.push("single-author");
  if (w.authors.some((a) => a.literal)) t.push("org-author");
  if (/[:?]\s+\S|\s[–—-]\s/.test(w.title)) t.push("subtitle");
  if (DIACRITIC.test(w.title) || w.authors.some((a) => DIACRITIC.test(`${a.family ?? ""}${a.given ?? ""}`))) t.push("diacritics");
  if (NON_LATIN.test(w.title)) t.push("non-latin-script");
  if (looksNonEnglish(w.title)) t.push("non-english");
  t.push(w.year < 1980 ? "pre-1980" : w.year < 2000 ? "1980-1999" : w.year < 2015 ? "2000-2014" : "2015-2025");
  return t;
}

/** Why a sampled record was not used (counted in the build report). */
const skipReasons: Record<string, number> = {};
const skip = (why: string) => {
  skipReasons[why] = (skipReasons[why] ?? 0) + 1;
  return null;
};

function titleOk(title: string): string | null {
  if (!title) return "no title";
  if (title.includes(BROKEN_CHAR) || title.startsWith("?")) return "title contains a broken character";
  if (/<mml:|\$|\\[a-z]+\{/.test(title)) return "title contains maths markup";
  if (JUNK_TITLE.test(title)) return "not a citable item (front matter, erratum, review, index…)";
  if (NON_LATIN.test(title)) return title.length >= 6 ? null : "title too short";
  if (title.length < 15 || title.split(/\s+/).length < 3) return "title shorter than three words";
  if (title.length > 300) return "title too long";
  return null;
}

function fromCrossref(r: CrossrefRecord, pool: string): Work | null {
  const rawTitle = clean(r.title?.[0]);
  const sub = clean(r.subtitle?.[0]);
  let registryTitle = rawTitle.replace(/\s*[.:]+$/, "");
  if (sub && !rawTitle.toLowerCase().includes(sub.toLowerCase())) registryTitle = `${registryTitle.replace(/\s*:$/, "")}: ${sub.replace(/\s*[.]$/, "")}`;
  const bad = titleOk(registryTitle);
  if (bad) return skip(bad);
  const authors = cleanAuthors(r.author);
  if (!authors.length) return skip("no author");
  if (hasRepeatedAuthor(authors)) return skip("same author listed more than once (broken or spam record)");
  if (authors.some((a) => (a.family ?? "").length > 40 || (a.literal ?? "").length > 90 || /\b(professor|doctor of|student of)\b/i.test(`${a.family ?? ""} ${a.given ?? ""} ${a.literal ?? ""}`) || /\b(university|institute)\b/i.test(`${a.family ?? ""} ${a.given ?? ""}`))) return skip("job title or affiliation typed into the author field");
  const first = authors[0];
  if (first.family && letters(first.family).length < 2) return skip("first author is only an initial");
  const year = r.issued?.["date-parts"]?.[0]?.[0];
  if (!year || year < 1800 || year > 2026) return skip("no usable year");
  if ([...(r["updated-by"] ?? []), ...(r["update-to"] ?? [])].some((u) => /retract|withdraw/i.test(u.type ?? ""))) return skip("retracted or a retraction notice");
  const type = (r.type ?? "") as Work["type"];
  if (!["journal-article", "book-chapter", "proceedings-article", "book", "posted-content", "dataset"].includes(type)) return skip("other type");
  const container = clean(r["container-title"]?.[0]) || undefined;
  if (type === "journal-article" && !container) return skip("journal article without a journal name");
  if (container?.includes(BROKEN_CHAR)) return skip("title contains a broken character");
  if (container && diceWords(container, registryTitle) > 0.9) return skip("title repeats the journal name");
  let page = clean(r.page).replace(/\s/g, "");
  const same = page.match(/^(\w+)-(\w+)$/);
  if (same && same[1] === same[2]) page = same[1]; // "73-73" → "73"
  // Some records hold placeholder zeros ("vol. 0, pp. 0-0"); nobody would cite those.
  const real0 = (v: string | undefined) => (v && !/^(0+|null|none|undefined)$/i.test(v) ? v : undefined);
  const title = isAllCaps(registryTitle) ? sentenceCase(registryTitle) : registryTitle;
  const w: Work = {
    doi: r.DOI,
    type,
    title,
    registryTitle,
    authors,
    year,
    container,
    shortContainer: clean(r["short-container-title"]?.[0]) || undefined,
    publisher: (type === "posted-content" ? PREPRINT_SERVERS[r.DOI.split("/")[0]] : undefined) ?? (clean(r.publisher) || undefined),
    volume: /^[\w.-]{1,8}$/.test(r.volume ?? "") ? real0(r.volume) : undefined,
    issue: /^[\w./-]{1,8}$/.test(r.issue ?? "") ? real0(r.issue) : undefined,
    pages: /^[A-Za-z]?\d+(-[A-Za-z]?\d+)?$/.test(page) && !/^0+(-0+)?$/.test(page) ? page : undefined,
    source: "crossref",
    pool,
    tags: [],
  };
  if (title !== registryTitle) w.tags.push("caps-normalised");
  w.tags.push(...tagsFor(w));
  return w;
}

interface DataCiteRecord {
  id: string;
  attributes: {
    doi: string;
    titles?: { title?: string }[];
    creators?: { name?: string; givenName?: string; familyName?: string; nameType?: string }[];
    publicationYear?: number;
    publisher?: string | { name?: string };
    types?: { resourceTypeGeneral?: string; resourceType?: string };
  };
}
function fromDataCite(r: DataCiteRecord, pool: string): Work | null {
  const a = r.attributes;
  const registryTitle = clean(a.titles?.[0]?.title).replace(/\s*[.]$/, "");
  const bad = titleOk(registryTitle);
  if (bad) return skip(bad);
  const kind = `${a.types?.resourceTypeGeneral ?? ""}/${a.types?.resourceType ?? ""}`;
  if (/taxonomic|figure|image|photo|video|audio|poster|presentation|lesson|other/i.test(kind)) return skip("not a citable text, dataset or software record");
  if (pool === "zenodo" && /^[\w.-]+\/[\w.-]+: /.test(registryTitle)) return skip("automatic GitHub release record");
  const authors: Author[] = [];
  for (const c of a.creators ?? []) {
    const family = clean(c.familyName);
    const given = clean(c.givenName);
    if (family && given && family !== given) authors.push({ family, given });
    else if (c.nameType === "Organizational" && clean(c.name)) authors.push({ literal: clean(c.name) });
    else return skip("creator name not split into given/family");
  }
  if (!authors.length) return skip("no author");
  if (!a.publicationYear) return skip("no usable year");
  const publisher = typeof a.publisher === "string" ? a.publisher : a.publisher?.name;
  const w: Work = {
    doi: a.doi,
    type: pool === "arxiv" ? "datacite-preprint" : "datacite-other",
    title: registryTitle,
    registryTitle,
    authors,
    year: a.publicationYear,
    publisher: clean(publisher) || (pool === "arxiv" ? "arXiv" : "Zenodo"),
    source: "datacite",
    pool,
    tags: [],
    dataciteKind: a.types?.resourceTypeGeneral,
  };
  w.tags.push(...tagsFor(w));
  return w;
}

const SELECT = "DOI,type,title,subtitle,author,container-title,short-container-title,publisher,issued,volume,issue,page,update-to,updated-by";
/** label → Crossref `filter`. Each label is one request for 100 random records. */
const CROSSREF_SAMPLES: [string, string][] = [
  ["ja-pre1980-a", "type:journal-article,until-pub-date:1979"],
  ["ja-pre1980-b", "type:journal-article,until-pub-date:1979"],
  ["ja-pre1980-c", "type:journal-article,from-pub-date:1950,until-pub-date:1979"],
  ["ja-1980-1999-a", "type:journal-article,from-pub-date:1980,until-pub-date:1999"],
  ["ja-1980-1999-b", "type:journal-article,from-pub-date:1980,until-pub-date:1999"],
  ["ja-2000-2014-a", "type:journal-article,from-pub-date:2000,until-pub-date:2014"],
  ["ja-2000-2014-b", "type:journal-article,from-pub-date:2000,until-pub-date:2014"],
  ["ja-2015-2025-a", "type:journal-article,from-pub-date:2015,until-pub-date:2025"],
  ["ja-2015-2025-b", "type:journal-article,from-pub-date:2015,until-pub-date:2025"],
  ["chapter-a", "type:book-chapter"],
  ["chapter-b", "type:book-chapter"],
  ["proceedings-a", "type:proceedings-article"],
  ["book-a", "type:book"],
  ["book-b", "type:monograph"],
  ["preprint-a", "type:posted-content"],
  ["dataset-a", "type:dataset"],
  ["dataset-b", "type:dataset"],
  // Publishers whose records are mostly not in English (non-English titles, diacritics, non-Latin scripts).
  ["lang-scielo", "type:journal-article,prefix:10.1590"],
  ["lang-openedition", "prefix:10.4000"],
  ["lang-ru-a", "type:journal-article,prefix:10.31857"],
  ["lang-ru-b", "type:journal-article,prefix:10.17223"],
  ["lang-jstage", "type:journal-article,prefix:10.2208"],
  ["lang-de", "type:journal-article,prefix:10.1515,until-pub-date:1990"],
];
const DATACITE_SAMPLES: [string, string][] = [
  ["arxiv", "https://api.datacite.org/dois?prefix=10.48550&random=true&page%5Bsize%5D=60"],
  ["zenodo", "https://api.datacite.org/dois?client-id=cern.zenodo&random=true&page%5Bsize%5D=100&resource-type-id=dataset,software,text"],
  ["zenodo", "https://api.datacite.org/dois?client-id=cern.zenodo&random=true&page%5Bsize%5D=100&resource-type-id=dataset,text"],
];

async function loadPools(): Promise<{ pools: Map<string, Work[]>; sampledAt: string; rawCounts: Record<string, number> }> {
  const pools = new Map<string, Work[]>();
  const rawCounts: Record<string, number> = {};
  const seen = new Set<string>();
  let sampledAt = "";
  const add = (pool: string, w: Work | null) => {
    if (!w) return;
    const k = w.doi.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    if (!pools.has(pool)) pools.set(pool, []);
    pools.get(pool)!.push(w);
  };
  for (const [label, filter] of CROSSREF_SAMPLES) {
    process.stdout.write(`\nCrossref sample ${label} …`);
    const url = `https://api.crossref.org/works?sample=100&filter=${filter}&select=${SELECT}`;
    const r = await cachedGet(`crossref-sample-${label}`, url, [404]);
    const items = (r.body as { message?: { items?: CrossrefRecord[] } })?.message?.items ?? [];
    if (r.fetchedAt > sampledAt) sampledAt = r.fetchedAt;
    const pool = label.replace(/-[a-z]$/, "");
    rawCounts[pool] = (rawCounts[pool] ?? 0) + items.length;
    for (const it of items) add(pool, fromCrossref(it, pool));
    process.stdout.write(` ${items.length} records, ${pools.get(pool)?.length ?? 0} usable so far`);
  }
  let n = 0;
  for (const [pool, url] of DATACITE_SAMPLES) {
    process.stdout.write(`\nDataCite sample ${pool} …`);
    const r = await cachedGet(`datacite-sample-${pool}-${++n}`, url);
    const items = (r.body as { data?: DataCiteRecord[] })?.data ?? [];
    if (r.fetchedAt > sampledAt) sampledAt = r.fetchedAt;
    rawCounts[pool] = (rawCounts[pool] ?? 0) + items.length;
    for (const it of items) add(pool, fromDataCite(it, pool));
    process.stdout.write(` ${items.length} records, ${pools.get(pool)?.length ?? 0} usable so far`);
  }
  // Stable order inside each pool, independent of the order the API happened to return.
  for (const list of pools.values()) list.sort((a, b) => a.doi.toLowerCase().localeCompare(b.doi.toLowerCase()));
  return { pools, sampledAt, rawCounts };
}

/* ───────────────────────── Reference styles (hand-written templates) ───────────────────────── */

type Style = "apa7" | "mla9" | "harvard" | "ieee" | "chicago" | "vancouver" | "bibtex" | "bare-doi" | "doi-url" | "arxiv-id";
const PROSE_STYLES: Style[] = ["apa7", "mla9", "harvard", "ieee", "chicago", "vancouver"];

/** What is actually written in the reference (a Work, possibly altered on purpose). */
interface Cite {
  type: Work["type"];
  title: string;
  authors: Author[];
  year: number;
  container?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  isbn?: string;
  /** "Smith, J., et al." regardless of how many authors there are. */
  forceEtAl?: boolean;
  /** Write given names in full where the style would use initials. */
  fullGiven?: boolean;
  dataciteKind?: string;
}
const citeOf = (w: Work, withDoi: boolean): Cite => ({
  type: w.type,
  title: w.title,
  authors: w.authors,
  year: w.year,
  container: w.container,
  publisher: w.publisher,
  volume: w.volume,
  issue: w.issue,
  pages: w.pages,
  doi: withDoi ? w.doi : undefined,
  dataciteKind: w.dataciteKind,
});

function initialsOf(given: string | undefined): string[] {
  if (!given) return [];
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((tok) =>
      tok
        .split("-")
        .filter(Boolean)
        .map((p) => p[0].toUpperCase())
        .join("-"),
    );
}
const famFirst = (a: Author, sep: string, full: boolean) => {
  if (a.literal) return a.literal;
  if (!a.given) return a.family!;
  if (full) return `${a.family}, ${a.given}`;
  const ini = initialsOf(a.given);
  return `${a.family}, ${ini.map((i) => `${i}.`).join(sep)}`;
};
const givenFirst = (a: Author, full: boolean) => {
  if (a.literal) return a.literal;
  if (!a.given) return a.family!;
  return full ? `${a.given} ${a.family}` : `${initialsOf(a.given).map((i) => `${i}.`).join(" ")} ${a.family}`;
};
const endDot = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);
const dash = (p: string | undefined) => p?.replace("-", "–");
/** "pp. 12–34" for a range, "p. 12" for a single page. */
const pp = (p: string) => `${p.includes("-") ? "pp." : "p."} ${dash(p)}`;
const isPart = (c: Cite) => c.type === "book-chapter" || c.type === "proceedings-article";
const isWhole = (c: Cite) => c.type === "book" || c.type === "dataset" || c.type === "posted-content" || c.type === "datacite-preprint" || c.type === "datacite-other";
const descriptor = (c: Cite) => (c.type === "dataset" || c.dataciteKind === "Dataset" ? " [Data set]" : c.dataciteKind === "Software" ? " [Computer software]" : "");
const join = (parts: (string | undefined | false)[], sep = " ") => parts.filter(Boolean).join(sep);

function apa(c: Cite): string {
  const names = c.authors.map((a) => famFirst(a, " ", Boolean(c.fullGiven)));
  let au: string;
  if (c.forceEtAl) au = `${names[0]}, et al.`;
  else if (names.length === 1) au = names[0];
  else if (names.length === 2) au = `${names[0]}, & ${names[1]}`;
  else if (names.length <= 20) au = `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  else au = `${names.slice(0, 19).join(", ")}, . . . ${names[names.length - 1]}`;
  const head = `${au}${au.endsWith(".") ? "" : "."} (${c.year}). ${endDot(c.title + descriptor(c))}`;
  let tail = "";
  if (c.type === "journal-article") {
    const nums = join([c.volume ? `${c.volume}${c.issue ? `(${c.issue})` : ""}` : undefined, dash(c.pages)], ", ");
    tail = `${c.container}${nums ? `, ${nums}` : ""}.`;
  } else if (isPart(c)) {
    tail = join([c.container ? `In ${c.container}${c.pages ? ` (${pp(c.pages)})` : ""}.` : undefined, c.publisher ? endDot(c.publisher) : undefined]);
  } else tail = c.publisher ? endDot(c.publisher) : "";
  return join([head, tail, c.isbn ? `ISBN ${c.isbn}.` : undefined, c.doi ? `https://doi.org/${c.doi}` : undefined]);
}

function mla(c: Cite): string {
  const a = c.authors;
  const first = a[0].literal ?? (a[0].given ? `${a[0].family}, ${a[0].given}` : a[0].family!);
  let au: string;
  if (c.forceEtAl || a.length >= 3) au = `${first}, et al.`;
  else if (a.length === 2) au = `${first}, and ${givenFirst(a[1], true)}.`;
  else au = endDot(first);
  const t = isWhole(c) && c.type !== "posted-content" && c.type !== "datacite-preprint" ? endDot(c.title) : `“${endDot(c.title)}”`;
  let tail: string;
  if (c.type === "journal-article") tail = `${join([c.container, c.volume ? `vol. ${c.volume}` : undefined, c.issue ? `no. ${c.issue}` : undefined, String(c.year), c.pages ? pp(c.pages) : undefined], ", ")}.`;
  else if (isPart(c)) tail = `${join([c.container, c.publisher, String(c.year), c.pages ? pp(c.pages) : undefined], ", ")}.`;
  else tail = `${join([c.publisher, String(c.year)], ", ")}.`;
  return join([au, t, tail, c.isbn ? `ISBN ${c.isbn}.` : undefined, c.doi ? `https://doi.org/${c.doi}.` : undefined]);
}

function harvard(c: Cite): string {
  const names = c.authors.map((a) => famFirst(a, "", Boolean(c.fullGiven)));
  let au: string;
  if (c.forceEtAl || names.length > 6) au = `${names[0]} et al.`;
  else if (names.length === 1) au = names[0];
  else au = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  let rest: string;
  if (c.type === "journal-article") rest = `‘${c.title}’, ${join([c.container, c.volume ? `${c.volume}${c.issue ? `(${c.issue})` : ""}` : undefined, c.pages ? pp(c.pages) : undefined], ", ")}.`;
  else if (isPart(c)) rest = `‘${c.title}’, in ${join([c.container, c.publisher, c.pages ? pp(c.pages) : undefined], ", ")}.`;
  else rest = join([endDot(c.title + descriptor(c)), c.publisher ? endDot(c.publisher) : undefined]);
  return join([`${au} (${c.year})`, rest, c.isbn ? `ISBN: ${c.isbn}.` : undefined, c.doi ? `doi:${c.doi}.` : undefined]);
}

function ieee(c: Cite): string {
  const names = c.authors.map((a) => givenFirst(a, Boolean(c.fullGiven)));
  let au: string;
  if (c.forceEtAl || names.length > 6) au = `${names[0]} et al.`;
  else if (names.length === 1) au = names[0];
  else if (names.length === 2) au = `${names[0]} and ${names[1]}`;
  else au = `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  let body: string;
  if (c.type === "journal-article") body = `“${c.title},” ${join([c.container, c.volume ? `vol. ${c.volume}` : undefined, c.issue ? `no. ${c.issue}` : undefined, c.pages ? pp(c.pages) : undefined, String(c.year)], ", ")}`;
  else if (isPart(c)) body = `“${c.title},” in ${join([c.container, c.publisher, String(c.year), c.pages ? pp(c.pages) : undefined], ", ")}`;
  else body = `${c.title}${descriptor(c)}. ${join([c.publisher, String(c.year)], ", ")}`;
  return `${au}, ${body}${c.isbn ? `, ISBN: ${c.isbn}` : ""}${c.doi ? `, doi: ${c.doi}` : ""}.`;
}

function chicago(c: Cite): string {
  const a = c.authors;
  const first = a[0].literal ?? (a[0].given ? `${a[0].family}, ${a[0].given}` : a[0].family!);
  const others = a.slice(1).map((x) => givenFirst(x, true));
  let au: string;
  if (c.forceEtAl) au = `${first}, et al.`;
  else if (a.length === 1) au = endDot(first);
  else if (a.length > 10) au = `${[first, ...others.slice(0, 6)].join(", ")}, et al.`;
  else au = `${[first, ...others.slice(0, -1)].join(", ")}, and ${others[others.length - 1]}.`;
  let body: string;
  if (c.type === "journal-article") {
    const nums = join([c.volume, c.issue ? `no. ${c.issue}` : undefined], ", ");
    body = `“${endDot(c.title)}” ${c.container}${nums ? ` ${nums}` : ""} (${c.year})${c.pages ? `: ${dash(c.pages)}` : ""}.`;
  } else if (isPart(c)) body = `“${endDot(c.title)}” In ${c.container ?? ""}${c.pages ? `, ${dash(c.pages)}` : ""}. ${join([c.publisher, String(c.year)], ", ")}.`;
  else body = `${endDot(c.title + descriptor(c))} ${join([c.publisher, String(c.year)], ", ")}.`;
  return join([au, body, c.isbn ? `ISBN ${c.isbn}.` : undefined, c.doi ? `https://doi.org/${c.doi}.` : undefined]);
}

function vancouver(c: Cite): string {
  const names = c.authors.map((a) => a.literal ?? `${a.family}${a.given ? ` ${c.fullGiven ? a.given : initialsOf(a.given).join("").replace(/-/g, "")}` : ""}`);
  const au = c.forceEtAl ? `${names[0]}, et al` : names.length > 6 ? `${names.slice(0, 6).join(", ")}, et al` : names.join(", ");
  let body: string;
  if (c.type === "journal-article") body = `${endDot(c.title)} ${endDot(c.container ?? "")} ${c.year}${c.volume ? `;${c.volume}${c.issue ? `(${c.issue})` : ""}` : ""}${c.pages ? `:${c.pages}` : ""}.`;
  else if (isPart(c)) body = `${endDot(c.title)} In: ${c.container ?? ""}. ${join([c.publisher, String(c.year)], "; ")}.${c.pages ? ` p. ${c.pages}.` : ""}`;
  else body = `${endDot(c.title + descriptor(c))} ${join([c.publisher, String(c.year)], "; ")}.`;
  return join([`${au}.`, body, c.isbn ? `ISBN ${c.isbn}.` : undefined, c.doi ? `doi:${c.doi}` : undefined]);
}

function bibtex(c: Cite): string {
  const esc = (s: string) => s.replace(/[{}]/g, "").replace(/([&%#_])/g, "\\$1");
  const kind = c.type === "journal-article" ? "article" : c.type === "book-chapter" ? "incollection" : c.type === "proceedings-article" ? "inproceedings" : c.type === "book" ? "book" : "misc";
  const key = `${words(c.authors[0].family ?? c.authors[0].literal ?? "anon")[0] ?? "anon"}${c.year}${words(c.title).find((w) => w.length > 3) ?? ""}`;
  const authors = c.authors.map((a) => (a.literal ? `{${esc(a.literal)}}` : a.given ? `${esc(a.family!)}, ${esc(a.given)}` : esc(a.family!))).join(" and ");
  const f: [string, string | undefined][] = [
    ["author", authors],
    ["title", `{${esc(c.title)}}`],
    [kind === "article" ? "journal" : kind === "incollection" || kind === "inproceedings" ? "booktitle" : "", c.container ? esc(c.container) : undefined],
    ["year", String(c.year)],
    ["volume", c.volume],
    ["number", c.issue],
    ["pages", c.pages?.replace("-", "--")],
    ["publisher", c.publisher ? esc(c.publisher) : undefined],
    ["isbn", c.isbn],
    ["doi", c.doi],
  ];
  return `@${kind}{${key},\n${f
    .filter(([k, v]) => k && v)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n")}\n}`;
}

function render(c: Cite, style: Style): string {
  switch (style) {
    case "apa7":
      return apa(c);
    case "mla9":
      return mla(c);
    case "harvard":
      return harvard(c);
    case "ieee":
      return ieee(c);
    case "chicago":
      return chicago(c);
    case "vancouver":
      return vancouver(c);
    case "bibtex":
      return bibtex(c);
    case "bare-doi":
      return c.doi!;
    case "doi-url":
      return `https://doi.org/${c.doi}`;
    case "arxiv-id": {
      // The way arXiv itself and Google Scholar suggest citing a preprint.
      const id = c.doi!.replace(/^10\.48550\/arxiv\./i, "");
      return `${apa({ ...c, doi: undefined, publisher: undefined }).trim()} arXiv preprint arXiv:${id}.`;
    }
  }
}

/* ───────────────────────── Case model ───────────────────────── */

type Label = "verified" | "check" | "mismatch";
interface Case {
  id: string;
  category: string;
  kind: "real" | "imperfect" | "fake";
  style: Style;
  input: string;
  acceptable: Label[];
  mustNot: Label[];
  truth: { doi?: string; title: string; firstAuthor?: string; year?: number; source: "crossref" | "datacite"; role: string };
  tags: string[];
  note: string;
}
interface CategoryInfo {
  id: string;
  name: string;
  description: string;
  kind: Case["kind"];
}
const CATEGORIES: CategoryInfo[] = [
  { id: "real-journal-doi", kind: "real", name: "Journal article, with DOI", description: "Random real journal articles from the 1800s to 2025, written out in six citation styles with the correct DOI." },
  { id: "real-journal-nodoi", kind: "real", name: "Journal article, no DOI", description: "Random real journal articles written out without any DOI, so they must be found by searching." },
  { id: "real-chapter", kind: "real", name: "Book chapter", description: "Random real book chapters, half with their DOI and half without." },
  { id: "real-proceedings", kind: "real", name: "Conference paper", description: "Random real conference papers, half with their DOI and half without." },
  { id: "real-book", kind: "real", name: "Book", description: "Random real books and monographs, half with their DOI and half without." },
  { id: "real-preprint", kind: "real", name: "Preprint (Crossref)", description: "Random real preprints registered with Crossref (bioRxiv, Research Square, SSRN and similar)." },
  { id: "real-dataset", kind: "real", name: "Dataset (Crossref)", description: "Random real dataset records registered with Crossref, cited with their DOI." },
  { id: "real-non-english", kind: "real", name: "Non-English title", description: "Real works whose titles are not in English (Portuguese, Spanish, French, German, Russian, Japanese…), half with DOI and half without." },
  { id: "real-datacite", kind: "real", name: "arXiv and Zenodo (DataCite)", description: "Random real arXiv preprints and Zenodo records. Their DOIs are issued by DataCite, not Crossref." },
  { id: "real-bare-doi", kind: "real", name: "Only a DOI", description: "A real DOI on its own, or as a doi.org link, with no other details." },
  { id: "real-bibtex", kind: "real", name: "BibTeX entry", description: "Random real works written as BibTeX entries." },
  { id: "imperfect-year-off-one", kind: "imperfect", name: "Year off by one", description: "A real work with the year one too high or one too low." },
  { id: "imperfect-title-typo", kind: "imperfect", name: "Typo in the title", description: "A real work with one or two letters swapped in the title." },
  { id: "imperfect-full-first-names", kind: "imperfect", name: "First names spelled out", description: "A real work where the student wrote full first names where the style expects initials." },
  { id: "imperfect-et-al", kind: "imperfect", name: "Cut to “et al.”", description: "A real work with several authors, written as the first author plus “et al.”." },
  { id: "imperfect-journal-abbrev", kind: "imperfect", name: "Abbreviated journal name", description: "A real article with the journal name abbreviated (for example “J. Appl. Phys.”)." },
  { id: "imperfect-missing-vol-pages", kind: "imperfect", name: "Volume and pages left out", description: "A real article with no volume, issue or page numbers." },
  { id: "imperfect-title-allcaps", kind: "imperfect", name: "Title in capitals", description: "A real work with the title typed in ALL CAPITALS." },
  { id: "imperfect-title-lowercase", kind: "imperfect", name: "Title without capitals", description: "A real work with the title typed entirely in lower case." },
  { id: "fake-invented-doi", kind: "fake", name: "Invented DOI on a real title", description: "A real reference, but its DOI is replaced by a made-up one under the same publisher prefix. No registry has that DOI." },
  { id: "fake-doi-wrong-paper", kind: "fake", name: "Real DOI, different paper", description: "A real DOI attached to an invented title and invented authors." },
  { id: "fake-fabricated-no-doi", kind: "fake", name: "Fully invented paper", description: "Invented title and authors in a real journal, with no DOI. It can never be proven wrong, but it must never be called verified." },
  { id: "fake-wrong-authors-year", kind: "fake", name: "Real title, wrong authors and year", description: "The title of a real paper, credited to invented authors in the wrong year, with no DOI." },
  { id: "fake-chimera", kind: "fake", name: "Chimera of two real papers", description: "The real authors, year and journal of one paper combined with the title of another, with no DOI." },
  { id: "fake-transposed-doi", kind: "fake", name: "DOI with two characters swapped", description: "A real reference whose DOI has two neighbouring characters swapped, so it no longer points to that paper." },
  { id: "fake-invented-book-isbn", kind: "fake", name: "Invented book with a fake ISBN", description: "An invented book from a real publisher, with an ISBN that passes the checksum but that Open Library has never seen." },
];

/* ───────────────────────── Invented content for fakes ───────────────────────── */

const BANK = {
  effect: ["Effects", "Impact", "Influence", "Long-term effects", "The moderating role"],
  intervention: ["peer-led tutoring", "intermittent fasting", "microfinance access", "mindfulness training", "remote work mandates", "school meal subsidies", "gamified feedback", "urban green corridors", "telehealth follow-up", "probiotic supplementation", "flipped classroom instruction", "carbon pricing signals", "night-shift rotation", "bilingual instruction", "community policing reforms"],
  outcome: ["reading fluency", "glycaemic variability", "household savings", "working memory", "employee turnover", "sleep quality", "voter turnout", "soil microbial diversity", "medication adherence", "credit default rates", "academic self-efficacy", "post-operative recovery", "inflation expectations", "burnout symptoms"],
  population: ["first-generation undergraduates", "older adults with type 2 diabetes", "smallholder farmers", "adolescent athletes", "rural primary schools", "public-sector nurses", "small manufacturing firms", "early-career teachers", "migrant households", "post-stroke patients", "urban commuters"],
  design: ["a randomised controlled trial", "a longitudinal cohort study", "a quasi-experimental analysis", "a mixed-methods study", "a multilevel analysis", "evidence from a natural experiment", "a systematic review and meta-analysis", "a difference-in-differences approach"],
  method: ["A graph-attention framework", "Sparse Bayesian regression", "A contrastive pre-training scheme", "Federated transfer learning", "An adaptive mesh refinement algorithm", "Physics-informed neural operators", "A hierarchical Dirichlet process model", "Deep reinforcement scheduling", "A hybrid finite-volume solver", "Self-supervised anomaly detection"],
  task: ["fault localisation", "short-term load forecasting", "protein–ligand docking", "crack propagation modelling", "traffic signal coordination", "low-resource speech recognition", "sediment transport estimation", "credit risk scoring", "cardiac MRI segmentation", "satellite drought monitoring"],
  domain: ["offshore wind farms", "smart distribution grids", "heterogeneous sensor networks", "additive-manufactured alloys", "mid-sized logistics hubs", "semi-arid river basins", "multilingual call centres", "paediatric intensive care units", "electric bus fleets"],
  concept: ["Institutional trust", "Fiscal decentralisation", "Collective memory", "Algorithmic accountability", "Informal labour", "Epistemic humility", "Regulatory capture", "Cultural capital", "Platform dependence", "Linguistic identity", "Environmental stewardship"],
  context: ["post-reform welfare states", "secondary mathematics classrooms", "coastal fishing communities", "digital labour markets", "late-industrialising economies", "municipal water governance", "postcolonial archives", "family-owned enterprises", "transnational student networks"],
  place: ["three Baltic municipalities", "a panel of 41 emerging economies", "northern Ghana", "the Andean highlands", "two Indian states", "rural Hokkaido", "the Lower Mekong", "Scottish local councils"],
  angle: ["a critical realist reading", "lessons from a decade of fieldwork", "towards an integrative framework", "a comparative institutional perspective", "notes on an unfinished debate"],
  phenomenon: ["turbulent heat transfer", "liquidity spirals", "dislocation creep", "opinion polarisation", "nutrient cycling", "capillary imbibition", "spin-wave damping", "coalition bargaining"],
  condition: ["cyclic thermal loading", "incomplete information", "strong magnetic confinement", "heterogeneous agents", "prolonged drought stress", "high Reynolds numbers", "stochastic demand shocks"],
  adj: ["two-stage", "stochastic", "reduced-order", "non-equilibrium", "multi-scale", "semi-parametric", "agent-based"],
  bookForm: ["A Critical Introduction", "Theory, Method and Practice", "An Interdisciplinary Handbook", "Concepts, Cases and Controversies", "Foundations and New Directions", "A Field Guide for Researchers"],
  family: ["Okafor", "Lindqvist", "Tanaka", "Moreau", "Castellanos", "Haddad", "Petrov", "Nguyen", "Abernathy", "Kowalczyk", "Fernandes", "Iyer", "Olawale", "Brennan", "Schmidtke", "Yamamoto", "Rossetti", "Dlamini", "Achterberg", "Whitcombe", "Sorensen", "Papadakis", "Mukherjee", "Rahimi", "Lefebvre", "Oyelaran", "Hartmann", "Villanueva", "Zielinski", "Cheng", "Gallagher", "Bergstrom", "Karimi", "Novak", "Thackeray", "Osei", "Marchetti", "Delacroix", "Vasquez", "Halvorsen"],
  given: ["Amara", "Jonas", "Keiko", "Lucien", "Marisol", "Tariq", "Irina", "Minh", "Clara", "Piotr", "Beatriz", "Rohan", "Tunde", "Siobhan", "Greta", "Hiro", "Paolo", "Thandi", "Willem", "Edith", "Farid", "Ingrid", "Mateo", "Priya", "Oskar", "Leila", "Callum", "Yuki", "Renata", "Samuel"],
};
function inventTitle(r: Rng): string {
  const b = BANK;
  switch (int(r, 0, 5)) {
    case 0:
      return `${pickOne(r, b.effect)} of ${pickOne(r, b.intervention)} on ${pickOne(r, b.outcome)} among ${pickOne(r, b.population)}: ${pickOne(r, b.design)}`;
    case 1:
      return `${pickOne(r, b.method)} for ${pickOne(r, b.task)} in ${pickOne(r, b.domain)}`;
    case 2:
      return `${pickOne(r, b.concept)} and ${pickOne(r, b.concept).toLowerCase()} in ${pickOne(r, b.context)}: evidence from ${pickOne(r, b.place)}`;
    case 3:
      return `Rethinking ${pickOne(r, b.concept).toLowerCase()} in ${pickOne(r, b.context)}: ${pickOne(r, b.angle)}`;
    case 4:
      return `A ${pickOne(r, b.adj)} model of`.replace(/^A (?=[aeiou])/, "An ") + ` ${pickOne(r, b.phenomenon)} under ${pickOne(r, b.condition)}`;
    default:
      return `${pickOne(r, b.intervention).replace(/^./, (ch) => ch.toUpperCase())}, ${pickOne(r, b.outcome)} and ${pickOne(r, b.concept).toLowerCase()} in ${pickOne(r, b.place)}`;
  }
}
function inventBookTitle(r: Rng): string {
  const b = BANK;
  return int(r, 0, 1) === 0
    ? `${pickOne(r, b.concept)} in ${pickOne(r, b.context).replace(/^./, (ch) => ch.toUpperCase())}: ${pickOne(r, b.bookForm)}`
    : `The Politics of ${pickOne(r, b.outcome).replace(/(^|\s)\p{L}/gu, (ch) => ch.toUpperCase())}: ${pickOne(r, b.bookForm)}`;
}
function inventAuthors(r: Rng, n: number, avoid: Author[]): Author[] {
  const taken = new Set(avoid.map((a) => (a.family ?? a.literal ?? "").toLowerCase()));
  const fams = shuffled(r, BANK.family).filter((f) => !taken.has(f.toLowerCase()));
  return fams.slice(0, n).map((family) => ({ family, given: `${pickOne(r, BANK.given)}${r() < 0.4 ? ` ${String.fromCharCode(65 + int(r, 0, 25))}.` : ""}` }));
}
/** An invented title that Crossref's own title search does not recognise (word overlap with the closest real title < 0.6). */
async function inventUnseenTitle(r: Rng, make: (r: Rng) => string, used: Set<string>): Promise<{ title: string; closest: number }> {
  for (let i = 0; i < 20; i++) {
    const title = make(r);
    if (used.has(title)) continue;
    const hit = await closestRealTitle(title);
    if (hit && hit.sim >= 0.6) continue;
    used.add(title);
    return { title, closest: hit?.sim ?? 0 };
  }
  throw new Error("Could not invent a title that is clearly not a real paper");
}
function isbn13(r: Rng): string {
  // 978-1-… is the English-language range; the last digit is a correct checksum so the number "looks" valid.
  const d = [9, 7, 8, 1, ...Array.from({ length: 8 }, () => int(r, 0, 9))];
  const sum = d.reduce((s, x, i) => s + x * (i % 2 === 0 ? 1 : 3), 0);
  d.push((10 - (sum % 10)) % 10);
  const s = d.join("");
  return `${s.slice(0, 3)}-${s[3]}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s[12]}`;
}

/* ───────────────────────── Imperfections ───────────────────────── */

function typo(r: Rng, title: string): string | null {
  const parts = title.split(" ");
  const idx = shuffled(r, parts.map((_, i) => i)).find((i) => /^\p{L}{6,}$/u.test(parts[i]));
  if (idx === undefined) return null;
  const w = parts[idx];
  for (let k = 0; k < 10; k++) {
    const p = int(r, 1, w.length - 3);
    if (w[p].toLowerCase() !== w[p + 1].toLowerCase()) {
      parts[idx] = w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2);
      return parts.join(" ");
    }
  }
  return null;
}
const ABBR: Record<string, string> = {
  journal: "J.", international: "Int.", american: "Am.", european: "Eur.", research: "Res.", science: "Sci.", sciences: "Sci.", review: "Rev.", reviews: "Rev.", medicine: "Med.", medical: "Med.", clinical: "Clin.", engineering: "Eng.", chemistry: "Chem.", chemical: "Chem.", physics: "Phys.", physical: "Phys.", biology: "Biol.", biological: "Biol.", society: "Soc.", proceedings: "Proc.", transactions: "Trans.", applied: "Appl.", education: "Educ.", educational: "Educ.", psychology: "Psychol.", economics: "Econ.", economic: "Econ.", management: "Manag.", technology: "Technol.", materials: "Mater.", environmental: "Environ.", annals: "Ann.", archives: "Arch.", bulletin: "Bull.", communications: "Commun.", letters: "Lett.", studies: "Stud.", surgery: "Surg.", university: "Univ.", quarterly: "Q.", mathematics: "Math.", mathematical: "Math.", analysis: "Anal.", nutrition: "Nutr.", pharmacology: "Pharmacol.", development: "Dev.", experimental: "Exp.", molecular: "Mol.", national: "Natl.", academy: "Acad.", association: "Assoc.", institute: "Inst.", zeitschrift: "Z.", revista: "Rev.", british: "Br.", canadian: "Can.", philosophy: "Philos.", philosophical: "Philos.", history: "Hist.", historical: "Hist.", geography: "Geogr.", geographical: "Geogr.", neurology: "Neurol.", psychiatry: "Psychiatry", biochemistry: "Biochem.", microbiology: "Microbiol.", agricultural: "Agric.", agriculture: "Agric.", industrial: "Ind.", mechanical: "Mech.", mechanics: "Mech.", electrical: "Electr.", computer: "Comput.", computing: "Comput.", computational: "Comput.", theoretical: "Theor.", organic: "Org.", inorganic: "Inorg.", genetics: "Genet.", ecology: "Ecol.", zoology: "Zool.", botany: "Bot.", geology: "Geol.", astronomy: "Astron.", astrophysics: "Astrophys.", cardiology: "Cardiol.", oncology: "Oncol.", pediatrics: "Pediatr.", nursing: "Nurs.", dental: "Dent.", veterinary: "Vet.", pharmaceutical: "Pharm.", political: "Polit.", sociology: "Sociol.", sociological: "Sociol.", linguistics: "Linguist.", literature: "Lit.", economy: "Econ.", business: "Bus.", finance: "Finance", financial: "Financ.", accounting: "Account.", marketing: "Mark.", public: "Public", health: "Health", new: "New", acta: "Acta",
};
/** Either the registry's own short title, or (preferRules) word-by-word abbreviations of the kind ISO 4 uses. */
function abbreviateJournal(name: string, short?: string, preferRules = false): string | null {
  if (!preferRules && short && short.toLowerCase() !== name.toLowerCase() && short.length < name.length - 3) return short;
  let changed = 0;
  const out = name
    .split(/\s+/)
    .filter((w) => !/^(of|the|and|&|for|in|on|de|der|für|und)$/i.test(w))
    .map((w) => {
      const key = w.toLowerCase().replace(/[^a-z]/g, "");
      const a = ABBR[key];
      if (a && a.endsWith(".")) {
        changed++;
        return a + (w.endsWith(",") ? "," : "");
      }
      return w;
    })
    .join(" ");
  if (changed >= 1 && out.split(" ").length >= 2) return out;
  return preferRules ? abbreviateJournal(name, short) : null;
}

/* ───────────────────────── Selection ───────────────────────── */

class Picker {
  used = new Set<string>();
  constructor(private pools: Map<string, Work[]>) {}
  pool(...names: string[]): Work[] {
    return names.flatMap((n) => this.pools.get(n) ?? []);
  }
  /**
   * Take `n` unused works. `prefer` lists [tag, howMany] quotas that are filled first (so rare shapes like
   * organisational authors are represented); `maxPerPrefix` stops one publisher dominating a small category.
   */
  take(r: Rng, from: Work[], n: number, opts: { where?: (w: Work) => boolean; prefer?: [string, number][]; maxPerPrefix?: number } = {}): Work[] {
    const avail = shuffled(r, from.filter((w) => !this.used.has(w.doi.toLowerCase()) && (!opts.where || opts.where(w))));
    const out: Work[] = [];
    const perPrefix = new Map<string, number>();
    const add = (w: Work) => {
      if (out.length >= n || out.includes(w)) return false;
      const p = w.doi.split("/")[0];
      if (opts.maxPerPrefix && (perPrefix.get(p) ?? 0) >= opts.maxPerPrefix) return false;
      perPrefix.set(p, (perPrefix.get(p) ?? 0) + 1);
      out.push(w);
      return true;
    };
    for (const [tag, count] of opts.prefer ?? []) {
      let got = out.filter((w) => w.tags.includes(tag)).length;
      for (const w of avail) {
        if (got >= count) break;
        if (w.tags.includes(tag) && add(w)) got++;
      }
    }
    for (const w of avail) add(w);
    for (const w of out) this.used.add(w.doi.toLowerCase());
    return shuffled(r, out);
  }
  /** `n` works taken in turn from several pools (used to spread journal articles across the decades). */
  spread(r: Rng, poolNames: string[], n: number, opts: Parameters<Picker["take"]>[3] = {}): Work[] {
    const out: Work[] = [];
    const per = Math.floor(n / poolNames.length);
    poolNames.forEach((name, i) => {
      const want = per + (i < n - per * poolNames.length ? 1 : 0);
      const prefer = opts.prefer?.map(([t, c]) => [t, Math.ceil(c / poolNames.length)] as [string, number]);
      out.push(...this.take(r, this.pool(name), want, { ...opts, prefer }));
    });
    if (out.length < n) out.push(...this.take(r, this.pool(...poolNames), n - out.length, { where: opts.where }));
    return out;
  }
}
const JOURNAL_POOLS = ["ja-pre1980", "ja-1980-1999", "ja-2000-2014", "ja-2015-2025"];

/* ───────────────────────── Build ───────────────────────── */

async function main() {
  const { pools, sampledAt, rawCounts } = await loadPools();
  console.log("\n\nUsable records per pool:");
  for (const [k, v] of pools) console.log(`  ${k.padEnd(18)} ${String(v.length).padStart(4)} of ${rawCounts[k]} sampled`);
  const picker = new Picker(pools);
  const cases: Case[] = [];
  const counters = { real: 0, imperfect: 0, fake: 0 };
  const prefixOf = { real: "GR", imperfect: "GI", fake: "GF" } as const;
  const truthOf = (w: Work, role: string): Case["truth"] => ({ doi: w.doi, title: w.registryTitle, firstAuthor: w.authors[0].family ?? w.authors[0].literal, year: w.year, source: w.source, role });
  const push = (c: Omit<Case, "id">) => {
    const n = ++counters[c.kind];
    cases.push({ id: `${prefixOf[c.kind]}${String(n).padStart(3, "0")}`, ...c });
  };
  const describe = (w: Work) => `${w.type}, ${w.year}, ${w.authors.length} author${w.authors.length === 1 ? "" : "s"}`;
  const real = (category: string, w: Work, style: Style, withDoi: boolean, extra = "") =>
    push({
      category,
      kind: "real",
      style,
      input: render(citeOf(w, withDoi), style),
      acceptable: ["verified"],
      mustNot: ["mismatch"],
      truth: truthOf(w, "the cited work"),
      tags: [...w.tags, withDoi ? "with-doi" : "no-doi"],
      note: `Real ${w.source === "crossref" ? "Crossref" : "DataCite"} record (${describe(w)}), ${withDoi ? "cited with its DOI" : "cited without a DOI"}.${extra}`,
    });

  /* ── REAL ── */
  let r = rngFor("real-journal-doi");
  picker.spread(r, JOURNAL_POOLS, 32, { prefer: [["many-authors", 4], ["org-author", 4], ["diacritics", 4], ["subtitle", 4], ["single-author", 4]] }).forEach((w, i) => real("real-journal-doi", w, PROSE_STYLES[i % 6], true));

  r = rngFor("real-journal-nodoi");
  picker.spread(r, JOURNAL_POOLS, 28, { prefer: [["many-authors", 4], ["org-author", 4], ["diacritics", 4], ["subtitle", 4]] }).forEach((w, i) => real("real-journal-nodoi", w, PROSE_STYLES[(i + 2) % 6], false));

  for (const [category, poolNames, n, start] of [
    ["real-chapter", ["chapter"], 10, 0],
    ["real-proceedings", ["proceedings"], 10, 3],
    ["real-book", ["book"], 8, 1],
  ] as [string, string[], number, number][]) {
    r = rngFor(category);
    picker.take(r, picker.pool(...poolNames), n, { maxPerPrefix: 3, where: (w) => category === "real-book" || Boolean(w.container) }).forEach((w, i) => real(category, w, PROSE_STYLES[(i + start) % 6], i % 2 === 0));
  }

  r = rngFor("real-preprint");
  picker.take(r, picker.pool("preprint"), 8, { maxPerPrefix: 3 }).forEach((w, i) => real("real-preprint", w, PROSE_STYLES[(i + 4) % 6], i < 6));

  r = rngFor("real-dataset");
  picker.take(r, picker.pool("dataset"), 5, { maxPerPrefix: 2 }).forEach((w, i) => real("real-dataset", w, PROSE_STYLES[(i * 2) % 6], true));

  r = rngFor("real-non-english");
  const langPools = [...pools.keys()].filter((k) => k.startsWith("lang-"));
  const nonLatin = picker.take(r, picker.pool(...langPools, ...JOURNAL_POOLS), 4, { where: (w) => w.tags.includes("non-latin-script"), maxPerPrefix: 2 });
  const latin = picker.take(r, picker.pool(...langPools), 14 - nonLatin.length, { where: (w) => w.tags.includes("non-english") && !w.tags.includes("non-latin-script"), maxPerPrefix: 3 });
  [...nonLatin, ...latin].forEach((w, i) => real("real-non-english", w, PROSE_STYLES[(i + 5) % 6], i % 2 === 0, w.tags.includes("non-latin-script") ? " Title is not in the Latin alphabet." : ""));

  r = rngFor("real-datacite");
  const arxiv = picker.take(r, picker.pool("arxiv"), 8);
  const zenodo = picker.take(r, picker.pool("zenodo"), 7);
  arxiv.forEach((w, i) => (i < 3 ? real("real-datacite", w, "arxiv-id", true, " Written the arXiv way: “arXiv preprint arXiv:NNNN.NNNNN” instead of a DOI.") : real("real-datacite", w, (["apa7", "ieee", "doi-url", "harvard", "bibtex"] as Style[])[i - 3], true)));
  zenodo.forEach((w, i) => real("real-datacite", w, (["apa7", "harvard", "mla9", "bare-doi", "chicago", "apa7", "vancouver"] as Style[])[i], true));

  r = rngFor("real-bare-doi");
  [...picker.spread(r, JOURNAL_POOLS, 6), ...picker.take(r, picker.pool("chapter", "proceedings", "book", "preprint"), 4, { maxPerPrefix: 1 })].forEach((w, i) => real("real-bare-doi", w, i % 2 === 0 ? "bare-doi" : "doi-url", true));

  r = rngFor("real-bibtex");
  [...picker.spread(r, JOURNAL_POOLS, 6, { prefer: [["diacritics", 2], ["subtitle", 2]] }), ...picker.take(r, picker.pool("chapter"), 1, { where: (w) => Boolean(w.container) }), ...picker.take(r, picker.pool("proceedings"), 2, { where: (w) => Boolean(w.container) }), ...picker.take(r, picker.pool("book"), 1)].forEach((w, i) => real("real-bibtex", w, "bibtex", i % 3 !== 2));

  /* ── REAL BUT IMPERFECT ── */
  const IMP_STYLES: Style[] = ["apa7", "harvard", "mla9", "ieee", "apa7", "chicago", "vancouver"];
  const imperfect = (category: string, w: Work, style: Style, withDoi: boolean, change: (c: Cite) => Cite | null, what: string): boolean => {
    const altered = change(citeOf(w, withDoi));
    if (!altered) return false;
    push({
      category,
      kind: "imperfect",
      style,
      input: render(altered, style),
      acceptable: ["verified", "check"],
      mustNot: ["mismatch"],
      truth: truthOf(w, "the cited work (before the slip was added)"),
      tags: [...w.tags, withDoi ? "with-doi" : "no-doi"],
      note: `Real record (${describe(w)}) with an honest slip: ${what}. ${withDoi ? "DOI is correct." : "No DOI given."}`,
    });
    return true;
  };
  /** Keeps drawing works until `n` cases have been made (some works cannot carry a given slip). */
  const makeImperfect = (category: string, n: number, where: (w: Work) => boolean, change: (r: Rng, w: Work) => { fn: (c: Cite) => Cite | null; what: string }, styles = IMP_STYLES) => {
    const rr = rngFor(category);
    let made = 0;
    for (let guard = 0; made < n && guard < 200; guard++) {
      const [w] = picker.take(rr, picker.pool(...JOURNAL_POOLS.slice(1)), 1, { where });
      if (!w) break;
      const ch = change(rr, w);
      if (imperfect(category, w, styles[made % styles.length], made % 2 === 0, ch.fn, ch.what)) made++;
    }
    if (made < n) console.warn(`  ! only ${made}/${n} cases for ${category}`);
  };
  makeImperfect("imperfect-year-off-one", 7, () => true, (rr, w) => {
    const d = w.year >= 2025 ? -1 : rr() < 0.5 ? -1 : 1;
    return { fn: (c) => ({ ...c, year: c.year + d }), what: `year written as ${w.year + d} instead of ${w.year}` };
  });
  makeImperfect("imperfect-title-typo", 7, (w) => w.title.split(" ").length >= 5, (rr, w) => {
    let t = typo(rr, w.title);
    if (t && w.title.split(" ").length >= 12) t = typo(rr, t) ?? t;
    return { fn: (c) => (t ? { ...c, title: t } : null), what: `letters swapped in the title (“${t ?? ""}”)` };
  });
  makeImperfect(
    "imperfect-full-first-names",
    6,
    (w) => w.authors.length <= 5 && w.authors.every((a) => a.family && a.given && a.given.split(/\s+/)[0].replace(/\./g, "").length >= 3),
    () => ({ fn: (c) => ({ ...c, fullGiven: true }), what: "first names written in full where the style uses initials" }),
    ["apa7", "harvard", "ieee", "vancouver", "apa7", "harvard"],
  );
  makeImperfect("imperfect-et-al", 7, (w) => w.authors.length >= 4 && Boolean(w.authors[0].family), (_rr, w) => ({ fn: (c) => ({ ...c, forceEtAl: true }), what: `${w.authors.length} authors cut down to the first author plus “et al.”` }), ["apa7", "harvard", "ieee", "vancouver", "mla9", "chicago", "apa7"]);
  makeImperfect("imperfect-journal-abbrev", 7, (w) => Boolean(w.container && abbreviateJournal(w.container, w.shortContainer)), (rr, w) => {
    const ab = abbreviateJournal(w.container!, w.shortContainer, rr() < 0.6)!;
    return { fn: (c) => ({ ...c, container: ab }), what: `journal “${w.container}” abbreviated to “${ab}”` };
  });
  makeImperfect("imperfect-missing-vol-pages", 6, (w) => Boolean(w.volume && w.pages), () => ({ fn: (c) => ({ ...c, volume: undefined, issue: undefined, pages: undefined }), what: "volume, issue and pages left out" }));
  makeImperfect("imperfect-title-allcaps", 5, () => true, () => ({ fn: (c) => ({ ...c, title: c.title.toUpperCase() }), what: "title typed in capitals" }));
  makeImperfect("imperfect-title-lowercase", 5, (w) => w.title !== w.title.toLowerCase(), () => ({ fn: (c) => ({ ...c, title: c.title.toLowerCase() }), what: "title typed without any capitals" }));

  /* ── FAKES (each one starts from a real sampled record) ── */
  const usedTitles = new Set<string>();
  const fake = (category: string, style: Style, input: string, acceptable: Label[], truth: Case["truth"], note: string, tags: string[] = []) =>
    push({ category, kind: "fake", style, input, acceptable, mustNot: ["verified"], truth, tags, note });
  const FAKE_STYLES: Style[] = ["apa7", "harvard", "ieee", "mla9", "chicago", "vancouver", "apa7", "bibtex"];
  const anyJournal = () => picker.pool(...JOURNAL_POOLS);

  // (a) invented DOI under the real prefix, real title
  r = rngFor("fake-invented-doi");
  process.stdout.write("\nMaking fakes: invented DOIs");
  for (let made = 0, guard = 0; made < 16 && guard < 80; guard++) {
    const [w] = picker.take(r, anyJournal(), 1, { where: (x) => (x.doi.split("/").slice(1).join("/").match(/\d/g) ?? []).length >= 4 });
    if (!w) break;
    const [prefix, ...rest] = w.doi.split("/");
    let fakeDoi = "";
    for (let t = 0; t < 5 && !fakeDoi; t++) {
      const cand = `${prefix}/${rest.join("/").replace(/\d/g, () => String(int(r, 0, 9)))}`;
      if (cand.toLowerCase() !== w.doi.toLowerCase() && !(await doiRegistered(cand))) fakeDoi = cand;
    }
    if (!fakeDoi) continue;
    const style = FAKE_STYLES[made % FAKE_STYLES.length];
    fake("fake-invented-doi", style, render({ ...citeOf(w, true), doi: fakeDoi }, style), ["mismatch"], truthOf(w, "the real paper; its true DOI is shown here, the DOI in the reference is invented"), `Real reference, but the DOI ${fakeDoi} is invented (digits re-rolled under the real prefix ${prefix}). doi.org confirmed on the build date that no registry has issued it.`);
    made++;
    process.stdout.write(".");
  }

  // (b) real DOI, invented title + authors
  r = rngFor("fake-doi-wrong-paper");
  process.stdout.write("\nMaking fakes: real DOI on an invented paper");
  for (let made = 0; made < 16; made++) {
    const [w] = picker.take(r, anyJournal(), 1);
    const { title } = await inventUnseenTitle(r, inventTitle, usedTitles);
    if (diceWords(title, w.title) > 0.3) {
      made--;
      continue;
    }
    const authors = inventAuthors(r, int(r, 1, 4), w.authors);
    const style = FAKE_STYLES[made % FAKE_STYLES.length];
    fake("fake-doi-wrong-paper", style, render({ ...citeOf(w, true), title, authors }, style), ["mismatch"], truthOf(w, "the paper this DOI really belongs to"), `The DOI, journal, year and page numbers are real (they belong to “${w.title.slice(0, 70)}”), but the title and authors are invented.`);
    process.stdout.write(".");
  }

  // (c) fully invented paper in a real journal, no DOI
  r = rngFor("fake-fabricated-no-doi");
  process.stdout.write("\nMaking fakes: fully invented papers");
  for (let made = 0; made < 16; made++) {
    const [w] = picker.take(r, picker.pool(...JOURNAL_POOLS.slice(1)), 1);
    const { title } = await inventUnseenTitle(r, inventTitle, usedTitles);
    const authors = inventAuthors(r, int(r, 1, 4), w.authors);
    const first = int(r, 1, 900);
    const style = FAKE_STYLES[made % FAKE_STYLES.length];
    fake(
      "fake-fabricated-no-doi",
      style,
      render({ type: "journal-article", title, authors, year: w.year, container: w.container, volume: String(int(r, 3, 90)), issue: String(int(r, 1, 6)), pages: `${first}-${first + int(r, 6, 24)}` }, style),
      ["check"],
      { title: w.registryTitle, doi: w.doi, year: w.year, source: w.source, role: "donor record: only its journal name and year were borrowed; the cited paper does not exist" },
      `Invented title, authors, volume and pages. Only the journal name (“${w.container}”) and year are real. Crossref's title search found nothing close to the invented title on the build date.`,
    );
    process.stdout.write(".");
  }

  // (d) real title, invented authors, wrong year, no DOI
  r = rngFor("fake-wrong-authors-year");
  picker.take(r, picker.pool(...JOURNAL_POOLS.slice(1)), 14, { where: (w) => w.title.split(" ").length >= 6 }).forEach((w, i) => {
    const shift = int(r, 3, 9) * (w.year > 2016 ? -1 : r() < 0.5 ? -1 : 1);
    const authors = inventAuthors(r, Math.max(1, Math.min(4, w.authors.length)), w.authors);
    const style = FAKE_STYLES[i % FAKE_STYLES.length];
    fake("fake-wrong-authors-year", style, render({ ...citeOf(w, false), authors, year: w.year + shift }, style), ["check", "mismatch"], truthOf(w, "the real paper whose title was borrowed"), `Real title and journal, but credited to invented authors and dated ${w.year + shift} instead of ${w.year}.`);
  });

  // (e) chimera: authors, year and journal of A + title of B, no DOI
  r = rngFor("fake-chimera");
  for (let i = 0; i < 14; i++) {
    const poolName = JOURNAL_POOLS[1 + (i % 3)];
    const [a, b] = picker.take(r, picker.pool(poolName), 2, { where: (w) => w.title.split(" ").length >= 6 });
    const style = FAKE_STYLES[i % FAKE_STYLES.length];
    fake(
      "fake-chimera",
      style,
      render({ ...citeOf(a, false), title: b.title }, style),
      ["check", "mismatch"],
      { ...truthOf(b, "the real paper whose title was used; the authors, year and journal come from a different real paper"), firstAuthor: b.authors[0].family ?? b.authors[0].literal },
      `Title of ${b.doi} (really by ${b.authors[0].family ?? b.authors[0].literal}, ${b.year}) combined with the authors, year, journal and pages of ${a.doi}. Both halves are real; the combination is not.`,
    );
  }

  // (f) real paper, DOI with two neighbouring characters swapped
  r = rngFor("fake-transposed-doi");
  process.stdout.write("\nMaking fakes: transposed DOIs");
  for (let made = 0, guard = 0; made < 14 && guard < 60; guard++) {
    const [w] = picker.take(r, anyJournal(), 1);
    if (!w) break;
    const slash = w.doi.indexOf("/");
    const positions = shuffled(r, Array.from({ length: w.doi.length - slash - 2 }, (_, k) => slash + 1 + k)).filter((p) => /[a-z0-9]/i.test(w.doi[p]) && /[a-z0-9]/i.test(w.doi[p + 1]) && w.doi[p].toLowerCase() !== w.doi[p + 1].toLowerCase());
    let chosen = "";
    for (const p of positions.slice(0, 4)) {
      const cand = w.doi.slice(0, p) + w.doi[p + 1] + w.doi[p] + w.doi.slice(p + 2);
      if (!(await doiRegistered(cand))) {
        chosen = cand;
        break;
      }
    }
    if (!chosen) continue; // every swap landed on another registered DOI: skip, keep the category unambiguous
    const style = FAKE_STYLES[made % FAKE_STYLES.length];
    fake("fake-transposed-doi", style, render({ ...citeOf(w, true), doi: chosen }, style), ["mismatch"], truthOf(w, "the real paper; its true DOI is shown here"), `Everything is real except the DOI: two neighbouring characters were swapped (${w.doi} → ${chosen}). doi.org confirmed on the build date that the swapped DOI is not registered.`);
    made++;
    process.stdout.write(".");
  }

  // (g) invented book, real publisher, fake ISBN
  r = rngFor("fake-invented-book-isbn");
  process.stdout.write("\nMaking fakes: invented books");
  for (let made = 0, guard = 0; made < 10 && guard < 40; guard++) {
    const [w] = picker.take(r, picker.pool("book", "chapter"), 1, { where: (x) => Boolean(x.publisher) });
    if (!w) break;
    const { title } = await inventUnseenTitle(r, inventBookTitle, usedTitles);
    const isbn = isbn13(r);
    if (await isbnKnown(isbn.replace(/-/g, ""))) continue;
    const authors = inventAuthors(r, int(r, 1, 2), w.authors);
    const style = (["apa7", "harvard", "mla9", "chicago", "apa7", "vancouver", "ieee", "apa7", "bibtex", "harvard"] as Style[])[made];
    fake(
      "fake-invented-book-isbn",
      style,
      render({ type: "book", title, authors, year: w.year, publisher: w.publisher, isbn }, style),
      ["check", "mismatch"],
      { title: w.registryTitle, doi: w.doi, year: w.year, source: w.source, role: "donor record: only its publisher and year were borrowed; the cited book does not exist" },
      `Invented book title and authors with a real publisher (“${w.publisher}”). The ISBN ${isbn} has a correct check digit but Open Library had no record of it on the build date.`,
    );
    made++;
    process.stdout.write(".");
  }

  /* ── Sanity checks on the data itself ── */
  const ids = new Set(cases.map((c) => c.id));
  if (ids.size !== cases.length) throw new Error("duplicate ids");
  const inputs = new Set(cases.map((c) => c.input));
  if (inputs.size !== cases.length) throw new Error("duplicate inputs");
  for (const c of cases) if (!c.input || c.input.length < 8 || /\bundefined\b|\[object/.test(c.input)) throw new Error(`bad input in ${c.id}: ${c.input}`);

  const count = (f: (c: Case) => boolean) => cases.filter(f).length;
  const tagCounts: Record<string, number> = {};
  for (const c of cases.filter((x) => x.kind !== "fake")) for (const t of c.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  const styleCounts: Record<string, number> = {};
  for (const c of cases) styleCounts[c.style] = (styleCounts[c.style] ?? 0) + 1;

  // The build date is taken from the sample, so a rebuild from the cache gives a byte-identical file.
  const out = {
    name: "Knowlix generated reference benchmark",
    seed: SEED,
    builtAt: sampledAt.slice(0, 10),
    sampledAt,
    generator: "bench/build-generated.ts",
    provenance:
      "Every case starts from a real record drawn at random from the Crossref REST API `sample` endpoint (journal articles from four date ranges, book chapters, conference papers, books, preprints, datasets, plus samples from publishers whose records are mostly not in English) or from the DataCite REST API `random` listing (arXiv and Zenodo). Records with no title, no author or no year, and non-citable items such as front matter, errata and book reviews, were skipped before any case was run. Real cases print the record in one of six citation styles, BibTeX or as a bare DOI, using hand-written templates. Imperfect cases add one honest slip to a real record. Fake cases mutate a real record: the DOI is re-rolled or two characters are swapped (and doi.org confirmed the result is unregistered), or the title/authors are replaced with invented ones (and Crossref's title search confirmed no close real title), or two real papers are spliced together.",
    counts: { cases: cases.length, real: count((c) => c.kind === "real"), imperfect: count((c) => c.kind === "imperfect"), fake: count((c) => c.kind === "fake"), withDoi: count((c) => c.kind !== "fake" && c.tags.includes("with-doi")), withoutDoi: count((c) => c.kind !== "fake" && c.tags.includes("no-doi")) },
    styleCounts,
    tagCounts,
    sampling: { usablePerPool: Object.fromEntries([...pools].map(([k, v]) => [k, `${v.length} of ${rawCounts[k]}`])), skipped: skipReasons },
    categories: CATEGORIES.map((c) => ({ ...c, cases: count((x) => x.category === c.id) })),
    cases,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`\n\nWrote ${cases.length} cases to ${path.relative(process.cwd(), OUT)} (${networkCalls} network calls; the rest came from bench/.cache)`);
  for (const c of out.categories) console.log(`  ${c.id.padEnd(30)} ${c.cases}`);
  console.log("Shapes among real + imperfect cases:", JSON.stringify(tagCounts));
  console.log("Styles:", JSON.stringify(styleCounts));
  console.log("Skipped while sampling:", JSON.stringify(skipReasons));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
