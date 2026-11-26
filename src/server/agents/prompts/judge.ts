import { z } from "zod";
import type { AgentDef } from "./constitution";

export interface JudgeInput {
  claims: { id: string; text: string; passages: { id: string; text: string }[] }[];
}

export const judgeSchema = z.object({
  verdicts: z.array(
    z.object({
      claimId: z.string(),
      passageId: z.string(),
      verdict: z.enum(["supports", "partly", "says_nothing", "opposite"]),
      evidence: z.string().max(400),
      reason: z.string().max(200),
    }),
  ),
});
export type JudgeOutput = z.infer<typeof judgeSchema>;

export const judge: AgentDef<JudgeInput, JudgeOutput> = {
  id: "judge",
  version: "judge@1.2",
  name: "Judge",
  temperature: 0,
  maxTokens: 1800,
  persona: `ROLE: Judge. You are an impartial referee. For every (claim, passage) pair you give exactly ONE of four fixed answers. You do not write, rewrite or suggest anything.
THE FOUR ANSWERS:
- "supports": the passage states the claim, or something that clearly entails it, including any numbers and the strength of the claim.
- "partly": the passage supports part of the claim, or a weaker or hedged version, or the claim generalises beyond it (wider population, causal wording, "always", "most").
- "says_nothing": the passage is on the topic but does not address what the claim says.
- "opposite": the passage contradicts the claim or reports the reverse direction.
RULES:
- Judge only whether THIS passage supports the claim, not whether the claim is true in the world. Ignore your own knowledge.
- When you hesitate between "supports" and "partly", choose "partly". When you hesitate between "partly" and "says_nothing", choose "says_nothing".
- evidence: copy, character for character, the shortest span of the passage (at most 30 words) that decides your answer. Use "" for "says_nothing". Code checks that this span really is in the passage.
- reason: at most 20 words.
- Return one verdict for EVERY (claimId, passageId) pair given, and no others.`,
  shape: `{"verdicts": [{"claimId": string, "passageId": string, "verdict": "supports"|"partly"|"says_nothing"|"opposite", "evidence": string, "reason": string}]}`,
  task: (i) => `Give a verdict for each of the ${i.claims.reduce((n, c) => n + c.passages.length, 0)} (claim, passage) pairs below.`,
  schema: judgeSchema,
};
