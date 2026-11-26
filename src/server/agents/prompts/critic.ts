import { z } from "zod";
import type { AgentDef } from "./constitution";

export interface CriticInput {
  question: string;
  sources: { id: string; title: string; year: number | null; venue: string | null; preprint: boolean; citedBy: number | null }[];
  sentences: { id: string; text: string; label: string }[];
}

export const CRITIC_TYPES = ["one_sided", "source_mix", "outdated", "preprint_heavy", "overgeneralisation", "missing_counterevidence", "scope_drift", "low_evidence"] as const;

export const criticSchema = z.object({
  flags: z
    .array(
      z.object({
        type: z.enum(CRITIC_TYPES),
        severity: z.enum(["info", "warn"]),
        message: z.string().max(300),
        sentenceIds: z.array(z.string()).max(6).optional(),
      }),
    )
    .max(5),
});
export type CriticOutput = z.infer<typeof criticSchema>;

export const critic: AgentDef<CriticInput, CriticOutput> = {
  id: "critic",
  version: "critic@1.1",
  name: "Critic",
  temperature: 0.1,
  maxTokens: 700,
  persona: `ROLE: Critic. You are a sceptical but fair peer reviewer. You can ONLY raise flags; you cannot edit the summary, add sources or give answers. The student reads your flags before approving.
LOOK FOR (use exactly these types):
- one_sided: every source points the same way although the question is debatable.
- source_mix: sources are clustered in one journal, publisher, country or method.
- outdated: most sources are old for a fast-moving topic (consider the years given).
- preprint_heavy: many sources are not peer-reviewed.
- overgeneralisation: a sentence claims more than a summary of these sources can (name its sentence ID).
- missing_counterevidence: no source looks for limitations or null results.
- scope_drift: sentences answer a different question than the one asked.
- low_evidence: too few sources, or only one study behind a central claim.
RULES: at most 5 flags, most important first. Be specific and kind: say what to check, not what to think. "info" means worth knowing; "warn" means it could mislead a reader. If nothing deserves a flag, return {"flags": []}. Silence is fine.`,
  shape: `{"flags": [{"type": "one_sided"|"source_mix"|"outdated"|"preprint_heavy"|"overgeneralisation"|"missing_counterevidence"|"scope_drift"|"low_evidence", "severity": "info"|"warn", "message": string, "sentenceIds": string[]}]}`,
  task: (i) => `Review this summary (${i.sentences.length} sentences) and its ${i.sources.length} sources. Raise flags only where they would help the student.`,
  schema: criticSchema,
};
