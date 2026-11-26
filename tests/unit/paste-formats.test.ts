import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseReference, splitReferences } from "@/server/verify/parse";
import { extractDoi } from "@/shared/identifiers";

/**
 * A reference list is pasted the way it was copied: hard-wrapped from a PDF,
 * labelled with letters, with a DOI broken across two lines. However it
 * arrives, each reference is one reference. (The lists here are sample test
 * data with invented entries in them; nothing in the app is written for these
 * particular references.)
 */
const fixture = (name: string) => fs.readFileSync(path.resolve(__dirname, "../fixtures", name), "utf8");
const split = (text: string) => splitReferences(text).plain;

describe("a reference list pasted in different shapes", () => {
  it("keeps eight references as eight, whether pasted with blank lines, one per line, or hard-wrapped from a PDF", () => {
    for (const name of ["phase2-test-pack.txt", "phase2-pack-as-web.txt", "phase2-pack-as-pdf.txt"]) {
      const refs = split(fixture(name));
      expect(refs, name).toHaveLength(8);
      expect(refs[0], name).toMatch(/^Kahneman, D\./);
      expect(refs[6], name).toMatch(/^LECUN Y/);
      expect(refs[7], name).toMatch(/^Mental health\. World Health Organization\. https:\/\/www\.who\.int\/health-topics\/mental-health$/);
    }
  });

  it("ignores a heading line and a printed page footer that were copied along with the list", () => {
    const refs = split(`References, exactly as the student pasted them:\n${fixture("phase2-pack-as-pdf.txt")}26/11/2026, 13:34 Some Page Title\nhttps://example.org/requirements 2/4\n`);
    expect(refs).toHaveLength(8);
    expect(refs[0]).toMatch(/^Kahneman, D\./);
    expect(refs[7]).toMatch(/mental-health$/);
  });

  it("drops the letter labels of a lettered list, so the label is never read as an author", () => {
    const refs = split(fixture("phase2-pack-as-web.txt"));
    for (const r of refs) expect(r).not.toMatch(/^[A-H]\. /);
    expect(parseReference(refs[0]).authors.map((a) => a.family)).toEqual(["Kahneman", "Tversky"]);
  });

  it("mends a DOI that a line break cut in two", () => {
    const refs = split(fixture("phase2-pack-as-pdf.txt"));
    expect(extractDoi(refs[3])).toBe("10.1016/s0140-6736(97)11096-0");
  });

  it("keeps one wrapped reference as one: the journal line belongs to the reference above", () => {
    expect(split("Kahneman, D., & Tversky, A. (1981). Prospect theory: An analysis of decision under risk.\nEconometrica, 47(2), 263–291. https://doi.org/10.2307/1914185")).toHaveLength(1);
    expect(split("LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436–444.\nhttps://doi.org/10.1038/nature14539")).toHaveLength(1);
    expect(split("Smith, J. (2020). A study of sleep.\nThe Lancet, 351(9103), 637–641.")).toHaveLength(1);
  });

  it("reads a single labelled reference without its label", () => {
    expect(split("C. Sharma, R., & Al-Mansoori, K. (2023). Generative AI and academic integrity. Journal of Higher Education Policy, 45(3), 211–229.")[0]).toMatch(/^Sharma, R\./);
    expect(split("H. Mental health. World Health Organization. https://www.who.int/health-topics/mental-health")[0]).toMatch(/^Mental health\./);
    expect(split("G. LECUN Y, BENGIO Y, HINTON G. Deep Learning. Nature 2015;521:436-44.")[0]).toMatch(/^LECUN Y/);
  });

  it("still reads an initial as an initial in IEEE references", () => {
    const ieee = split("K. He, X. Zhang, S. Ren, and J. Sun, “Deep residual learning for image recognition,” in Proc. CVPR, 2016, pp. 770–778.\nC. E. Shannon, “A mathematical theory of communication,” Bell Syst. Tech. J., vol. 27, pp. 379–423, 1948.");
    expect(ieee).toHaveLength(2);
    expect(ieee[0]).toMatch(/^K\. He/);
    expect(ieee[1]).toMatch(/^C\. E\. Shannon/);
  });

  it("still splits two different references that follow each other without a blank line", () => {
    expect(split("LECUN Y, BENGIO Y, HINTON G. Deep Learning. Nature 2015;521:436-44.\nMental health. World Health Organization. https://www.who.int/health-topics/mental-health")).toHaveLength(2);
    expect(split("Smith, J. (2020). Sleep and memory. Sleep, 43(2), 1–9.\nJones, K. (2019). Memory and sleep. Memory, 27(4), 10–19.")).toHaveLength(2);
  });
});
