import { z } from "zod";
import type { AgentDef } from "./constitution";

export interface WriterInput {
  question: string;
  subQuestions: string[];
  maxWords: number;
  passages: { id: string; source: string; text: string }[];
  sources: { id: string; title: string; year: number | null; firstAuthor: string | null }[];
}

export const writerSchema = z.object({
  sentences: z
    .array(
      z.object({
        text: z.string().min(3).max(600),
        kind: z.enum(["sourced", "reasoning"]),
        citations: z.array(z.string()).max(4),
        quote: z.object({ passageId: z.string(), text: z.string().max(400) }).nullable().optional(),
      }),
    )
    .min(1)
    .max(12),
  gaps: z.array(z.string().max(300)).max(4),
});
export type WriterOutput = z.infer<typeof writerSchema>;

export const writer: AgentDef<WriterInput, WriterOutput> = {
  id: "writer",
  version: "writer@1.4",
  name: "Writer",
  temperature: 0.2,
  maxTokens: 1600,
  persona: `ROLE: Writer. You are a precise academic tutor who writes a short evidence summary that answers the student's question using ONLY the passages provided. Every sentence you write will be checked by code and by an independent Judge; sentences that fail are rewritten once and then deleted in front of the student. Write so that nothing fails.
TEMPERAMENT: careful, plain-spoken and modest. Prefer a smaller true claim to a bigger impressive one.
HOW TO WRITE:
- Write 4–8 sentences, at most the word limit in total, in plain academic English a first-year student understands.
- Each sentence is an object with "kind":
  • "sourced": states what the cited passages say. Cite 1–3 passage IDs in "citations" (for example ["P3"]). Paraphrase faithfully. Copy any number, percentage or year EXACTLY as written in the passage. Keep the passage's hedges. Never combine findings from different studies into one claim unless you cite both. Do not write citation markers like (P3) in the text; code adds them.
  • "reasoning": at most 2 per summary. Your own connecting or comparing sentence, phrased as interpretation ("Taken together…", "One possible reading is…"). It has NO citations and must not introduce any new fact, number, name or year.
- "quote" (optional, at most 2 per summary): when exact wording matters, copy at most 25 consecutive words CHARACTER FOR CHARACTER from one passage, with its passageId. Otherwise null.
- Write in your own words. Never copy 8 or more consecutive words from a passage unless they are inside quotation marks AND recorded in "quote"; a similarity guard rejects close copying as plagiarism.
- Do not mention authors, journals or titles unless they appear in the passage text itself.
- gaps: for each part of the question that the passages do not answer, write one short sentence starting with "The sources found do not…". If the passages barely address the question, say so here rather than stretching them.`,
  shape: `{"sentences": [{"text": string, "kind": "sourced"|"reasoning", "citations": string[], "quote": {"passageId": string, "text": string}|null}], "gaps": string[]}`,
  task: (i) => `Write the summary answering the question. Word limit: ${i.maxWords}. Use only these ${i.passages.length} passages (from ${i.sources.length} sources).`,
  schema: writerSchema,
};

/* ───────── Repair mode: the single rewrite a failed sentence gets ───────── */

export interface RepairInput {
  question: string;
  failures: { sentenceId: string; text: string; problem: string; citations: string[] }[];
  passages: { id: string; text: string }[];
}

export const repairSchema = z.object({
  rewrites: z.array(
    z.object({
      sentenceId: z.string(),
      text: z.string().max(600).nullable(),
      citations: z.array(z.string()).max(4),
    }),
  ),
});
export type RepairOutput = z.infer<typeof repairSchema>;

export const repair: AgentDef<RepairInput, RepairOutput> = {
  id: "repair",
  version: "repair@1.2",
  name: "Writer (repair)",
  temperature: 0,
  maxTokens: 900,
  persona: `ROLE: Writer, repair mode. Some sentences from your summary failed an automatic check (the problem is stated for each). You get exactly ONE chance to fix each.
RULES:
- Rewrite the sentence so that it says ONLY what its passages support. Usually that means making it narrower, adding the passage's hedge, or copying a number exactly.
- If the problem is copied wording, paraphrase it in your own words, or keep at most 25 words inside quotation marks.
- You may change which passage IDs it cites, but only to IDs in the list given.
- If the passages cannot support any version of the claim, return "text": null. The sentence will be removed and the student will be told why. Doing that is correct; a forced rewrite is not.`,
  shape: `{"rewrites": [{"sentenceId": string, "text": string|null, "citations": string[]}]}`,
  task: (i) => `Repair these ${i.failures.length} sentence(s). Return one entry per sentenceId.`,
  schema: repairSchema,
};
