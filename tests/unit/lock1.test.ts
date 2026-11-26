import { describe, expect, it } from "vitest";
import { normalizeDoi, extractDoi, normalizeIsbn, extractArxivId, isPreprintDoi } from "@/shared/identifiers";
import { parseReference, splitReferences, parseAuthors } from "@/server/verify/parse";
import { scoreCandidate, isDifferentPaper } from "@/server/verify/match";
import { titleSimilarity, abbreviationMatch, venueSimilarity } from "@/server/text/similarity";
import type { CslItem } from "@/shared/types";

describe("identifiers", () => {
  it("normalises DOIs from links and trailing punctuation", () => {
    expect(normalizeDoi("https://doi.org/10.1038/NATURE14539.")).toBe("10.1038/nature14539");
    expect(normalizeDoi("doi: 10.1016/S0140-6736(20)30183-5")).toBe("10.1016/s0140-6736(20)30183-5");
    expect(extractDoi("Lancet, 395. (doi:10.1016/S0140-6736(20)30183-5).")).toBe("10.1016/s0140-6736(20)30183-5");
  });
  it("validates ISBN checksums", () => {
    expect(normalizeIsbn("978-0-262-03384-8")).toBe("9780262033848");
    expect(normalizeIsbn("978-0-262-03384-9")).toBeNull();
  });
  it("finds arXiv IDs and flags preprint prefixes", () => {
    expect(extractArxivId("arXiv:1706.03762v5")).toBe("1706.03762");
    expect(isPreprintDoi("10.48550/arxiv.1706.03762")).toBe(true);
    expect(isPreprintDoi("10.1101/2020.03.22.002386")).toBe(true);
    expect(isPreprintDoi("10.1101/gad.1234")).toBe(false); // a Cold Spring Harbor journal, not bioRxiv
  });
});

describe("parser", () => {
  it("reads APA 7", () => {
    const p = parseReference("Hattie, J., & Timperley, H. (2007). The power of feedback. Review of Educational Research, 77(1), 81–112. https://doi.org/10.3102/003465430298487");
    expect(p.format).toBe("apa");
    expect(p.title).toBe("The power of feedback");
    expect(p.authors.map((a) => a.family)).toEqual(["Hattie", "Timperley"]);
    expect(p.year).toBe(2007);
    expect(p.venue).toBe("Review of Educational Research");
    expect(p.doi).toBe("10.3102/003465430298487");
  });
  it("reads Harvard with a quoted title", () => {
    const p = parseReference("Hochreiter, S. and Schmidhuber, J. (1997) 'Long short-term memory', Neural Computation, 9(8), pp. 1735–1780.");
    expect(p.title).toBe("Long short-term memory");
    expect(p.venue).toBe("Neural Computation");
  });
  it("reads IEEE and MLA quoted titles", () => {
    const ieee = parseReference('A. Vaswani, N. Shazeer and N. Parmar, "Attention is all you need," in Proc. NeurIPS, 2017, pp. 5998–6008.');
    expect(ieee.title).toBe("Attention is all you need");
    expect(ieee.year).toBe(2017);
    const mla = parseReference('Smith, John, and Jane Doe. "Reading on Screens." Journal of Literacy, vol. 12, no. 3, 2020, pp. 45-67.');
    expect(mla.title).toBe("Reading on Screens");
    expect(mla.authors[0].family).toBe("Smith");
  });
  it("strips APA descriptors from titles and keeps abbreviated journals", () => {
    const p = parseReference("Freire, P. (2000). Pedagogy of the oppressed (M. B. Ramos, Trans.; 30th anniversary ed.). Continuum.");
    expect(p.title).toBe("Pedagogy of the oppressed");
    const h = parseReference("Hopfield, J. J. (1982). Neural networks and physical systems. Proc. Natl. Acad. Sci. USA, 79(8), 2554–2558.");
    expect(h.venue).toBe("Proc. Natl. Acad. Sci. USA");
  });
  it("detects bare identifiers", () => {
    expect(parseReference("https://doi.org/10.1126/science.aac4716").format).toBe("doi");
    expect(parseReference("arXiv:1412.6980").format).toBe("arxiv");
  });
  it("handles APA's 20+ author ellipsis as et al.", () => {
    expect(parseAuthors("Caswell, T. A., Droettboom, M., . . . Katins, J.").etAl).toBe(true);
  });
  it("splits numbered, wrapped and BibTeX lists", () => {
    const s = splitReferences(`[1] Smith, J. (2020). A title. Journal, 1(2), 3-4.\n[2] Doe, K. (2021). Another title that wraps\nonto a second line. Journal, 5(6), 7-8.\n\n@article{x, title={Deep learning}, year={2015}}`);
    expect(s.plain).toHaveLength(2);
    expect(s.plain[1]).toContain("onto a second line");
    expect(s.bibtex).toHaveLength(1);
  });
});

const record = (o: Partial<CslItem>): CslItem => ({ id: "r", type: "article-journal", ...o });

describe("scoring", () => {
  const real = record({
    title: "The power of feedback",
    author: [{ family: "Hattie", given: "John" }, { family: "Timperley", given: "Helen" }],
    issued: { "date-parts": [[2007]] },
    "container-title": "Review of Educational Research",
  });
  it("gives a correct reference 100", () => {
    const m = scoreCandidate(parseReference("Hattie, J., & Timperley, H. (2007). The power of feedback. Review of Educational Research, 77(1), 81–112."), real);
    expect(m.score).toBe(100);
  });
  it("allows ±1 year (online vs print) but not more", () => {
    const one = scoreCandidate(parseReference("Hattie, J., & Timperley, H. (2008). The power of feedback. Review of Educational Research, 77(1), 81–112."), real);
    expect(one.score).toBeGreaterThanOrEqual(90);
    const three = scoreCandidate(parseReference("Hattie, J., & Timperley, H. (2010). The power of feedback. Review of Educational Research, 77(1), 81–112."), real);
    expect(three.score).toBeLessThan(90);
  });
  it("recognises a DOI that belongs to a different paper", () => {
    const m = scoreCandidate(parseReference("Chen, L., & Morales, D. (2021). Minimum wage increases and the automation of routine jobs. The Quarterly Journal of Economics, 136(2), 727–781."), real);
    expect(isDifferentPaper(m)).toBe(true);
  });
  it("does not reward a title that is only a subset", () => {
    expect(titleSimilarity("Deep learning", "Deep learning for cancer detection in histopathology images")).toBeLessThan(0.75);
    expect(titleSimilarity("Adam: A method for stochastic optimization", "Adam: A Method for Stochastic Optimization")).toBe(1);
  });
  it("matches abbreviated journals but not similar-sounding ones", () => {
    expect(abbreviationMatch("J. Pers. Soc. Psychol.", "Journal of Personality and Social Psychology")).toBe(true);
    expect(venueSimilarity("Nature", ["Nature Communications"])).toBeLessThan(0.9);
  });
});
