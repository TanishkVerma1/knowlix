import { describe, expect, it } from "vitest";
import { explainVerification, plainDate } from "@/shared/explain";
import { citeKeys, findMarkers } from "@/shared/citekeys";
import { codeChecks, quoteAllCopiedRuns, quoteCopiedRun } from "@/server/research/claims";
import { redactPersonal } from "@/server/agents/guardrails";
import { scoreCandidate } from "@/server/verify/match";
import { titleSimilarity } from "@/server/text/similarity";
import type { FieldComparison, Passage, VerificationResult } from "@/shared/types";

const field = (f: FieldComparison["field"], verdict: FieldComparison["verdict"], points: number, weight: number): FieldComparison => ({ field: f, entered: "x", found: "x", similarity: verdict === "match" ? 1 : 0.5, weight, points, verdict });
const allMatch = [field("title", "match", 40, 40), field("authors", "match", 30, 30), field("year", "match", 15, 15), field("venue", "match", 15, 15)];

function result(over: Partial<VerificationResult>): VerificationResult {
  return {
    status: "verified",
    score: 100,
    reasonCode: "match",
    reason: "",
    entered: { raw: "x", format: "apa", authors: [{ family: "Wakefield" }], title: "T", doi: "10.1016/x" },
    record: { id: "r", type: "article-journal", title: "A real paper", DOI: "10.1016/x" },
    recordSource: "crossref",
    fields: allMatch,
    flags: [],
    checks: [],
    provenWrong: false,
    checkedAt: new Date().toISOString(),
    durationMs: 1,
    ...over,
  };
}

describe("why this stamp: three plain answers", () => {
  it("a verified reference answers yes three times", () => {
    const e = explainVerification(result({}));
    expect(e.questions.map((q) => q.answer)).toEqual(["yes", "yes", "yes"]);
    expect(e.scoreNote).toBeNull();
  });

  it("a retracted paper exists, matches 100/100, and is still not safe to cite", () => {
    const e = explainVerification(
      result({ status: "check", flags: [{ code: "retracted", label: "Retracted", detail: "A retraction notice was published on 2010-2-6. Cite it only to discuss the retraction.", severity: "danger", href: "https://doi.org/10.1016/notice" }] }),
    );
    expect(e.questions.map((q) => q.answer)).toEqual(["yes", "yes", "no"]);
    expect(e.questions[2].short).toBe("Retracted");
    expect(e.questions[2].text).toContain("6 February 2010");
    expect(e.questions[2].href).toBe("https://doi.org/10.1016/notice");
    // The apparent contradiction (full marks, amber stamp) is explained in words.
    expect(e.scoreNote).toMatch(/100\/100 score only measures/);
    expect(e.headline).toMatch(/retracted/);
  });

  it("a DOI that was never issued is a plain no", () => {
    const e = explainVerification(result({ status: "mismatch", provenWrong: true, reasonCode: "doi-not-registered", score: null, record: null, recordSource: null, fields: [], searchedForIntended: true, suggestion: null }));
    expect(e.questions.map((q) => q.answer)).toEqual(["no", "unknown", "no"]);
    expect(e.next).toMatch(/Remove it/);
  });

  it("not found is unknown, never an accusation", () => {
    const e = explainVerification(result({ status: "check", reasonCode: "not-found", score: 40, record: null, recordSource: null, fields: [], entered: { raw: "x", format: "apa", authors: [], title: "T" } }));
    expect(e.questions[0].answer).toBe("unknown");
    expect(e.questions[0].text).toMatch(/does not prove it is invented/);
  });

  it("a year one off is said out loud even at 100/100", () => {
    const fields = [field("title", "match", 40, 40), field("authors", "match", 30, 30), field("year", "close", 15, 15), field("venue", "match", 15, 15)];
    expect(explainVerification(result({ fields })).questions[1].text).toMatch(/year is close but not identical/);
  });

  it("formats registry dates for people", () => {
    expect(plainDate("2010-2-6")).toBe("6 February 2010");
    expect(plainDate("2019-11")).toBe("November 2019");
    expect(plainDate("2004")).toBe("2004");
    expect(plainDate(null)).toBeNull();
  });
});

