import { partial_ratio } from "fuzzball";
import type { ClaimLabel, CodeCheck, JudgeResult, JudgeVerdict, Passage, SummarySentence } from "@/shared/types";

/**
 * Lock 2 — the claim check. Code runs first (exact, explainable); the Judge
 * adds one of four fixed verdicts; the sentence takes its weakest result.
 */

function n(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[“”"’‘'`]/g, "")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Quote must appear in the passage (≥95% fuzzy, to forgive curly quotes and spacing). */
export function quoteInPassage(quote: string, passage: string): boolean {
  const q = n(quote);
  const p = n(passage);
  if (!q) return false;
  if (p.includes(q)) return true;
  return q.length >= 12 && partial_ratio(q, p) >= 95;
}

const WORD_NUMBERS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twelve: "12", twenty: "20", hundred: "100", half: "50%" };

/** Numbers stated in a sentence (years and passage IDs excluded). */
export function numbersIn(text: string): string[] {
  const cleaned = text.replace(/\b[PS]\d{1,3}\b/g, " ");
  const out: string[] = [];
  for (const m of cleaned.matchAll(/(?<![\w.])(\d+(?:[.,]\d+)?)\s?(%|percent|per cent)?/gi)) {
    const value = m[1].replace(",", ".");
    const num = Number(value);
    if (Number.isInteger(num) && num >= 1800 && num <= 2100) continue; // years handled separately
    if (num === 0 || num === 1 || num === 2) continue; // too common to be meaningful ("one study", "two groups")
    out.push(m[2] ? `${value}%` : value);
  }
  return out;
}

export function yearsIn(text: string): string[] {
  return [...text.matchAll(/\b(1[89]\d\d|20\d\d)\b/g)].map((m) => m[1]);
}

function numberInPassages(num: string, passages: string[]): boolean {
  const bare = num.replace("%", "");
  const variants = [bare, bare.replace(".", ","), bare.replace(/\.0+$/, "")];
  const words = Object.entries(WORD_NUMBERS)
    .filter(([, v]) => v === num || v === bare)
    .map(([w]) => w);
  return passages.some((p) => {
    const t = n(p);
    return variants.some((v) => new RegExp(`(?<![\\d.])${v.replace(".", "\\.")}(?![\\d])`).test(t)) || words.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  });
}

export interface SourceMeta {
  id: string;
  year: number | null;
  families: string[];
}

export function codeChecks(
  s: { text: string; kind: "sourced" | "reasoning"; citations: string[]; quote?: { passageId: string; text: string } | null },
  passages: Map<string, Passage>,
  sources: SourceMeta[],
  droppedIds: string[] = [],
): CodeCheck[] {
  const checks: CodeCheck[] = [];
  if (s.kind === "reasoning") {
    const nums = numbersIn(s.text);
    const yrs = yearsIn(s.text);
    checks.push(
      nums.length || yrs.length
        ? { kind: "numbers", outcome: "fail", detail: `AI reasoning may not introduce facts, but it states ${[...nums, ...yrs].join(", ")}.` }
        : { kind: "numbers", outcome: "pass", detail: "No new numbers or years in the reasoning." },
    );
    return checks;
  }

  const cited = s.citations.map((id) => passages.get(id)).filter((p): p is Passage => Boolean(p));
  if (!cited.length) {
    checks.push({ kind: "citation-ids", outcome: "fail", detail: droppedIds.length ? `Cited passage IDs that do not exist (${droppedIds.join(", ")}).` : "A sourced sentence must cite at least one passage." });
    return checks;
  }
  checks.push({
    kind: "citation-ids",
    outcome: droppedIds.length ? "fail" : "pass",
    detail: droppedIds.length ? `Removed unknown IDs ${droppedIds.join(", ")}; kept ${s.citations.join(", ")}.` : `Cites ${s.citations.join(", ")}, all real passages.`,
  });
  const texts = cited.map((p) => p.text);

  if (s.quote?.text) {
    const target = passages.get(s.quote.passageId);
    const ok = Boolean(target && quoteInPassage(s.quote.text, target.text));
    checks.push({ kind: "quote", outcome: ok ? "pass" : "fail", detail: ok ? `Quote found word for word in ${s.quote.passageId}.` : `The quote is not in ${s.quote.passageId}.` });
  }

  const nums = numbersIn(s.text);
  if (nums.length) {
    const missing = nums.filter((x) => !numberInPassages(x, texts));
    checks.push({ kind: "numbers", outcome: missing.length ? "fail" : "pass", detail: missing.length ? `${missing.join(", ")} not found in the cited passage.` : `${nums.join(", ")} found in the cited passage.` });
  }

  const yrs = yearsIn(s.text);
  if (yrs.length) {
    const citedSourceYears = new Set(cited.map((p) => String(sources.find((x) => x.id === p.sourceId)?.year ?? "")));
    const missing = yrs.filter((y) => !texts.some((t) => t.includes(y)) && !citedSourceYears.has(y));
    checks.push({ kind: "years", outcome: missing.length ? "fail" : "pass", detail: missing.length ? `Year ${missing.join(", ")} is not in the cited source.` : `Year ${yrs.join(", ")} matches the cited source.` });
  }

  // Similarity guard: close copying without quotation marks is a plagiarism risk.
  const unquoted = s.text.replace(/[“"][^”"]*[”"]/g, " ");
  const run = Math.max(0, ...texts.map((t) => longestSharedRun(unquoted, t)));
  checks.push(
    run >= SIMILARITY_RUN
      ? { kind: "similarity", outcome: "fail", detail: `${run} words in a row are copied from the source without quotation marks. Paraphrase it or quote it.` }
      : { kind: "similarity", outcome: "pass", detail: "Written in its own words (no long copied run without quotation marks)." },
  );

  // Names: if the sentence names an author of one of our sources, that source must be cited.
  const citedSources = new Set(cited.map((p) => p.sourceId));
  const words = new Set(n(s.text).split(/[^a-z-]+/));
  const misattributed = sources.filter((src) => !citedSources.has(src.id) && src.families.some((f) => f.length > 3 && words.has(n(f))));
  if (misattributed.length) {
    checks.push({ kind: "names", outcome: "fail", detail: "Names an author whose paper is not cited in this sentence." });
  }
  return checks;
}

/** Longest run of consecutive words shared by a sentence and a passage (case/punctuation-insensitive). */
export function longestSharedRun(sentence: string, passage: string): number {
  const w = (t: string) => n(t).replace(/[^a-z0-9%\s-]/g, " ").split(/\s+/).filter(Boolean);
  const a = w(sentence);
  const b = w(passage);
  if (!a.length || !b.length) return 0;
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

/** Similarity guard: 8+ consecutive source words without quotation marks is copying, not paraphrase. */
export const SIMILARITY_RUN = 8;

/**
 * The honest fix for copied wording: put it in quotation marks.
 *
 * Finds the longest run of words the sentence shares with one of its cited
 * passages and, when it is long enough to count as copying, wraps exactly
 * those words in quotation marks. The words are in the passage by
 * construction, so the result is a true quotation. Returns null when nothing
 * needs quoting.
 */
export function quoteCopiedRun(sentence: string, passages: { id: string; text: string }[]): { text: string; passageId: string; quoted: string } | null {
  const key = (t: string) => n(t).replace(/[^a-z0-9%-]/g, "");
  // Words of the sentence with their positions; text already inside quotation marks is left alone.
  const tokens: { word: string; start: number; end: number }[] = [];
  const quotedSpans = [...sentence.matchAll(/[“"][^”"]*[”"]/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
  for (const m of sentence.matchAll(/\S+/g)) {
    const start = m.index ?? 0;
    if (quotedSpans.some(([a, b]) => start >= a && start < b)) {
      tokens.push({ word: "\u0000", start, end: start + m[0].length }); // a break: runs never cross an existing quotation
      continue;
    }
    const word = key(m[0]);
    if (word) tokens.push({ word, start, end: start + m[0].length });
  }
  let best = { len: 0, endToken: -1, passageId: "" };
  for (const p of passages) {
    const b = n(p.text).replace(/[^a-z0-9%\s-]/g, " ").split(/\s+/).filter(Boolean);
    if (!b.length) continue;
    const prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= tokens.length; i++) {
      let diag = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = tokens[i - 1].word === b[j - 1] ? diag + 1 : 0;
        if (prev[j] > best.len) best = { len: prev[j], endToken: i - 1, passageId: p.id };
        diag = tmp;
      }
    }
  }
  if (best.len < SIMILARITY_RUN) return null;
  const start = tokens[best.endToken - best.len + 1].start;
  let end = tokens[best.endToken].end;
  // Leave sentence punctuation outside the quotation marks.
  while (end > start && /[.,;:!?)\]]/.test(sentence[end - 1])) end--;
  const quoted = sentence.slice(start, end);
  return { text: `${sentence.slice(0, start)}“${quoted}”${sentence.slice(end)}`, passageId: best.passageId, quoted };
}

/** Applies quoteCopiedRun until no long copied run is left (a sentence can copy from two places). */
export function quoteAllCopiedRuns(sentence: string, passages: { id: string; text: string }[]): { text: string; added: number; first: { passageId: string; text: string } | null } {
  let text = sentence;
  let added = 0;
  let first: { passageId: string; text: string } | null = null;
  for (let i = 0; i < 3; i++) {
    const q = quoteCopiedRun(text, passages);
    if (!q) break;
    text = q.text;
    added++;
    first ??= { passageId: q.passageId, text: q.quoted };
  }
  return { text, added, first };
}

export function evidenceVerified(evidence: string, passage: string): boolean {
  if (!evidence.trim()) return false;
  return quoteInPassage(evidence, passage);
}

const RANK: Record<JudgeVerdict, number> = { opposite: 0, says_nothing: 1, partly: 2, supports: 3 };

export interface LabelDecision {
  label: ClaimLabel;
  why: string;
  /** Needs the repair loop: proven problem or unsupported. */
  failed: boolean;
  problem?: string;
}

/** Combines code checks and Judge verdicts into one label (the weakest result wins). */
export function decideLabel(s: { kind: "sourced" | "reasoning" }, checks: CodeCheck[], judge: JudgeResult[] | null): LabelDecision {
  const failedCheck = checks.find((c) => c.outcome === "fail");
  if (s.kind === "reasoning") {
    if (failedCheck) return { label: "reasoning", why: failedCheck.detail, failed: true, problem: failedCheck.detail };
    return { label: "reasoning", why: "Knowlix's own connecting reasoning. No source is cited, and none should be.", failed: false };
  }
  if (failedCheck) return { label: "reported", why: failedCheck.detail, failed: true, problem: failedCheck.detail };
  if (!judge || !judge.length) {
    return { label: "reported", why: "The cited source is real and code checks passed, but the Judge did not review this sentence.", failed: false };
  }
  const best = [...judge].sort((a, b) => RANK[b.verdict] - RANK[a.verdict])[0];
  if (judge.some((j) => j.verdict === "opposite")) {
    const opp = judge.find((j) => j.verdict === "opposite")!;
    return { label: "reported", why: `${opp.passageId} says the opposite: ${opp.reason}`, failed: true, problem: `The cited passage ${opp.passageId} says the opposite.` };
  }
  if (best.verdict === "supports" && best.evidenceVerified) {
    return { label: "verified", why: `${best.passageId} supports it: “${best.evidence.slice(0, 160)}${best.evidence.length > 160 ? "…" : ""}”`, failed: false };
  }
  if (best.verdict === "supports" || best.verdict === "partly") {
    return {
      label: "reported",
      why: best.verdict === "partly" ? `${best.passageId} only partly supports it: ${best.reason}` : `The Judge said it supports it, but its evidence quote could not be found in ${best.passageId}.`,
      failed: false,
    };
  }
  return { label: "reported", why: `None of the cited passages address this claim. ${best.reason}`, failed: true, problem: "The cited passages say nothing about this claim." };
}

export function sentenceStats(sentences: SummarySentence[], gaps: string[], removed: number) {
  return {
    verified: sentences.filter((s) => s.label === "verified").length,
    reported: sentences.filter((s) => s.label === "reported").length,
    reasoning: sentences.filter((s) => s.label === "reasoning").length,
    notFound: gaps.length,
    repaired: sentences.filter((s) => s.repaired).length,
    removed,
  };
}
