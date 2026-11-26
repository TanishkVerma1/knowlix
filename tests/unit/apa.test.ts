import { describe, expect, it } from "vitest";
import { apaSentenceCase } from "@/shared/sentence-case";
import { bibliographyEntries, referencesRtf, safeInline } from "@/shared/rich-refs";
import { formatBibliography, formatBibliographyHtml } from "@/server/cite/citeproc";
import type { CslItem } from "@/shared/types";

describe("APA 7 sentence case for titles", () => {
  it("lowers a Title Case title but keeps the first word and the word after a colon", () => {
    expect(apaSentenceCase("Retrieval Practice Produces More Learning than Elaborative Studying with Concept Mapping")).toBe("Retrieval practice produces more learning than elaborative studying with concept mapping");
    expect(apaSentenceCase("Test-Enhanced Learning: Taking Memory Tests Improves Long-Term Retention")).toBe("Test-enhanced learning: Taking memory tests improves long-term retention");
    expect(apaSentenceCase("Thinking, Fast and Slow")).toBe("Thinking, fast and slow");
    expect(apaSentenceCase("Why Do Students Forget? A Review of the Evidence")).toBe("Why do students forget? A review of the evidence");
  });

  it("keeps acronyms, mixed-case words and numbers as written", () => {
    expect(apaSentenceCase("The Role of DNA and mRNA Vaccines During COVID-19 in MOOCs")).toBe("The role of DNA and mRNA vaccines during COVID-19 in MOOCs");
    expect(apaSentenceCase("Using ChatGPT in Higher Education Classrooms")).toBe("Using ChatGPT in higher education classrooms");
  });

  it("keeps common proper nouns and place names", () => {
    expect(apaSentenceCase("Sleep and Exam Scores Among Indian Students in Dubai and the United States")).toBe("Sleep and exam scores among Indian students in Dubai and the United States");
    expect(apaSentenceCase("A Bayesian Model of Alzheimer's Disease Progression")).toBe("A Bayesian model of Alzheimer's disease progression");
  });

  it("repairs an ALL CAPS title", () => {
    expect(apaSentenceCase("DEEP LEARNING FOR EVERYONE: A SHORT GUIDE")).toBe("Deep learning for everyone: A short guide");
  });

  it("leaves a title that is already in sentence case exactly as it is", () => {
    for (const t of ["Deep learning", "Attention is all you need", "Why most published research findings are false", "Naturaleza y propósito de la educación", "深度学习"]) expect(apaSentenceCase(t)).toBe(t);
  });
});

describe("APA 7 reference list with italics", () => {
  const items: CslItem[] = [
    { id: "a", type: "article-journal", title: "Retrieval Practice Produces More Learning than Elaborative Studying with Concept Mapping", author: [{ family: "Karpicke", given: "Jeffrey D." }, { family: "Blunt", given: "Janell R." }], issued: { "date-parts": [[2011]] }, "container-title": "Science", volume: "331", issue: "6018", page: "772-775", DOI: "10.1126/science.1199327" },
    { id: "b", type: "book", title: "Thinking, Fast and Slow", author: [{ family: "Kahneman", given: "Daniel" }], issued: { "date-parts": [[2011]] }, publisher: "Farrar, Straus and Giroux" },
  ];

  it("prints an article the way APA 7 asks: sentence-case title, italic journal and volume", async () => {
    const text = await formatBibliography(items, "apa", "text");
    expect(text).toContain("Karpicke, J. D., & Blunt, J. R. (2011). Retrieval practice produces more learning than elaborative studying with concept mapping. Science, 331(6018), 772–775. https://doi.org/10.1126/science.1199327");
    const html = await formatBibliographyHtml(items, "apa");
    expect(html).toContain("<i>Science</i>, <i>331</i>(6018), 772–775.");
    expect(html).toContain("<i>Thinking, fast and slow</i>. Farrar, Straus and Giroux.");
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).not.toMatch(/<div|class=/);
  });

  it("leaves titles alone in styles that use title case", async () => {
    expect(await formatBibliography(items, "mla", "text")).toContain("Retrieval Practice Produces More Learning");
  });

  it("lets only harmless inline tags through to the page", () => {
    expect(safeInline('Deep <i>learning</i> <script>alert(1)</script><img src=x onerror=1> a < b <I onclick="x">c</I>')).toBe("Deep <i>learning</i> alert(1) a c</i>");
    expect(bibliographyEntries('<div class="csl-bib-body">\n  <div data-csl-entry-id="x" class="csl-entry"><div class="csl-left-margin">[1]</div><div class="csl-right-inline">A. Author, <i>Title</i>.</div></div>\n</div>')).toEqual([{ id: "x", html: "[1] A. Author, <i>Title</i>." }]);
  });

  it("writes a Word-readable file with italics, a hanging indent and non-English letters intact", () => {
    const rtf = referencesRtf("<p>Müller, A. (2020). Title &#38; more. <i>Science</i>, <i>3</i>, 1–2.</p>");
    expect(rtf.startsWith(String.raw`{\rtf1`)).toBe(true);
    expect(rtf).toContain(String.raw`{\i Science}`);
    expect(rtf).toContain(String.raw`\li720\fi-720`);
    expect(rtf).toContain(String.raw`M\u252?ller`);
    expect(rtf).toContain("Title & more");
    expect(rtf).toContain(String.raw`1\u8211?2`);
  });
});
