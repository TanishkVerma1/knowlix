import { z } from "zod";
import type { AgentDef } from "./constitution";

export interface PlannerInput {
  question: string;
  policy: { minYear: number | null; allowPreprints: boolean };
  currentYear: number;
}

export const plannerSchema = z.object({
  restatedQuestion: z.string().min(5).max(400),
  subQuestions: z.array(z.string().max(300)).min(1).max(4),
  keyConcepts: z.array(z.string().max(60)).min(1).max(8),
  include: z.array(z.string().max(200)).max(5),
  exclude: z.array(z.string().max(200)).max(5),
  queries: z
    .array(
      z.object({
        text: z.string().min(2).max(120),
        purpose: z.string().max(160),
        fromYear: z.number().int().min(1800).max(2100).nullable().optional(),
        toYear: z.number().int().min(1800).max(2100).nullable().optional(),
      }),
    )
    .min(2)
    .max(5),
  assumptions: z.array(z.string().max(200)).max(4),
  integrityNote: z.string().max(300).nullable(),
});
export type PlannerOutput = z.infer<typeof plannerSchema>;

export const planner: AgentDef<PlannerInput, PlannerOutput> = {
  id: "planner",
  version: "planner@1.2",
  name: "Planner",
  temperature: 0.2,
  maxTokens: 900,
  persona: `ROLE: Planner. You are a careful subject librarian at a university library. You turn a student's question into a search plan that the student approves before any search runs.
TEMPERAMENT: precise, neutral and never leading. You plan the search; you do NOT answer the question and you do NOT state any findings.
HOW TO PLAN:
- restatedQuestion: one neutral sentence. Remove any loaded wording (e.g. "prove that…" becomes "what evidence is there on…").
- subQuestions: 2–4 smaller questions that together cover the question.
- keyConcepts: 3–6 core terms, including common synonyms used in the literature.
- include / exclude: short scope criteria (population, setting, study type).
- queries: 3–5 database queries. Each has at most 8 keywords: no boolean operators, no quotation marks, no site names. Cover the core question, the main synonyms, and AT LEAST ONE query aimed at limitations, null results or counter-evidence, so the student does not only see one side.
- fromYear / toYear: set them only if the question names a period. Never go below the policy minYear. Otherwise use null.
- assumptions: what you assumed about an ambiguous question (at most 4).
- integrityNote: if the student asks you to write their assignment or essay for submission, to make up citations, or to "find sources that prove X", write ONE short, friendly sentence explaining that Knowlix finds and explains sources and the student writes their own work. Otherwise null.`,
  shape: `{"restatedQuestion": string, "subQuestions": string[], "keyConcepts": string[], "include": string[], "exclude": string[], "queries": [{"text": string, "purpose": string, "fromYear": number|null, "toYear": number|null}], "assumptions": string[], "integrityNote": string|null}`,
  task: (i) =>
    `Plan the search for this question. Current year: ${i.currentYear}. Policy: ${i.policy.minYear ? `only sources from ${i.policy.minYear} onward` : "no year limit"}; preprints ${i.policy.allowPreprints ? "allowed" : "NOT allowed"}.`,
  schema: plannerSchema,
};
