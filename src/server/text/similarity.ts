import { partial_ratio, ratio, token_set_ratio, token_sort_ratio } from "fuzzball";

/** Lowercase, strip accents/HTML/punctuation, collapse spaces. "Müller & Co." → "muller and co" */
export function norm(input: string | string[] | null | undefined): string {
  if (!input) return "";
  // Some structured inputs (a BibTeX publisher containing " and ") arrive as a list.
  const s = Array.isArray(input) ? input.join(" and ") : String(input);
  return s
    .replace(/<[^>]+>/g, " ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[’'`´]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    // Letters and digits of every script are kept, so Cyrillic, Arabic, Greek or CJK titles compare
    // as themselves instead of collapsing to nothing.
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const opt = { full_process: false } as const;

function mainTitle(s: string): string {
  // Students often drop subtitles: compare the part before ":" too.
  const cut = s.split(/\s*[:?!]\s+|\s+[-–—]\s+/)[0];
  return cut && cut.length >= 8 ? cut : s;
}

/** Title similarity 0..1 that does not reward subset titles ("Deep learning" ≠ "Deep learning for X"). */
export function titleSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const direct = (ratio(x, y, opt) + token_sort_ratio(x, y, opt)) / 200;
  const mx = norm(mainTitle(a ?? ""));
  const my = norm(mainTitle(b ?? ""));
  const sub = Math.max(
    mx && my ? ratio(mx, my, opt) / 100 : 0,
    mx && mx !== x ? ratio(mx, y, opt) / 100 : 0,
    my && my !== y ? ratio(x, my, opt) / 100 : 0,
  );
  // Subtitle omitted is a small penalty, not a mismatch.
  return Math.max(direct, sub * 0.97);
}

/** How much of `needle` appears inside `haystack` (0..1). Used when a field could not be parsed. */
export function containedIn(needle: string | null | undefined, haystack: string | null | undefined): number {
  const n = norm(needle);
  const h = norm(haystack);
  if (!n || !h) return 0;
  if (h.includes(n)) return 1;
  return partial_ratio(n, h, opt) / 100;
}

export function tokenSet(a: string, b: string): number {
  return token_set_ratio(norm(a), norm(b), opt) / 100;
}

const STOP = new Set(["of", "the", "and", "for", "in", "on", "a", "an", "to", "de", "la", "le", "und", "fur", "du", "des"]);

/** "J. Pers. Soc. Psychol." matches "Journal of Personality and Social Psychology". */
export function abbreviationMatch(abbr: string, full: string): boolean {
  const a = norm(abbr).split(" ").filter((t) => t && !STOP.has(t));
  const f = norm(full).split(" ").filter((t) => t && !STOP.has(t));
  if (a.length < 2 || a.length > f.length + 1) return false;
  let j = 0;
  let misses = 0;
  for (const tok of a) {
    let k = j;
    while (k < f.length && !f[k].startsWith(tok)) k++;
    if (k === f.length) {
      // Tolerate one trailing extra token such as a country ("USA").
      misses++;
      if (misses > 1 || tok !== a[a.length - 1] || a.length < 4) return false;
      continue;
    }
    j = k + 1;
  }
  return true;
}

export function venueSimilarity(entered: string | null | undefined, candidates: (string | null | undefined)[]): number {
  const e = norm(entered);
  if (!e) return 0;
  let best = 0;
  for (const c of candidates) {
    const v = norm(c);
    if (!v) continue;
    if (v === e) return 1;
    if (abbreviationMatch(e, v) || abbreviationMatch(v, e)) best = Math.max(best, 0.95);
    best = Math.max(best, (ratio(e, v, opt) + token_sort_ratio(e, v, opt)) / 200);
    // "Nature" vs "Nature Communications" must not match: penalise length gaps.
    const lenGap = Math.abs(e.length - v.length) / Math.max(e.length, v.length);
    if (token_set_ratio(e, v, opt) === 100 && lenGap < 0.25) best = Math.max(best, 0.9);
  }
  return best;
}

/** Family-name key: accents and particles removed. "van der Berg" → "berg". */
export function familyKey(name: string | null | undefined): string {
  const n = norm(name);
  const parts = n.split(" ").filter((p) => !["van", "der", "den", "de", "da", "di", "del", "von", "le", "la", "du", "dos", "das", "bin", "al", "el"].includes(p));
  return parts.join(" ") || n;
}

export function familyMatch(a: string, b: string): number {
  const x = familyKey(a);
  const y = familyKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Hyphenated / double surnames: "Garcia-Lopez" vs "Garcia"
  const xs = x.split(" ");
  const ys = y.split(" ");
  if (xs.some((p) => p.length > 2 && ys.includes(p))) return 0.92;
  return ratio(x, y, opt) / 100;
}

export function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}
