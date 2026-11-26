import "server-only";
import type { ChatRequest } from "./index";

/**
 * Deterministic fake AI for automated tests (MOCK_AI=1). It reads the same
 * inputs a real model gets and returns schema-valid JSON, so the whole
 * pipeline, guardrails included, can be tested offline. Never used in demos.
 */
export function mockChat(req: ChatRequest): string {
  const input = (() => {
    const m = req.user.match(/<input_json>([\s\S]*?)<\/input_json>/);
    try {
      return m ? JSON.parse(m[1]) : {};
    } catch {
      return {};
    }
  })();

  switch (req.agent) {
    case "planner": {
      const q: string = input.question ?? "the topic";
      const core = q.replace(/[?.!]/g, "").split(/\s+/).filter((w) => w.length > 3).slice(0, 6).join(" ");
      return JSON.stringify({
        restatedQuestion: q,
        subQuestions: [`What evidence exists on ${core}?`, `What are the limitations of that evidence?`],
        keyConcepts: core.split(" ").slice(0, 4),
        include: ["peer-reviewed studies"],
        exclude: ["opinion pieces"],
        queries: [
          { text: core, purpose: "Main search" },
          { text: `${core} review`, purpose: "Find reviews" },
        ],
        assumptions: ["English-language sources"],
        integrityNote: null,
      });
    }
    case "finder": {
      const cands: { id: string }[] = input.candidates ?? [];
      return JSON.stringify({ screened: cands.map((c, i) => ({ id: c.id, relevance: i < 4 ? "high" : "medium", reason: "Mock relevance." })) });
    }
    case "writer":
    case "repair": {
      const passages: { id: string; text: string }[] = input.passages ?? [];
      type MockSentence = { text: string; kind: string; citations: string[]; quote: { passageId: string; text: string } | null };
      const quoteOf = (p: { id: string; text: string }): MockSentence => {
        const first = p.text.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "").slice(0, 200);
        return { text: `One source reports that “${first}”.`, kind: "sourced", citations: [p.id], quote: { passageId: p.id, text: first } };
      };
      if (req.agent === "repair") {
        const failures: { sentenceId: string; citations: string[] }[] = input.failures ?? [];
        return JSON.stringify({
          rewrites: failures.map((f) => {
            const p = passages.find((x) => x.id === f.citations[0]);
            return p ? { sentenceId: f.sentenceId, text: quoteOf(p).text, citations: [p.id] } : { sentenceId: f.sentenceId, text: null, citations: [] };
          }),
        });
      }
      const sentences: MockSentence[] = passages.slice(0, 3).map(quoteOf);
      sentences.push({ text: "Taken together, these sources suggest the question deserves careful, context-specific reading.", kind: "reasoning", citations: [], quote: null });
      return JSON.stringify({ sentences, gaps: ["Long-term effects were not covered by the sources found."] });
    }
    case "judge": {
      const claims: { id: string; passages: { id: string; text: string }[] }[] = input.claims ?? [];
      return JSON.stringify({
        verdicts: claims.flatMap((c) => c.passages.map((p) => ({ claimId: c.id, passageId: p.id, verdict: "supports", evidence: p.text.split(/(?<=[.!?])\s/)[0].slice(0, 160), reason: "Mock verdict." }))),
      });
    }
    case "critic":
      return JSON.stringify({ flags: [{ type: "low_evidence", severity: "info", message: "Mock critic: only a few sources were used." }] });
    default:
      return "{}";
  }
}
