import type { CriticFlag, Passage, SourceCandidate, SummarySentence } from "@/shared/types";
import type { PlannerOutput } from "../agents/prompts/planner";
import { bm25Rank, coverage, keywords } from "./text";
import { isPreprintDoi } from "@/shared/identifiers";

/**
 * No-AI mode. When no AI key is configured (or a course forbids AI writing),
 * every agent role has a deterministic stand-in. Nothing here is "sample"
 * output: plans come from the question's keywords, summaries are exact
 * quotes, and the student is told which mode produced what.
 */

export function extractivePlan(question: string, minYear: number | null): PlannerOutput {
  const kw = keywords(question, 6);
  const core = kw.slice(0, 5).join(" ") || question.slice(0, 80);
  const short = kw.slice(0, 3).join(" ") || core;
  return {
    restatedQuestion: question.trim().replace(/\s+/g, " "),
    subQuestions: [`What does the research say about ${short}?`, `What are the limitations or mixed findings on ${short}?`],
    keyConcepts: kw.slice(0, 6),
    include: ["Scholarly records with a DOI"],
    exclude: [],
    queries: [
      { text: core, purpose: "Main search on the question's key terms", fromYear: minYear, toYear: null },
      { text: `${short} meta-analysis`, purpose: "Find reviews and meta-analyses that summarise the field", fromYear: minYear, toYear: null },
      { text: `${short} limitations`, purpose: "Look for limitations and counter-evidence", fromYear: minYear, toYear: null },
    ],
    assumptions: ["Keyword plan (no AI). Edit the searches if they miss your meaning."],
    integrityNote: null,
  };
}

export function screenByRelevance(question: string, candidates: SourceCandidate[]): Map<string, { relevance: "high" | "medium" | "low"; reason: string }> {
  const text = (c: SourceCandidate) => `${c.csl.title ?? ""} ${c.csl.title ?? ""} ${c.csl.abstract ?? ""}`;
  const ranked = bm25Rank(question, candidates.map((c) => ({ id: c.id, text: text(c) })));
  const top = ranked[0]?.score || 1;
  const out = new Map<string, { relevance: "high" | "medium" | "low"; reason: string }>();
  for (const r of ranked) {
    const c = candidates.find((x) => x.id === r.id)!;
    const cov = coverage(question, text(c));
    const rel = cov >= 0.6 && r.score >= top * 0.45 ? "high" : cov >= 0.4 && r.score >= top * 0.2 ? "medium" : "low";
    const pct = Math.round(cov * 100);
    out.set(r.id, { relevance: rel, reason: `${pct}% of the question's key terms appear in the title and abstract (keyword match, no AI).` });
  }
  return out;
}

/** Extractive summary: the most relevant passage from each source, quoted exactly. */
export function extractiveSummary(question: string, passages: Passage[], maxSentences = 6): SummarySentence[] {
  const ranked = bm25Rank(question, passages.map((p) => ({ id: p.id, text: p.text })));
  const usedSources = new Set<string>();
  const picked: Passage[] = [];
  // A quote must carry most of the question's key concepts, not just share a word with it.
  const onTopic = (t: string) => coverage(question, t) >= 0.5;
  const pool = ranked.filter((r) => onTopic(passages.find((x) => x.id === r.id)!.text));
  for (const r of pool.length >= 2 ? pool : ranked) {
    const p = passages.find((x) => x.id === r.id)!;
    if (usedSources.has(p.sourceId) || p.suspicious) continue;
    usedSources.add(p.sourceId);
    picked.push(p);
    if (picked.length >= maxSentences) break;
  }
  return picked.map((p, i) => ({
    id: `C${i + 1}`,
    text: `“${p.text}”`,
    kind: "sourced" as const,
    citations: [p.id],
    quote: { passageId: p.id, text: p.text },
    label: "verified" as const,
    why: `Exact quote from the source's abstract (${p.id}), chosen by keyword relevance. No AI was involved.`,
    checks: [{ kind: "quote" as const, outcome: "pass" as const, detail: `Copied word for word from ${p.id}.` }],
    judge: [],
  }));
}

/** Deterministic source-mix checks; always run, alongside (or instead of) the AI Critic. */
export function ruleCritic(sources: SourceCandidate[], currentYear: number): CriticFlag[] {
  const flags: CriticFlag[] = [];
  if (sources.length < 3) flags.push({ type: "low_evidence", severity: "warn", message: `Only ${sources.length} source${sources.length === 1 ? "" : "s"} chosen. Central claims rest on very little evidence.` });
  const preprints = sources.filter((s) => isPreprintDoi(s.csl.DOI) || s.csl.genre === "preprint").length;
  if (preprints && preprints / sources.length >= 0.4) flags.push({ type: "preprint_heavy", severity: "warn", message: `${preprints} of ${sources.length} sources are preprints (not peer reviewed).` });
  const years = sources.map((s) => Number(s.csl.issued?.["date-parts"]?.[0]?.[0])).filter((y) => Number.isFinite(y) && y > 1000);
  if (years.length && years.filter((y) => currentYear - y > 10).length / years.length > 0.6) flags.push({ type: "outdated", severity: "info", message: "Most sources are more than 10 years old. Check for newer work." });
  const venues = sources.map((s) => (s.csl["container-title"] as string | undefined)?.toLowerCase()).filter(Boolean) as string[];
  const top = venues.length ? Math.max(...Object.values(venues.reduce<Record<string, number>>((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {}))) : 0;
  if (sources.length >= 4 && top / sources.length >= 0.5) flags.push({ type: "source_mix", severity: "info", message: "Half or more of the sources come from the same journal." });
  return flags;
}
