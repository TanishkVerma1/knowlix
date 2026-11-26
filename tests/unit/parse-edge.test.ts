import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractArxivId, extractDoi, extractIsbn, isPreprintDoi, normalizeDoi, normalizeIsbn } from "@/shared/identifiers";
import { parseAuthors, parseReference, splitReferences, titleEnd } from "@/server/verify/parse";
import { parseInput, parseStructured } from "@/server/verify/structured";

/** Edge cases found by QA on the running app and by the 300-case benchmark. Numbers refer to the defect list. */

const total = (s: ReturnType<typeof splitReferences>) => s.plain.length + s.bibtex.length + s.ris.length;

/** Greedy hard wrap, the way a PDF or an e-mail client breaks lines. */
function wrap(text: string, width: number): string {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.join("\n");
}

const LECUN = "LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436–444. https://doi.org/10.1038/nature14539";
const SILVER =
  "Silver, D., Huang, A., Maddison, C. J., Guez, A., Sifre, L., van den Driessche, G., Schrittwieser, J., Antonoglou, I., Panneershelvam, V., Lanctot, M., Dieleman, S., Grewe, D., Nham, J., Kalchbrenner, N., Sutskever, I., Lillicrap, T., Leach, M., Kavukcuoglu, K., Graepel, T., & Hassabis, D. (2016). Mastering the game of Go with deep neural networks and tree search. Nature, 529(7587), 484–489. https://doi.org/10.1038/nature16961";
const HATTIE = "Hattie, J., & Timperley, H. (2007). The power of feedback. Review of Educational Research, 77(1), 81–112. https://doi.org/10.3102/003465430298487";
const MAATEN = "van der Maaten, L., & Hinton, G. (2008). Visualizing data using t-SNE. Journal of Machine Learning Research, 9, 2579–2605.";
const BREIMAN = "Breiman, L. (2001). Random forests. Machine Learning, 45(1), 5–32.";
const FUENTE = "de la Fuente, A. (2010). From 'differential expression' to 'differential networking'. Trends in Genetics, 26(7), 326–333.";
const DARWIN = "Darwin, C. (1859). On the origin of species by means of natural selection. John Murray.";

