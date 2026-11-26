/**
 * Policy settings — the course/supervisor rules Knowlix enforces.
 * Seam: day-of constraints ("no AI writing", "only papers after 2015",
 * "no preprints") become a preset or a field here, enforced server-side.
 */
import { z } from "zod";

export const CITATION_STYLES = {
  apa: "APA 7th edition",
  mla: "MLA 9th",
  harvard: "Harvard (Cite Them Right)",
  chicago: "Chicago author-date",
  ieee: "IEEE",
  vancouver: "Vancouver",
} as const;
export type CitationStyleId = keyof typeof CITATION_STYLES;
export const citationStyleIds = Object.keys(CITATION_STYLES) as [CitationStyleId, ...CitationStyleId[]];

export const policySchema = z.object({
  preset: z.enum(["standard", "strict", "exploratory", "custom"]),
  /** Strict courses can switch off AI-written sentences entirely: summaries become exact quotes. */
  aiWriting: z.boolean(),
  allowPreprints: z.boolean(),
  minYear: z.number().int().min(1800).max(2100).nullable(),
  allowOverrides: z.boolean(),
  maxSummaryWords: z.number().int().min(80).max(600),
  maxSources: z.number().int().min(3).max(20),
  defaultStyle: z.enum(citationStyleIds),
  /** Feature flags (seams for day-of changes). */
  features: z.object({
    critic: z.boolean(),
    repairLoop: z.boolean(),
    relatedPapers: z.boolean(),
  }),
});
export type Policy = z.infer<typeof policySchema>;

export const POLICY_PRESETS: Record<Exclude<Policy["preset"], "custom">, { name: string; description: string; policy: Policy }> = {
  standard: {
    name: "Standard",
    description: "AI may summarise; every sentence is labelled. Overrides need a reason.",
    policy: {
      preset: "standard",
      aiWriting: true,
      allowPreprints: true,
      minYear: null,
      allowOverrides: true,
      maxSummaryWords: 250,
      maxSources: 8,
      defaultStyle: "apa",
      features: { critic: true, repairLoop: true, relatedPapers: true },
    },
  },
  strict: {
    name: "Strict course",
    description: "No AI-written sentences, only exact quotes. No preprints. No overrides.",
    policy: {
      preset: "strict",
      aiWriting: false,
      allowPreprints: false,
      minYear: null,
      allowOverrides: false,
      maxSummaryWords: 200,
      maxSources: 8,
      defaultStyle: "apa",
      features: { critic: true, repairLoop: true, relatedPapers: true },
    },
  },
  exploratory: {
    name: "Exploratory",
    description: "Wider search and longer summaries for early-stage reading.",
    policy: {
      preset: "exploratory",
      aiWriting: true,
      allowPreprints: true,
      minYear: null,
      allowOverrides: true,
      maxSummaryWords: 400,
      maxSources: 12,
      defaultStyle: "apa",
      features: { critic: true, repairLoop: true, relatedPapers: true },
    },
  },
};

export const DEFAULT_POLICY: Policy = POLICY_PRESETS.standard.policy;

export function normalisePolicy(input: unknown): Policy {
  const parsed = policySchema.safeParse(input);
  if (parsed.success) return parsed.data;
  // Merge partial/legacy objects onto the default so old rows never break the app.
  const merged = { ...DEFAULT_POLICY, ...(typeof input === "object" && input ? input : {}) } as Policy;
  merged.features = { ...DEFAULT_POLICY.features, ...((merged.features as Policy["features"]) ?? {}) };
  const again = policySchema.safeParse(merged);
  return again.success ? again.data : DEFAULT_POLICY;
}
