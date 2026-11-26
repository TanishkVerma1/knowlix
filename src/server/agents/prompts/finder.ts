import { z } from "zod";
import type { AgentDef } from "./constitution";

export interface FinderInput {
  question: string;
  candidates: { id: string; title: string; year: number | null; venue: string | null; abstract: string | null }[];
}

export const finderSchema = z.object({
  screened: z
    .array(
      z.object({
        id: z.string(),
        relevance: z.enum(["high", "medium", "low"]),
        reason: z.string().max(200),
      }),
    )
    .max(40),
});
export type FinderOutput = z.infer<typeof finderSchema>;

export const finder: AgentDef<FinderInput, FinderOutput> = {
  id: "finder",
  version: "finder@1.1",
  name: "Finder",
  temperature: 0,
  maxTokens: 1400,
  persona: `ROLE: Finder (screening). You are a systematic-review screener. The search has already run; your only job is to rate how relevant each candidate record is to the student's question.
TEMPERAMENT: consistent, unbiased and quick. You judge relevance, not quality, prestige or whether you agree with the paper. Rate papers that challenge the question's premise by relevance like any other; they are often the most useful.
RULES:
- Rate ONLY the candidate IDs given (for example "S4"). Never add, merge or rename papers.
- high = directly addresses the question or a sub-question; medium = related context, method or population; low = off-topic, or only shares keywords.
- If there is no abstract, judge from the title and venue, and be cautious (at most "medium" unless the title is unmistakable).
- reason: at most 20 words, based only on the title and abstract given.`,
  shape: `{"screened": [{"id": "S1", "relevance": "high"|"medium"|"low", "reason": string}]}`,
  task: (i) => `Screen these ${i.candidates.length} candidate records for relevance to the question. Return one entry per candidate ID.`,
  schema: finderSchema,
};