describe("A. splitting", () => {
  it("1. keeps one bare identifier per line as one item each", () => {
    const ids = [
      "10.1038/nature14539",
      "10.1126/science.aac4716",
      "10.1145/3065386",
      "10.1016/S0140-6736(97)11096-0",
      "https://doi.org/10.1038/nature16961",
      "https://doi.org/10.1126/science.1127647",
      "http://dx.doi.org/10.1109/CVPR.2016.90",
      "doi:10.1145/2939672.2939785",
      "doi: 10.1073/pnas.1319030111",
      "DOI: 10.1371/journal.pmed.0020124",
      "ISBN 0-262-03384-4",
      "ISBN: 978-0-374-27563-1",
      "978-0-262-03384-8",
      "9780134610993",
      "0262033844",
      "arXiv:1706.03762",
      "arXiv:1412.6980v9",
      "arXiv:hep-th/9711200",
      "https://arxiv.org/abs/1810.04805",
      "https://www.who.int/news-room/fact-sheets/detail/malaria",
      "https://en.wikipedia.org/wiki/Deep_learning",
      "PMID: 16873662",
    ];
    expect(ids).toHaveLength(22);
    expect(splitReferences(ids.join("\n")).plain).toEqual(ids);
    // The same list with list markers in front.
    const marked = ids.map((id, i) => `${["[" + (i + 1) + "]", i + 1 + ".", "-", "•"][i % 4]} ${id}`);
    expect(splitReferences(marked.join("\n")).plain).toEqual(ids);
    // …and every one of them is recognised for what it is.
    const formats = ids.map((id) => parseReference(id).format);
    expect(formats.slice(0, 10).every((f) => f === "doi")).toBe(true);
    expect(formats.slice(10, 15).every((f) => f === "isbn")).toBe(true);
    expect(formats.slice(15, 19).every((f) => f === "arxiv")).toBe(true);
    expect(formats.slice(19, 21).every((f) => f === "url")).toBe(true);
  });

  it("2. splits blank-line separated identifiers", () => {
    const s = splitReferences("10.1038/nature14539\n\nhttps://doi.org/10.1126/science.1127647\n\ndoi:10.1145/3065386");
    expect(s.plain).toEqual(["10.1038/nature14539", "https://doi.org/10.1126/science.1127647", "doi:10.1145/3065386"]);
  });

  it("3. does not glue a reference onto a bare identifier above it", () => {
    const s = splitReferences(`[3] 10.1038/nature14539\n– ${DARWIN}`);
    expect(s.plain).toEqual(["10.1038/nature14539", DARWIN]);
    expect(parseReference(s.plain[1]).doi).toBeUndefined();
    // No markers at all: still two items.
    expect(splitReferences(`10.1038/nature14539\n${DARWIN}`).plain).toHaveLength(2);
    expect(splitReferences(`${BREIMAN}\nhttps://doi.org/10.1126/science.aac4716\narXiv:1412.6980`).plain).toHaveLength(3);
  });

  it("4. starts a new reference at a lowercase name particle", () => {
    expect(splitReferences([BREIMAN, MAATEN, HATTIE, FUENTE, DARWIN].join("\n")).plain).toEqual([BREIMAN, MAATEN, HATTIE, FUENTE, DARWIN]);
    const particles = ["van", "van den", "von", "de", "del", "della", "di", "da", "dos", "du", "le", "la", "el", "bin", "ibn", "ter", "ten"];
    const refs = particles.map((p, i) => `${p} Berg, A. B. (${2000 + i}). A study of things number ${i}. Journal of Studies, ${i + 1}(2), 10–20.`);
    refs.push("al-Khalili, J. (2011). The house of wisdom. Penguin Press.", "d'Alembert, J. (1743). Traité de dynamique. David.", "'t Hooft, G. (1974). A planar diagram theory for strong interactions. Nuclear Physics B, 72(3), 461–473.");
    expect(splitReferences(refs.join("\n")).plain).toEqual(refs);
    // …without a trailing full stop on the reference above, too.
    expect(splitReferences(`${BREIMAN.slice(0, -1)}\n${MAATEN}`).plain).toHaveLength(2);
  });

  it("5. rejoins hard-wrapped references that have no blank lines between them", () => {
    const refs = [LECUN, SILVER, HATTIE, MAATEN];
    for (const width of [60, 72, 80, 100]) {
      const pasted = refs.map((r) => wrap(r, width)).join("\n");
      expect(splitReferences(pasted).plain, `wrapped at ${width}`).toEqual(refs);
    }
    // The exact fragments QA saw as separate items.
    const pasted = [
      "LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning.",
      "Nature, 521(7553), 436–444. https://doi.org/10.1038/nature14539",
      "Silver, D., Huang, A., Maddison, C. J., Guez, A., Sifre, L.,",
      "van den Driessche, G., & Hassabis, D. (2016). Mastering the game of Go with",
      "deep neural networks and tree search. Nature, 529(7587), 484–489.",
      "https://doi.org/10.1038/nature16961",
    ].join("\n");
    const s = splitReferences(pasted).plain;
    expect(s).toHaveLength(2);
    expect(s[0]).toContain("436–444. https://doi.org/10.1038/nature14539");
    expect(s[1]).toContain("Sifre, L., van den Driessche, G.");
    expect(s[1]).toContain("https://doi.org/10.1038/nature16961");
  });

  it("5b. rejoins wrapped MLA, IEEE and Chicago references", () => {
    const refs = [
      "Lévi-Strauss, Claude. \"The Structural Study of Myth.\" The Journal of American Folklore, vol. 68, no. 270, 1955, pp. 428–44. JSTOR, https://doi.org/10.2307/536768.",
      "K. He, X. Zhang, S. Ren, and J. Sun, \"Deep residual learning for image recognition,\" in Proc. IEEE Conf. Comput. Vis. Pattern Recognit. (CVPR), 2016, pp. 770–778.",
      "Kahneman, Daniel, and Amos Tversky. 1979. \"Prospect Theory: An Analysis of Decision under Risk.\" Econometrica 47 (2): 263–91.",
      "World Health Organization. (2021). World malaria report 2021. World Health Organization.",
    ];
    for (const width of [70, 80, 95]) {
      expect(splitReferences(refs.map((r) => wrap(r, width)).join("\n")).plain, `wrapped at ${width}`).toEqual(refs);
    }
  });

  it("6. drops a heading line", () => {
    for (const heading of ["References", "Reference list", "Bibliography", "Works Cited", "Sources", "References:", "## References", "# Bibliography", "**References**", "WORKS CITED"]) {
      expect(splitReferences(`${heading}\n${BREIMAN}\n${HATTIE}`).plain, heading).toEqual([BREIMAN, HATTIE]);
      expect(splitReferences(`${heading}\n\n${BREIMAN}\n${HATTIE}`).plain, heading).toEqual([BREIMAN, HATTIE]);
    }
    expect(splitReferences("References").plain).toEqual([]);
  });

  it("keeps numbered, bulleted and blank-line separated lists working", () => {
    const refs = [BREIMAN, HATTIE, MAATEN, DARWIN];
    expect(splitReferences(refs.map((r, i) => `${i + 1}. ${r}`).join("\n")).plain).toEqual(refs);
    expect(splitReferences(refs.map((r, i) => `[${i + 1}] ${r}`).join("\n")).plain).toEqual(refs);
    expect(splitReferences(refs.map((r, i) => `(${i + 1}) ${r}`).join("\n")).plain).toEqual(refs);
    expect(splitReferences(refs.map((r) => `• ${r}`).join("\n")).plain).toEqual(refs);
    expect(splitReferences(refs.map((r) => `- ${r}`).join("\n")).plain).toEqual(refs);
    expect(splitReferences(refs.join("\n")).plain).toEqual(refs);
    expect(splitReferences(refs.join("\n\n")).plain).toEqual(refs);
    // Blank-line separated, each reference wrapped over several lines.
    expect(splitReferences([LECUN, SILVER, HATTIE].map((r) => wrap(r, 70)).join("\n\n")).plain).toEqual([LECUN, SILVER, HATTIE]);
    // A numbered list whose entries wrap, with a continuation line that looks like a new author.
    const s = splitReferences("[1] Smith, J. (2020). A title. Journal, 1(2), 3-4.\n[2] Doe, K. (2021). A reply to\nSmith, J. (2020). Journal, 5(6), 7-8.\n[3] Roe, P. (2022). Third. Journal, 9(1), 1-2.");
    expect(s.plain).toHaveLength(3);
    expect(s.plain[1]).toBe("Doe, K. (2021). A reply to Smith, J. (2020). Journal, 5(6), 7-8.");
  });

  it("keeps a DOI that wrapped onto its own line with its reference", () => {
    const noDoi = HATTIE.replace(/ https.*/, "");
    const s = splitReferences(`${noDoi}\nhttps://doi.org/10.3102/003465430298487\n${BREIMAN}`);
    expect(s.plain).toEqual([HATTIE, BREIMAN]);
  });

  it("joins a title that wrapped right after the bracketed year, but not a list of short author-date entries", () => {
    const prisma = "Page, M.J., McKenzie, J.E., Bossuyt, P.M., Boutron, I., Hoffmann, T.C., Mulrow, C.D. et al. (2021) 'The PRISMA 2020 statement: an updated guideline for reporting systematic reviews', BMJ, 372, n71. doi:10.1136/bmj.n71.";
    expect(splitReferences(`${prisma.replace("(2021) 'The", "(2021)\n'The")}\n${BREIMAN}`).plain).toEqual([prisma, BREIMAN]);
    expect(splitReferences("Rawls, J. (1971)\nNozick, R. (1974)\nSen, A. (2009)").plain).toHaveLength(3);
  });

  it("splits Vancouver and lowercase-name references that sit one per line", () => {
    const refs = [
      "Tumanov VI, Shchetilina EA, Elmanova SM, Cheredinov AA. Plastic deformation and magnetic properties of solid solutions of tungsten carbide in cobalt. Soviet Powder Metallurgy and Metal Ceramics. 1969;8(2):142-145. doi:10.1007/bf00774823",
      "van der Doelen F, van der Vlis EJ. De rechtspraak en de vrije juridische beroepen: Meesters in eigenzinnigheid. Justitiële verkenningen. 2007;33(6):20-39.",
      "Boh I. La filosofía del siglo XIV. Speculum. 1980;55(2):400-404. doi:10.2307/2847330",
      "hooks, b. (1994). Teaching to transgress: Education as the practice of freedom. Routledge.",
      "jbrockmendel. (2020). pandas-dev/pandas: Pandas 1.0.3. Zenodo.",
    ];
    expect(splitReferences(refs.join("\n")).plain).toEqual(refs);
    expect(splitReferences(refs.slice(0, 3).map((r) => wrap(r, 80)).join("\n")).plain).toEqual(refs.slice(0, 3));
    // Vancouver is still matched on its raw text, as before: no fields are invented for it.
    expect(parseReference(refs[0]).format).toBe("text");
    expect(parseReference(refs[0]).doi).toBe("10.1007/bf00774823");
  });

  it("does not split a title that wraps before a dash", () => {
    const ref = "Beigel, J. H., Tomashek, K. M., & Lane, H. C. (2020). Remdesivir for the treatment of Covid-19 — Final report. New England Journal of Medicine, 383(19), 1813–1826.";
    const pasted = ref.replace("Covid-19 — Final", "Covid-19\n— Final");
    expect(splitReferences(`${pasted}\n${BREIMAN}`).plain).toEqual([ref, BREIMAN]);
  });

  it("splits RIS records that have no ER terminator at the next TY", () => {
    const ris = "TY  - JOUR\nAU  - LeCun, Yann\nTI  - Deep learning\nJO  - Nature\nPY  - 2015\nTY  - JOUR\nAU  - Breiman, Leo\nTI  - Random forests\nJO  - Machine Learning\nPY  - 2001\nER  - \n\n" + HATTIE;
    const s = splitReferences(ris);
    expect(s.ris).toHaveLength(2);
    expect(s.ris[0]).toContain("Deep learning");
    expect(s.ris[0]).not.toContain("Random forests");
    expect(s.ris[1]).toContain("Random forests");
    expect(s.plain).toEqual([HATTIE]);
  });

  it("reads RIS without ER and BibTeX without its closing brace", async () => {
    const ris = await parseInput("TY  - JOUR\nAU  - LeCun, Yann\nTI  - Deep learning\nJO  - Nature\nPY  - 2015\nTY  - JOUR\nAU  - Breiman, Leo\nTI  - Random forests\nJO  - Machine Learning\nPY  - 2001");
    expect(ris.items.map((i) => i.title)).toEqual(["Deep learning", "Random forests"]);
    expect(ris.unreadable).toBe(0);
    const oneSpace = await parseInput("TY - JOUR\nAU - LeCun, Yann\nTI - Deep learning\nJO - Nature\nPY - 2015\nER - ");
    expect(oneSpace.items[0]?.title).toBe("Deep learning");
    // An unterminated BibTeX entry is repaired, and it no longer swallows the references pasted after it.
    const bib = await parseInput(`@article{x,\n  title={Deep learning},\n  author={LeCun, Yann},\n  year={2015}\n\n${BREIMAN}\n${HATTIE}`);
    expect(bib.items).toHaveLength(3);
    expect(bib.items[0].format).toBe("bibtex");
    expect(bib.items[0].title).toBe("Deep learning");
    expect(bib.unreadable).toBe(0);
    // A paste that is only an unreadable entry: no items, one unreadable entry reported.
    const bad = await parseInput("@article{x, title=Deep learning, author=LeCun}");
    expect(bad.items).toHaveLength(0);
    expect(bad.unreadable).toBe(1);
  });

  it("20. coerces array-valued BibTeX fields to one string", async () => {
    const p = await parseStructured("@book{k, title={Deep Learning}, author={Goodfellow, Ian}, year={2016}, publisher = {Springer Science and Business Media LLC}}");
    expect(p).not.toBeNull();
    expect(p!.publisher).toBe("Springer Science and Business Media LLC");
    expect(typeof p!.csl!.publisher).toBe("string");
    expect(typeof p!.title).toBe("string");
  });
});

