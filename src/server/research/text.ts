/** Tokenising, sentence splitting and a small BM25 ranker. Pure functions. */

const STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it its may more most no not of on or our over such than that the their them then there these they this those through to under up was we were what when where which while who why will with within would you your between among about after before during whether versus vs effect effects impact role use using based study studies improve improves improving increase increases reduce reduces affect affects help helps better compared compare comparison good bad really actually students student people does work works lead leads cause causes evidence research".split(
    " ",
  ),
);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map((t) => (t.length > 4 ? t.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : t));
}

export function keywords(question: string, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of question
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)) {
    const t = raw.toLowerCase();
    if (t.length < 3 || STOP.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}

/** Splits text into sentences without breaking "e.g.", "et al.", decimals or initials. */
export function sentences(text: string): string[] {
  const protectedText = text
    .replace(/\b(e\.g|i\.e|et al|vs|cf|approx|Fig|No|Vol|pp)\./gi, (m) => m.replace(/\./g, "§"))
    .replace(/(\d)\.(\d)/g, "$1§$2")
    .replace(/\b([A-Z])\./g, "$1§");
  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)
    .map((s) => s.replace(/§/g, ".").trim())
    .filter((s) => s.length > 20);
}

export interface Doc {
  id: string;
  text: string;
}

export function bm25Rank(query: string, docs: Doc[], k1 = 1.4, b = 0.75): { id: string; score: number }[] {
  const q = [...new Set(tokens(query))];
  if (!q.length || !docs.length) return docs.map((d) => ({ id: d.id, score: 0 }));
  const toks = docs.map((d) => tokens(d.text));
  const avg = toks.reduce((s, t) => s + t.length, 0) / toks.length || 1;
  const df = new Map<string, number>();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) ?? 0) + 1);
  const N = docs.length;
  return docs
    .map((d, i) => {
      const tf = new Map<string, number>();
      for (const w of toks[i]) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      for (const w of q) {
        const f = tf.get(w) ?? 0;
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
        score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * toks[i].length) / avg)));
      }
      return { id: d.id, score };
    })
    .sort((a, b2) => b2.score - a.score);
}

/** Share of the question's key terms that appear in a text (0..1). */
export function coverage(question: string, text: string): number {
  const q = [...new Set(tokens(question))];
  if (!q.length) return 0;
  const t = new Set(tokens(text));
  return q.filter((w) => t.has(w)).length / q.length;
}
