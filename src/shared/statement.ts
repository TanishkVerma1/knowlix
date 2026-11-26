/**
 * The AI-use statement for a reference list (Citation Audit and Library).
 * It is built from counts of what actually happened, so it never claims a
 * check that was not run. The research flow has its own, fuller statement.
 */
export function referenceListStatement(o: { total: number; verified: number; style: string; date?: Date }): string {
  const date = (o.date ?? new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const unconfirmed = Math.max(0, o.total - o.verified);
  const refs = o.total === 1 ? "The 1 reference was" : `Each of the ${o.total} references was`;
  return [
    `I used Knowlix, a reference-checking tool, on ${date} to check and format my reference list in ${o.style}.`,
    `${refs} compared by program code, not by an AI model, with the public scholarly databases doi.org, Crossref and OpenAlex: ${o.verified} matched a real, registered record${unconfirmed ? `, and ${unconfirmed} could not be fully confirmed and ${unconfirmed === 1 ? "is" : "are"} labelled as such` : ""}.`,
    "No reference in this list was written or suggested by AI without my approval. I chose and approved every reference myself, and the work, its arguments and its wording are my own.",
  ].join(" ");
}