describe("B. identifiers", () => {
  it("7. strips a URL query string and fragment from a DOI", () => {
    expect(normalizeDoi("https://doi.org/10.1038/nature14539?utm_source=x")).toBe("10.1038/nature14539");
    expect(normalizeDoi("https://doi.org/10.1038/nature14539#Abs1")).toBe("10.1038/nature14539");
    expect(extractDoi("See https://doi.org/10.1038/nature14539?utm_source=x&utm_medium=email.")).toBe("10.1038/nature14539");
    expect(extractDoi("https://www.nature.com/articles/10.1038/nature14539#Sec2")).toBe("10.1038/nature14539");
    expect(normalizeDoi("10.1038/nature14539?utm_source=x")).toBe("10.1038/nature14539");
    expect(normalizeDoi("doi:10.1038/nature14539#citeas")).toBe("10.1038/nature14539");
    // "#" followed by digits in a bare DOI is left alone (10.1000/456#789 is the DOI handbook's own example).
    expect(normalizeDoi("10.1000/456#789")).toBe("10.1000/456#789");
    expect(parseReference("https://doi.org/10.1038/nature14539?utm_source=x").doi).toBe("10.1038/nature14539");
  });

  it("8. decodes percent-encoded DOI links without throwing", () => {
    expect(normalizeDoi("https://doi.org/10.1016%2FS0140-6736%2897%2911096-0")).toBe("10.1016/s0140-6736(97)11096-0");
    expect(extractDoi("Lancet. https://doi.org/10.1016%2FS0140-6736%2897%2911096-0.")).toBe("10.1016/s0140-6736(97)11096-0");
    expect(parseReference("https://doi.org/10.1016%2FS0140-6736%2897%2911096-0").format).toBe("doi");
    expect(() => normalizeDoi("https://doi.org/10.1016/abc%ZZdef%")).not.toThrow();
    expect(normalizeDoi("https://doi.org/10.1016/abc%ZZdef%2Fx")).toBe("10.1016/abc%zzdef/x");
  });

  it("9. recognises a bare ISBN only when its check digit is right", () => {
    expect(extractIsbn("0262033844")).toBe("0262033844");
    expect(extractIsbn("9780262033848")).toBe("9780262033848");
    expect(extractIsbn("0-262-03384-4")).toBe("0262033844");
    expect(extractIsbn("080442957X")).toBe("080442957X");
    expect(extractIsbn("0262033845")).toBeNull();
    expect(extractIsbn("1234567890")).toBeNull();
    expect(parseReference("0262033844").format).toBe("isbn");
    expect(parseReference("9780262033848").format).toBe("isbn");
    // Ten digits inside a reference are not taken for an ISBN.
    expect(extractIsbn("Smith, J. (2020). Report 0262033844 on things. Publisher.")).toBeNull();
    expect(normalizeIsbn("978-0-262-03384-9")).toBeNull();
  });

  it("10. recognises old-style arXiv ids", () => {
    expect(extractArxivId("hep-th/9711200")).toBe("hep-th/9711200");
    expect(extractArxivId("arXiv:hep-th/9711200")).toBe("hep-th/9711200");
    expect(extractArxivId("arXiv:hep-th/9711200v3")).toBe("hep-th/9711200");
    expect(extractArxivId("math.GT/0309136")).toBe("math/0309136");
    expect(extractArxivId("https://arxiv.org/abs/hep-th/9711200")).toBe("hep-th/9711200");
    expect(extractArxivId("https://doi.org/10.48550/arXiv.hep-th/9711200")).toBe("hep-th/9711200");
    expect(extractArxivId("arXiv:1706.03762v5")).toBe("1706.03762");
    expect(extractArxivId("See pages/1234567 of the report")).toBeNull();
    expect(parseReference("hep-th/9711200").format).toBe("arxiv");
    expect(parseReference("arXiv:hep-th/9711200").format).toBe("arxiv");
    expect(parseReference("math.GT/0309136").format).toBe("arxiv");
    expect(isPreprintDoi("10.48550/arxiv.hep-th/9711200")).toBe(true);
  });

  it("19. keeps < > ; : inside old SICI / AMS DOIs", () => {
    expect(normalizeDoi("10.1002/(sici)1096-9837(199607)21:7<673::aid-esp664>3.0.co;2-v")).toBe("10.1002/(sici)1096-9837(199607)21:7<673::aid-esp664>3.0.co;2-v");
    expect(normalizeDoi("https://doi.org/10.1175/1520-0469(1977)034<1091:rtiapu>2.0.co;2")).toBe("10.1175/1520-0469(1977)034<1091:rtiapu>2.0.co;2");
    expect(normalizeDoi("https://doi.org/10.1175/1520-0469(1977)034%3C1091:RTIAPU%3E2.0.CO;2")).toBe("10.1175/1520-0469(1977)034<1091:rtiapu>2.0.co;2");
    expect(extractDoi("J. Atmos. Sci., 34, 1091–1110. https://doi.org/10.1175/1520-0469(1977)034<1091:rtiapu>2.0.co;2.")).toBe("10.1175/1520-0469(1977)034<1091:rtiapu>2.0.co;2");
    expect(extractDoi('He wrote "10.1002/(sici)1096-9837(199607)21:7<673::aid-esp664>3.0.co;2-v" twice')).toBe("10.1002/(sici)1096-9837(199607)21:7<673::aid-esp664>3.0.co;2-v");
    // Angle brackets AROUND a DOI, and markup after it, are not part of it.
    expect(extractDoi("<https://doi.org/10.1038/nature14539>")).toBe("10.1038/nature14539");
    expect(extractDoi('<a href="x">10.1038/nature14539</a>')).toBe("10.1038/nature14539");
  });

  it("keeps the existing DOI behaviour", () => {
    expect(normalizeDoi("http://dx.doi.org/10.1038/NATURE14539")).toBe("10.1038/nature14539");
    expect(normalizeDoi("doi:10.1038/nature14539")).toBe("10.1038/nature14539");
    expect(normalizeDoi("10.1038/nature14539.")).toBe("10.1038/nature14539");
    expect(normalizeDoi("(10.1038/nature14539)")).toBe("10.1038/nature14539");
    expect(normalizeDoi("[10.1038/nature14539]")).toBe("10.1038/nature14539");
    expect(extractDoi("Lancet, 395. (doi:10.1016/S0140-6736(20)30183-5).")).toBe("10.1016/s0140-6736(20)30183-5");
    expect(normalizeDoi("not a doi")).toBeNull();
    expect(normalizeDoi(null)).toBeNull();
  });
});