describe("matching", () => {
  it("a record with no title can never score as a match, however well the rest agrees", () => {
    const m = scoreCandidate({ raw: "World Health Organization. (2021). World malaria report 2021. Bulletin of the World Health Organization.", format: "apa", authors: [{ family: "World Health Organization" }], title: "World malaria report 2021", year: 2021, venue: "Bulletin of the World Health Organization" }, { id: "c", type: "article-journal", issued: { "date-parts": [[2021]] }, "container-title": "Bulletin of the World Health Organization" });
    expect(m.score).toBeLessThanOrEqual(60);
  });

  it("titles in other scripts compare as themselves", () => {
    expect(titleSimilarity("О напряженно-деформированном состоянии стохастически неоднородной толстостенной трубы", "О НАПРЯЖЕННО-ДЕФОРМИРОВАННОМ СОСТОЯНИИ СТОХАСТИЧЕСКИ НЕОДНОРОДНОЙ ТОЛСТОСТЕННОЙ ТРУБЫ")).toBeGreaterThan(0.95);
    expect(titleSimilarity("Влияние цифровых технологий на успеваемость студентов", "A safe operating space for humanity")).toBeLessThan(0.3);
    expect(titleSimilarity("深度学习在教育中的应用", "深度学习在教育中的应用")).toBe(1);
  });
});

describe("copied wording becomes a quotation", () => {
  const passage = "Retrieval practice produced more learning than elaborative studying with concept mapping, and the advantage held on both verbatim and inference questions one week later.";
  const copied = "The study found that retrieval practice produced more learning than elaborative studying with concept mapping in a classroom setting.";

  it("wraps exactly the copied words in quotation marks", () => {
    const q = quoteCopiedRun(copied, [{ id: "P1", text: passage }]);
    expect(q?.passageId).toBe("P1");
    expect(q?.quoted.toLowerCase()).toBe("retrieval practice produced more learning than elaborative studying with concept mapping");
    expect(q?.text).toBe("The study found that “retrieval practice produced more learning than elaborative studying with concept mapping” in a classroom setting.");
  });

  it("then the sentence passes the copy check, and its quotation is verified word for word", () => {
    const fixed = quoteAllCopiedRuns(copied, [{ id: "P1", text: passage }]);
    const passages = new Map<string, Passage>([["P1", { id: "P1", sourceId: "S1", text: passage, location: "abstract" }]]);
    const before = codeChecks({ text: copied, kind: "sourced", citations: ["P1"] }, passages, []);
    const after = codeChecks({ text: fixed.text, kind: "sourced", citations: ["P1"], quote: fixed.first }, passages, []);
    expect(before.find((c) => c.kind === "similarity")?.outcome).toBe("fail");
    expect(after.find((c) => c.kind === "similarity")?.outcome).toBe("pass");
    expect(after.find((c) => c.kind === "quote")?.outcome).toBe("pass");
  });

  it("leaves a real paraphrase and an existing quotation alone", () => {
    expect(quoteCopiedRun("Testing yourself beat concept maps a week later, for facts and for inferences.", [{ id: "P1", text: passage }])).toBeNull();
    const already = "The authors report that “retrieval practice produced more learning than elaborative studying with concept mapping”.";
    expect(quoteCopiedRun(already, [{ id: "P1", text: passage }])).toBeNull();
  });
});

describe("personal details", () => {
  it("removes an email and a phone number but not a range of years", () => {
    const r = redactPersonal("I am priya.sharma@example.com, call +91 98765 43210. Did productivity change in 2015-2020 compared with 2010-2014?");
    expect(r.text).not.toContain("priya.sharma@example.com");
    expect(r.text).not.toContain("98765");
    expect(r.text).toContain("2015-2020");
    expect(r.text).toContain("2010-2014");
    expect(r.redactions).toBe(2);
  });
});

describe("draft citation keys", () => {
  const items = [
    { id: "b", firstAuthor: "Hattie", year: 2007, title: "The Power of Feedback", createdAt: "2026-01-02" },
    { id: "a", firstAuthor: "Hattie", year: 2007, title: "Another", createdAt: "2026-01-01" },
    { id: "c", firstAuthor: "Müller-Lyer", year: null, title: "Optische Urteilstäuschungen", createdAt: "2026-01-03" },
    { id: "d", firstAuthor: null, year: 2020, title: "pandas-dev/pandas: Pandas", createdAt: "2026-01-04" },
  ];

  it("are readable, unique and stable", () => {
    const k = citeKeys(items);
    expect(k.get("a")).toBe("Hattie2007");
    expect(k.get("b")).toBe("Hattie2007b");
    expect(k.get("c")).toBe("MullerLyernd");
    expect(k.get("d")).toBe("Pandasdevpandas2020");
    expect(new Set(k.values()).size).toBe(4);
  });

  it("finds single and grouped markers with page locators", () => {
    const m = findMarkers("One [@Hattie2007, p. 81]. Two [@Hattie2007; @Kang2016]. Not a marker [see note].");
    expect(m).toHaveLength(2);
    expect(m[0].parts).toEqual([{ key: "Hattie2007", locator: "p. 81" }]);
    expect(m[1].parts.map((p) => p.key)).toEqual(["Hattie2007", "Kang2016"]);
  });
});
