/** Small helper shared by the search clients whose query syntax needs explicit terms. Pure. */

const FILLER = new Set(
  "a an and are as at be by can do does did for from how in into is it its of on or that the their this to was were what when which who why with within between among about than not no effect effects impact improve improves improving affect affects use using based study studies evidence research".split(
    " ",
  ),
);

/** The telling words of a free-text query, lower-cased, without filler words or punctuation, at most `max`. */
export function keyTerms(query: string, max: number): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of query.replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/)) {
    const t = raw.toLowerCase().replace(/^-+|-+$/g, "");
    if (t.length < 3 || FILLER.has(t) || seen.has(t)) continue;
    seen.add(t);
    terms.push(t);
    if (terms.length >= max) break;
  }
  return terms;
}