describe("C. field parsing", () => {
  it("11. keeps an organisation as one author", () => {
    const who = parseReference("World Health Organization. (2021). World malaria report 2021. World Health Organization.");
    expect(who.authors).toEqual([{ family: "World Health Organization" }]);
    expect(who.title).toBe("World malaria report 2021");
    expect(who.year).toBe(2021);
    const pandas = parseReference("The pandas development team. (2020). pandas-dev/pandas: Pandas. Zenodo.");
    expect(pandas.authors).toEqual([{ family: "The pandas development team" }]);
    expect(pandas.title).toBe("pandas-dev/pandas: Pandas");
    expect(parseAuthors("Centers for Disease Control and Prevention.").authors).toEqual([{ family: "Centers for Disease Control and Prevention" }]);
    expect(parseAuthors("National Academies of Sciences, Engineering, and Medicine").authors).toHaveLength(1);
    expect(parseAuthors("U.S. Department of Health and Human Services").authors).toHaveLength(1);
    expect(parseAuthors("Statistics Canada", "inverted").authors).toEqual([{ family: "Statistics Canada" }]);
    // People stay people.
    expect(parseAuthors("OECD").authors).toEqual([{ family: "OECD" }]);
    expect(parseAuthors("Smith JA", "inverted").authors).toEqual([{ family: "Smith", given: "JA" }]);
    expect(parseAuthors("J. A. Smith").authors).toEqual([{ family: "Smith", given: "J. A." }]);
    expect(parseAuthors("Hattie, J., & Timperley, H.", "inverted").authors.map((a) => a.family)).toEqual(["Hattie", "Timperley"]);
    expect(parseAuthors("Staff, Jeremy, and Jeylan Mortimer").authors.map((a) => a.family)).toEqual(["Staff", "Mortimer"]);
    expect(parseAuthors("John Smith and Jane Doe").authors.map((a) => a.family)).toEqual(["Smith", "Doe"]);
  });

  it("12. reads Chicago author-date", () => {
    for (const ref of [
      'Kahneman, Daniel, and Amos Tversky. 1979. "Prospect Theory: An Analysis of Decision under Risk." Econometrica 47 (2): 263–91.',
      "Kahneman, Daniel, and Amos Tversky. 1979. “Prospect Theory: An Analysis of Decision under Risk.” Econometrica 47 (2): 263–91.",
    ]) {
      const p = parseReference(ref);
      expect(p.authors.map((a) => a.family)).toEqual(["Kahneman", "Tversky"]);
      expect(p.year).toBe(1979);
      expect(p.title).toBe("Prospect Theory: An Analysis of Decision under Risk");
      expect(p.venue).toBe("Econometrica");
      expect(p.volume).toBe("47");
      expect(p.issue).toBe("2");
      expect(p.pages).toBe("263–91");
    }
    const coase = parseReference('Coase, R. H. 1960. "The Problem of Social Cost." Journal of Law and Economics 3 (October): 1–44.');
    expect(coase.authors.map((a) => a.family)).toEqual(["Coase"]);
    expect(coase.authors[0].given).toMatch(/^R\. H\.?$/);
    expect(coase.year).toBe(1960);
    expect(coase.venue).toBe("Journal of Law and Economics");
    expect(coase.volume).toBe("3");
    expect(coase.issue).toBeUndefined();
    const notes = parseReference("Storozhuk, V. M. “Discharges from somatosensory cortical neurons as an index of after-phenomena.” Neuroscience Translations 2, no. 1 (1968): 498–504.");
    expect(notes.venue).toBe("Neuroscience Translations");
    expect(notes.volume).toBe("2");
    expect(notes.issue).toBe("1");
    expect(notes.year).toBe(1968);
    // A page range that looks like years is not the year.
    expect(parseReference('Hochreiter, Sepp, and Jürgen Schmidhuber. "Long Short-Term Memory." Neural Computation, vol. 9, no. 8, 1997, pp. 1735–1780.').year).toBe(1997);
  });

  it("13. does not end a venue at an abbreviation dot or at '(pp.'", () => {
    const ieee = parseReference('K. He, X. Zhang, S. Ren, and J. Sun, "Deep residual learning for image recognition," in Proc. IEEE Conf. Comput. Vis. Pattern Recognit. (CVPR), 2016, pp. 770–778.');
    expect(ieee.venue).toBe("Proc. IEEE Conf. Comput. Vis. Pattern Recognit. (CVPR)");
    expect(ieee.year).toBe(2016);
    expect(ieee.pages).toBe("770–778");
    expect(ieee.authors.map((a) => a.family)).toEqual(["He", "Zhang", "Ren", "Sun"]);
    const shannon = parseReference('C. E. Shannon, "A mathematical theory of communication," Bell Syst. Tech. J., vol. 27, no. 3, pp. 379–423, Jul. 1948, doi: 10.1002/j.1538-7305.1948.tb01338.x.');
    expect(shannon.venue).toBe("Bell Syst. Tech. J.");
    expect(shannon.volume).toBe("27");
    expect(shannon.year).toBe(1948);
    const nips = parseReference("Krizhevsky, A., Sutskever, I., & Hinton, G. E. (2012). ImageNet classification with deep convolutional neural networks. In Advances in Neural Information Processing Systems 25 (pp. 1097–1105).");
    expect(nips.venue).toBe("Advances in Neural Information Processing Systems 25");
    expect(nips.pages).toBe("1097–1105");
    const cvpr = parseReference("He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. In Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR) (pp. 770–778). IEEE.");
    expect(cvpr.venue).toBe("Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)");
    expect(cvpr.publisher).toBe("IEEE");
    // A journal whose own name contains a full stop keeps it; a publisher after the journal does not join it.
    const series = parseReference("Минаева, Н. В., & Сабынин, Д. В. (2021). О напряженно-деформированном состоянии стохастически неоднородной толстостенной трубы. Известия Российской академии наук. Механика твердого тела, 157–164.");
    expect(series.venue).toBe("Известия Российской академии наук. Механика твердого тела");
    const noVolume = parseReference("Авилова, Вилора Вадимовна. “О корректировке целеполагания российской промышленной стратегии.” Экономика. Информатика (2022): 684–692.");
    expect(noVolume.venue).toBe("Экономика. Информатика");
    expect(noVolume.pages).toBe("684–692");
    expect(noVolume.year).toBe(2022);
    const mla = parseReference('Smith, John, and Jane Doe. "Reading on Screens." Journal of Literacy, vol. 12, no. 3, 2020, pp. 45-67.');
    expect(mla.venue).toBe("Journal of Literacy");
    expect(mla.volume).toBe("12");
    expect(mla.issue).toBe("3");
    expect(mla.pages).toBe("45-67");
    expect(mla.year).toBe(2020);
    const chapter = parseReference("Ajzen, I. (1985). From intentions to actions: A theory of planned behavior. In J. Kuhl & J. Beckmann (Eds.), Action control: From cognition to behavior (pp. 11–39). Springer.");
    expect(chapter.venue).toBe("Action control: From cognition to behavior");
    expect(chapter.publisher).toBe("Springer");
    expect(chapter.pages).toBe("11–39");
  });

  it("14. + 24. reads arXiv preprints, new and old ids", () => {
    const bert = parseReference("Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2018). BERT: Pre-training of deep bidirectional transformers for language understanding. arXiv preprint arXiv:1810.04805.");
    expect(bert.venue).toBe("arXiv");
    expect(bert.arxivId).toBe("1810.04805");
    expect(bert.title).toBe("BERT: Pre-training of deep bidirectional transformers for language understanding");
    const old = parseReference("Lisker, T., Heber, U., Napiwotzki, R., & Christlieb, N. (2003). Spectroscopic analysis of sdB stars from the ESO Supernova Ia Progenitor Survey. arXiv preprint arXiv:astro-ph/0310816.");
    expect(old.arxivId).toBe("astro-ph/0310816");
    expect(old.venue).toBe("arXiv");
    expect(old.title).toBe("Spectroscopic analysis of sdB stars from the ESO Supernova Ia Progenitor Survey");
    expect(old.format).toBe("apa");
  });

  it("15. reads undated references", () => {
    for (const date of ["in press", "n.d.", "n. d.", "forthcoming"]) {
      const p = parseReference(`Smith, J. A. (${date}). The future of memory research. Journal of Experimental Psychology.`);
      expect(p.year, date).toBeUndefined();
      expect(p.title, date).toBe("The future of memory research");
      expect(p.venue, date).toBe("Journal of Experimental Psychology");
      expect(p.authors.map((a) => a.family), date).toEqual(["Smith"]);
    }
  });

  it("16. reads an undated web page with a retrieval date", () => {
    const p = parseReference("World Health Organization. (n.d.). Malaria. Retrieved March 3, 2024, from https://www.who.int/news-room/fact-sheets/detail/malaria");
    expect(p.title).toBe("Malaria");
    expect(p.url).toBe("https://www.who.int/news-room/fact-sheets/detail/malaria");
    expect(p.venue).toBeUndefined();
    expect(p.year).toBeUndefined();
    expect(p.authors).toEqual([{ family: "World Health Organization" }]);
  });

  it("17. keeps a thesis descriptor out of the title", () => {
    const p = parseReference("Shannon, C. E. (1940). A symbolic analysis of relay and switching circuits [Master's thesis, Massachusetts Institute of Technology].");
    expect(p.title).toBe("A symbolic analysis of relay and switching circuits");
    expect(p.publisher).toBe("Massachusetts Institute of Technology");
    expect(p.year).toBe(1940);
    const long = parseReference("Doe, J. (2019). Learning to learn [Doctoral dissertation, Massachusetts Institute of Technology, Department of Electrical Engineering and Computer Science]. ProQuest Dissertations and Theses Global.");
    expect(long.title).toBe("Learning to learn");
    expect(long.venue).toBe("ProQuest Dissertations and Theses Global");
    expect(long.publisher).toContain("Massachusetts Institute of Technology");
  });

  it("18. parses non-Latin references instead of treating them as a bare DOI", () => {
    const ru = parseReference("Иванов, П. С., & Петрова, А. Н. (2019). Влияние цифровых технологий на успеваемость студентов сельских школ. Вестник образования, 12(3), 45–67. https://doi.org/10.1038/461472a");
    expect(ru.format).toBe("apa");
    expect(ru.authors.map((a) => a.family)).toEqual(["Иванов", "Петрова"]);
    expect(ru.year).toBe(2019);
    expect(ru.title).toBe("Влияние цифровых технологий на успеваемость студентов сельских школ");
    expect(ru.venue).toBe("Вестник образования");
    expect(ru.doi).toBe("10.1038/461472a");
    const zh = parseReference("李明. (2019). 论学习. https://doi.org/10.1038/461472a");
    expect(zh.format).not.toBe("doi");
    expect(zh.title).toBe("论学习");
    const zh2 = parseReference("张伟, 李明. (2019). 深度学习在医学影像中的应用. 计算机学报, 42(1), 1–20.");
    expect(zh2.authors.map((a) => a.family)).toEqual(["张伟", "李明"]);
    expect(zh2.title).toBe("深度学习在医学影像中的应用");
    expect(zh2.venue).toBe("计算机学报");
    const ar = parseReference("الخطيب, م. (2018). أثر التعليم الإلكتروني على التحصيل الدراسي. مجلة العلوم التربوية, 30(2), 215–240. https://doi.org/10.1038/461472a");
    expect(ar.format).not.toBe("doi");
    expect(ar.year).toBe(2018);
    // Identifiers alone are still identifiers.
    expect(parseReference("https://doi.org/10.1038/461472a").format).toBe("doi");
    expect(parseReference("doi:10.1038/461472a").format).toBe("doi");
    // …and a Cyrillic author list starts a new reference when splitting.
    expect(splitReferences(`${BREIMAN}\nИванов, П. С., & Петрова, А. Н. (2019). Влияние цифровых технологий. Вестник образования, 12(3), 45–67.`).plain).toHaveLength(2);
  });

  it("21. does not cut a title at an internal full stop", () => {
    const a = parseReference("Eyles, D. E., Laing, A. B. G., & Fong, Y. L. (1962). Plasmodium Fieldi Sp. Nov., a New Species of Malaria Parasite from the Pig-Tailed Macaque in Malaya. Annals of Tropical Medicine & Parasitology, 56(2), 242–247.");
    expect(a.title).toBe("Plasmodium Fieldi Sp. Nov., a New Species of Malaria Parasite from the Pig-Tailed Macaque in Malaya");
    expect(a.venue).toBe("Annals of Tropical Medicine & Parasitology");
    const b = parseReference("Williams, R. (2014). 8. Le verdissement du paysage urbain. In Architecture de paysage du Canada (pp. 152–169). Presses de l’Université de Montréal.");
    expect(b.title).toBe("8. Le verdissement du paysage urbain");
    expect(b.venue).toBe("Architecture de paysage du Canada");
    expect(b.publisher).toBe("Presses de l’Université de Montréal");
    const c = parseReference("Ignat'ev, Y. G. (2021). Gravitational-scalar instability of a cosmological model based on a two-component system of degenerate scalar charged fermions and Higgs scalar fields. I. Mathematical model of linear plane perturbations. arXiv preprint arXiv:2103.13866.");
    expect(c.title).toBe("Gravitational-scalar instability of a cosmological model based on a two-component system of degenerate scalar charged fermions and Higgs scalar fields. I. Mathematical model of linear plane perturbations");
    expect(c.venue).toBe("arXiv");
    // A question in the title followed by a subtitle: the title ends where the journal starts.
    const d = parseReference("Chetty, R., Hendren, N., Kline, P., & Saez, E. (2014). Where is the land of opportunity? The geography of intergenerational mobility in the United States. The Quarterly Journal of Economics, 129(4), 1553–1623.");
    expect(d.title).toBe("Where is the land of opportunity? The geography of intergenerational mobility in the United States");
    expect(d.venue).toBe("The Quarterly Journal of Economics");
    // Existing behaviour: abbreviated journals and "vs." still work.
    expect(titleEnd("Seaside Shrubs: Wind Forms vs. Spray Forms. Science, 85(2212), 499.")).toBe("Seaside Shrubs: Wind Forms vs. Spray Forms".length);
    expect(titleEnd("Neural networks and physical systems. Proc. Natl. Acad. Sci. USA, 79(8), 2554–2558.")).toBe("Neural networks and physical systems".length);
    expect(titleEnd("A first sentence. A second sentence.")).toBe("A first sentence".length);
  });

  it("22. keeps a compound first surname together (MLA / Chicago)", () => {
    const a = parseReference("Daee Abedin, Samira, and Shahriar Zarshenas. “Polis, Nihilism and the Tragic Age of the Greeks.” Journal of Philosophical Investigations 14, no. 32 (2020): 141–158.");
    expect(a.authors.map((x) => x.family)).toEqual(["Daee Abedin", "Zarshenas"]);
    expect(a.authors[0].given).toBe("Samira");
    const b = parseReference("Pérouse de Montclos, Marc-Antoine. “Le bilan impossible de l'aide au développement.” In Pour un développement « humanitaire » ?, 123–147. IRD Éditions, 2015.");
    expect(b.authors).toEqual([{ family: "Pérouse de Montclos", given: "Marc-Antoine" }]);
    expect(b.year).toBe(2015);
    // The ordinary MLA forms are untouched.
    expect(parseAuthors("Smith, John, and Jane Doe").authors.map((x) => x.family)).toEqual(["Smith", "Doe"]);
    expect(parseAuthors("Ferreira, Ana Lúcia, and Tomasz Wójcik").authors.map((x) => x.family)).toEqual(["Ferreira", "Wójcik"]);
  });

  it("23. does not take a quoted phrase inside a title for the title", () => {
    const p = parseReference("Mazur, A. and Rosa, E. (1977) ‘An Empirical Test of McClelland's \"Achieving Society\" Theory’, Social Forces, 55(3), p. 769.");
    expect(p.title).toBe("An Empirical Test of McClelland's \"Achieving Society\" Theory");
    expect(p.authors.map((a) => a.family)).toEqual(["Mazur", "Rosa"]);
    expect(p.year).toBe(1977);
    expect(p.venue).toBe("Social Forces");
    expect(p.volume).toBe("55");
    expect(p.issue).toBe("3");
    const apa = parseReference('Smith, J. (2020). The "new normal" in higher education. Journal of Higher Education, 91(4), 501–520.');
    expect(apa.title).toBe('The "new normal" in higher education');
    expect(apa.authors.map((a) => a.family)).toEqual(["Smith"]);
    expect(apa.venue).toBe("Journal of Higher Education");
    // Curly quotes nest: the title ends at the quote that closes the first one.
    const nested = parseReference("Calero, Remedios, and Martina G. Gallarza. “Loyalty behaviour in patients: applied analysis to the “Alzira Model” (El comportamiento de lealtad del paciente).” International Review on Public and Nonprofit Marketing 12, no. 1 (2014): 89–91.");
    expect(nested.title).toBe("Loyalty behaviour in patients: applied analysis to the “Alzira Model” (El comportamiento de lealtad del paciente)");
    expect(nested.venue).toBe("International Review on Public and Nonprofit Marketing");
    expect(nested.authors.map((a) => a.family)).toEqual(["Calero", "Gallarza"]);
    // A Harvard title in double quotes right after the year is still the title.
    const harvard = parseReference('Hardin, G. (1968) "The tragedy of the commons", Science, 162(3859), pp. 1243–1248.');
    expect(harvard.title).toBe("The tragedy of the commons");
    expect(harvard.venue).toBe("Science");
  });

  it("25. reads MLA with an unquoted title and et al.", () => {
    const p = parseReference("Mendieta Izquierdo, Giovane, et al. Dataset supporting the review. Zenodo, 2026. https://doi.org/10.5281/zenodo.24112404.");
    expect(p.authors.map((a) => a.family)).toEqual(["Mendieta Izquierdo"]);
    expect(p.etAl).toBe(true);
    expect(p.title).toBe("Dataset supporting the review");
    expect(p.venue ?? p.publisher).toBe("Zenodo");
    expect(p.year).toBe(2026);
    expect(p.doi).toBe("10.5281/zenodo.24112404");
    const book = parseReference("Kahneman, Daniel. Thinking, Fast and Slow. Farrar, Straus and Giroux, 2011.");
    expect(book.authors).toEqual([{ family: "Kahneman", given: "Daniel" }]);
    expect(book.title).toBe("Thinking, Fast and Slow");
    expect(book.year).toBe(2011);
  });
});

/* ───────────────────────── Regression corpus ───────────────────────── */

const data = (name: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "bench", "data", name), "utf8"));
type Case = { id: string; text: string; structured: boolean };
const handWritten: Case[] = [...data("references.json"), ...data("holdout.json")].map((r: { id: string; raw: string }) => ({ id: r.id, text: r.raw, structured: r.raw.trim().startsWith("@") }));
const generated: Case[] = (data("generated.json").cases as { id: string; input: string; style: string }[])
  .filter((c) => c.style !== "bibtex")
  .map((c) => ({ id: c.id, text: c.input, structured: false }));

describe("regression corpus (bench/data)", () => {
  it("has the expected size", () => {
    expect(handWritten).toHaveLength(100);
    expect(generated.length).toBeGreaterThanOrEqual(250);
  });

  it("splits every hand-written benchmark reference into exactly one item", () => {
    const wrong = handWritten.filter((c) => total(splitReferences(c.text)) !== 1).map((c) => c.id);
    expect(wrong).toEqual([]);
  });

  it("splits every generated benchmark reference into exactly one item", () => {
    const wrong = generated.filter((c) => total(splitReferences(c.text)) !== 1).map((c) => c.id);
    expect(wrong).toEqual([]);
  });

  it("splits ten references joined by single newlines into ten", () => {
    const plain = [...handWritten, ...generated].filter((c) => !c.structured);
    const failures: string[] = [];
    for (let i = 0; i + 10 <= plain.length; i += 10) {
      const group = plain.slice(i, i + 10);
      const got = splitReferences(group.map((c) => c.text).join("\n")).plain.length;
      if (got !== 10) failures.push(`${group[0].id}…${group[9].id}: ${got}`);
    }
    expect(failures).toEqual([]);
  });

  it("splits ten references joined by blank lines into ten", () => {
    const plain = [...handWritten, ...generated].filter((c) => !c.structured);
    const failures: string[] = [];
    for (let i = 0; i + 10 <= plain.length; i += 10) {
      const group = plain.slice(i, i + 10);
      const got = splitReferences(group.map((c) => c.text).join("\n\n")).plain.length;
      if (got !== 10) failures.push(`${group[0].id}…${group[9].id}: ${got}`);
    }
    expect(failures).toEqual([]);
  });

  it("splits the whole hand-written list, numbered, into one item per reference", () => {
    const plain = handWritten.filter((c) => !c.structured).slice(0, 50);
    const numbered = plain.map((c, i) => `${i + 1}. ${c.text.replace(/^\[\d+\]\s*/, "")}`).join("\n");
    expect(splitReferences(numbered).plain).toHaveLength(plain.length);
  });

  it("parses every corpus reference without throwing and keeps its DOI", () => {
    for (const c of [...handWritten, ...generated]) {
      if (c.structured) continue;
      const item = splitReferences(c.text).plain[0];
      const p = parseReference(item);
      expect(p.raw.length, c.id).toBeGreaterThan(5);
      if (/10\.\d{4,9}\//.test(c.text)) expect(p.doi, c.id).toBeTruthy();
    }
  });
});
