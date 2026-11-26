import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import type { WorkspaceCtx } from "../auth/workspace";
import { getPolicy } from "../auth/workspace";
import { aiCalls, libraryItems, researchRuns } from "../db/schema";
import { ApiError } from "../http/api";
import { tryLog } from "../audit/activity";
import { aiAvailable, aiIsCompact } from "../agents/providers";
import { runAgent, AgentError, type AgentCtx } from "../agents/runtime";
import { planner } from "../agents/prompts/planner";
import { finder } from "../agents/prompts/finder";
import { writer, repair } from "../agents/prompts/writer";
import { judge } from "../agents/prompts/judge";
import { critic } from "../agents/prompts/critic";
import { cleanText, keepKnownIds, redactPersonal, scrubProse } from "../agents/guardrails";
import { adapters } from "../research/adapters";
import { buildPassages, fullTextPassages } from "../research/passages";
import { fetchFullText } from "../research/fulltext";
import { codeChecks, decideLabel, evidenceVerified, quoteAllCopiedRuns, sentenceStats, type SourceMeta } from "../research/claims";
import { extractivePlan, extractiveSummary, ruleCritic, screenByRelevance } from "../research/extractive";
import { bm25Rank } from "../research/text";
import { verifyReference } from "../verify/verify";
import { recordColumns } from "./records";
import { formatInText } from "../cite/citeproc";
import { formatMarkedList } from "../cite/marked";
import { exportMark } from "@/shared/labels";
import { cslYear, firstAuthorFamily } from "../scholarly/csl";
import { isPreprintDoi, normalizeDoi } from "@/shared/identifiers";
import { parseReference } from "../verify/parse";
import type { CitationStyleId, Policy } from "@/shared/policy";
import type {
  AgentEvent,
  CslItem,
  CriticFlag,
  JudgeResult,
  Passage,
  PlanQuery,
  RemovedSentence,
  ResearchPlan,
  RunState,
  SearchReport,
  SourceCandidate,
  SummaryDraft,
  SummarySentence,
} from "@/shared/types";

type RunRow = typeof researchRuns.$inferSelect;
type Send = (e: unknown) => void;

export interface RunDTO {
  id: string;
  question: string;
  state: RunState;
  mode: "ai" | "extractive";
  plan: ResearchPlan | null;
  planApprovedAt: string | null;
  searchReport: SearchReport | null;
  sources: SourceCandidate[];
  sourcesApprovedAt: string | null;
  draft: SummaryDraft | null;
  summaryApprovedAt: string | null;
  events: AgentEvent[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
  aiCalls: number;
}

function toDTO(r: RunRow, calls = 0): RunDTO {
  return {
    id: r.id,
    question: r.question,
    state: r.state as RunState,
    mode: r.mode as "ai" | "extractive",
    plan: r.plan ?? null,
    planApprovedAt: r.planApprovedAt?.toISOString() ?? null,
    searchReport: r.searchReport ?? null,
    sources: r.sources ?? [],
    sourcesApprovedAt: r.sourcesApprovedAt?.toISOString() ?? null,
    draft: r.draft ?? null,
    summaryApprovedAt: r.summaryApprovedAt?.toISOString() ?? null,
    events: r.events ?? [],
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    aiCalls: calls,
  };
}

async function loadRow(ctx: WorkspaceCtx, id: string): Promise<RunRow> {
  const [row] = await ctx.db.select().from(researchRuns).where(and(eq(researchRuns.id, id), eq(researchRuns.workspaceId, ctx.workspaceId))).limit(1);
  if (!row) throw new ApiError(404, "not-found", "That research run does not exist in your workspace.");
  return row;
}

function requireState(row: RunRow, ...allowed: RunState[]) {
  if (!allowed.includes(row.state as RunState)) {
    throw new ApiError(409, "wrong-step", `This step is not available yet. The run is at “${row.state.replace("_", " ")}”, and each checkpoint must be approved in order.`);
  }
}

function ev(agent: AgentEvent["agent"], message: string, tone: AgentEvent["tone"] = "info", extra: Pick<AgentEvent, "detail" | "by"> = {}): AgentEvent {
  return { at: new Date().toISOString(), agent, message, tone, ...extra };
}

async function save(ctx: WorkspaceCtx, id: string, patch: Partial<typeof researchRuns.$inferInsert>) {
  const [row] = await ctx.db.update(researchRuns).set({ ...patch, updatedAt: new Date() }).where(eq(researchRuns.id, id)).returning();
  return row;
}

export async function getRun(ctx: WorkspaceCtx, id: string): Promise<RunDTO> {
  const row = await loadRow(ctx, id);
  const calls = await ctx.db.select({ id: aiCalls.id }).from(aiCalls).where(eq(aiCalls.runId, id));
  return toDTO(row, calls.length);
}

export async function listRuns(ctx: WorkspaceCtx) {
  const rows = await ctx.db.select().from(researchRuns).where(eq(researchRuns.workspaceId, ctx.workspaceId)).orderBy(desc(researchRuns.createdAt)).limit(30);
  return rows.map((r) => ({
    id: r.id,
    question: r.question,
    state: r.state,
    mode: r.mode,
    createdAt: r.createdAt.toISOString(),
    stats: r.draft?.stats ?? null,
    sources: (r.sources ?? []).filter((s) => s.accepted).length,
  }));
}

export async function listAiCalls(ctx: WorkspaceCtx, runId: string) {
  await loadRow(ctx, runId);
  const rows = await ctx.db.select().from(aiCalls).where(and(eq(aiCalls.runId, runId), eq(aiCalls.workspaceId, ctx.workspaceId))).orderBy(asc(aiCalls.createdAt));
  return rows.map((c) => ({
    id: c.id,
    agent: c.agent,
    promptVersion: c.promptVersion,
    provider: c.provider,
    model: c.model,
    temperature: c.temperature / 100,
    sent: c.sent,
    received: c.received,
    latencyMs: c.latencyMs,
    ok: c.ok,
    error: c.error,
    createdAt: c.createdAt.toISOString(),
  }));
}

function agentCtx(ctx: WorkspaceCtx, runId: string, send?: Send): AgentCtx {
  return { db: ctx.db, workspaceId: ctx.workspaceId, runId, live: send ? (e) => send(e) : undefined };
}

/* ───────────────────────── Step 1: plan (checkpoint 1) ───────────────────────── */

export async function createRun(ctx: WorkspaceCtx, rawQuestion: string, opts: { defer?: boolean } = {}): Promise<RunDTO> {
  // Personal details are removed before the question is stored, so they never reach a search, an AI,
  // a receipt, a supervisor link or the library.
  const { text: question, redactions } = redactPersonal(cleanText(rawQuestion, 500));
  if (question.replace(/\[[a-z ]+ removed\]/gi, "").trim().length < 8) throw new ApiError(400, "too-short", "Write your question as a full sentence (at least a few words).");
  const policy = await getPolicy(ctx.db, ctx.workspaceId);
  const writingMode: "ai" | "extractive" = aiAvailable() && policy.aiWriting ? "ai" : "extractive";
  const events: AgentEvent[] = [ev("orchestrator", writingMode === "ai" ? "New run. AI agents are on; every sentence they write is checked." : "New run in no-AI mode: rules and exact quotes only.", "info", { by: "code" })];
  if (redactions) events.push(ev("orchestrator", `Removed ${redactions} personal detail${redactions > 1 ? "s" : ""} (email, phone number or ID) from your question before it was stored, searched or sent anywhere.`, "warn", { by: "code" }));
  const [row] = await ctx.db.insert(researchRuns).values({ workspaceId: ctx.workspaceId, question, state: "planning", mode: writingMode, events }).returning();
  // The page opens straight away and watches the Planner work; tests and scripts plan inline.
  if (opts.defer) return toDTO(row);
  await runPlan(ctx, row.id, () => {});
  return getRun(ctx, row.id);
}

/** Step 1 as a live stream: the Planner drafts the search plan while the student watches. */
export function runPlan(ctx: WorkspaceCtx, id: string, send: Send) {
  return exclusive(id, () => planStep(ctx, id, send));
}

async function planStep(ctx: WorkspaceCtx, id: string, send: Send) {
  const row = await loadRow(ctx, id);
  requireState(row, "planning");
  const question = row.question;
  const policy = await getPolicy(ctx.db, ctx.workspaceId);
  const events = [...(row.events ?? [])];
  const push = (e: AgentEvent) => {
    events.push(e);
    send({ type: "event", event: e });
  };

  // The stored question is already free of personal details; the placeholders are dropped before planning.
  const safeQuestion = redactPersonal(question).text;
  // A sentence that only introduced the student ("My email is …") says nothing about the topic: leave it out of the plan.
  const topical = question
    .split(/(?<=[.?!])\s+/)
    .filter((part) => !/\[[a-z ]+ removed\]/i.test(part))
    .join(" ")
    .trim();
  const planQuestion = topical.length >= 8 ? topical : question.replace(/\[[a-z ]+ removed\]/gi, " ").replace(/\s+/g, " ").trim();

  let out;
  if (aiAvailable()) {
    try {
      push(ev("planner", "Reading your question and drafting a search plan…", "info", { by: "ai" }));
      out = (await runAgent(planner, { question: safeQuestion, policy: { minYear: policy.minYear, allowPreprints: policy.allowPreprints }, currentYear: new Date().getFullYear() }, agentCtx(ctx, id, send))).output;
      push(ev("planner", `Plan ready: ${out.queries.length} searches, including one for counter-evidence.`, "ok", { by: "ai", detail: out.queries.map((q) => `“${cleanText(q.text, 120)}”: ${q.purpose}`) }));
    } catch (err) {
      out = extractivePlan(planQuestion, policy.minYear);
      push(ev("planner", `The AI Planner could not answer (${err instanceof AgentError && err.kind === "invalid-output" ? "its answer broke the required format twice" : "the AI service did not respond"}), so a keyword plan was built by rules instead.`, "warn", { by: "rules", detail: out.queries.map((q) => `“${q.text}”`) }));
    }
  } else {
    out = extractivePlan(planQuestion, policy.minYear);
    push(ev("planner", "No AI is connected, so a keyword plan was built by rules. Edit it freely.", "info", { by: "rules", detail: out.queries.map((q) => `“${q.text}”`) }));
  }

  const plan: ResearchPlan = {
    restatedQuestion: out.restatedQuestion,
    subQuestions: out.subQuestions,
    keyConcepts: out.keyConcepts,
    include: out.include,
    exclude: out.exclude,
    queries: out.queries.map((q, i) => ({
      id: `Q${i + 1}`,
      text: cleanText(q.text, 120),
      purpose: q.purpose,
      fromYear: policy.minYear ? Math.max(policy.minYear, q.fromYear ?? policy.minYear) : (q.fromYear ?? null),
      toYear: q.toYear ?? null,
      enabled: true,
    })),
    assumptions: out.assumptions,
    integrityNote: out.integrityNote,
    sources: adapters({ allowPreprints: policy.allowPreprints }).map((a) => a.label),
  };
  push(ev("orchestrator", "Checkpoint 1: nothing is searched until you approve or edit this plan.", "info", { by: "code" }));
  const saved = await save(ctx, id, { plan, state: "plan_review", events });
  await tryLog(ctx.db, ctx.workspaceId, { actor: "agent:planner", action: "research.planned", subjectType: "run", subjectId: id, summary: `Planned a search for “${question.slice(0, 100)}”.`, details: { queries: plan.queries.map((q) => q.text), mode: row.mode } });
  send({ type: "done", run: toDTO(saved) });
}

export async function updatePlan(ctx: WorkspaceCtx, id: string, queries: Pick<PlanQuery, "id" | "text" | "enabled" | "fromYear" | "toYear">[]) {
  const row = await loadRow(ctx, id);
  requireState(row, "plan_review");
  const policy = await getPolicy(ctx.db, ctx.workspaceId);
  const cleaned = queries
    .map((q, i) => ({
      id: q.id || `Q${i + 1}`,
      text: cleanText(q.text, 120),
      purpose: row.plan?.queries.find((p) => p.id === q.id)?.purpose ?? "Added by you",
      fromYear: policy.minYear ? Math.max(policy.minYear, q.fromYear ?? policy.minYear) : (q.fromYear ?? null),
      toYear: q.toYear ?? null,
      enabled: q.enabled,
    }))
    .map((q) => (q.fromYear && q.toYear && q.fromYear > q.toYear ? { ...q, fromYear: q.toYear, toYear: q.fromYear } : q))
    .filter((q) => q.text.length >= 2)
    .slice(0, 8);
  if (!cleaned.some((q) => q.enabled)) throw new ApiError(400, "no-queries", "Keep at least one search switched on.");
  const saved = await save(ctx, id, { plan: { ...row.plan!, queries: cleaned } });
  return toDTO(saved);
}

export async function approvePlan(ctx: WorkspaceCtx, id: string) {
  const row = await loadRow(ctx, id);
  requireState(row, "plan_review");
  const events = [...(row.events ?? []), ev("orchestrator", "You approved the plan (checkpoint 1). Searching now.", "ok", { by: "you" })];
  const saved = await save(ctx, id, { state: "searching", planApprovedAt: new Date(), events });
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "research.plan-approved", subjectType: "run", subjectId: id, summary: `Approved the search plan (${row.plan?.queries.filter((q) => q.enabled).length ?? 0} searches).` });
  return toDTO(saved);
}

/* ───────────────────────── Step 2: search + verify + screen (checkpoint 2) ───────────────────────── */

/** Runs that are being worked on right now, so a second tab or a double click cannot run the same step twice. */
const working = new Set<string>();

async function exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (working.has(id)) throw new ApiError(409, "busy", "This step is already running. It will appear here when it finishes.");
  working.add(id);
  try {
    return await fn();
  } finally {
    working.delete(id);
  }
}

/** Checks the checkpoint BEFORE a stream opens, so a skipped step is a clean 409, not a 200 with an error inside. */
export async function assertStep(ctx: WorkspaceCtx, id: string, step: "plan" | "search" | "write") {
  const row = await loadRow(ctx, id);
  requireState(row, step === "plan" ? "planning" : step === "search" ? "searching" : "writing");
  if (working.has(id)) throw new ApiError(409, "busy", "This step is already running. It will appear here when it finishes.");
}

const FULL_TEXT_SOURCE: Record<string, string> = { pmc: "PubMed Central", europepmc: "Europe PMC", arxiv: "arXiv" };

function dedupeKey(title: string | undefined, doi: string | undefined) {
  return doi ? `doi:${doi.toLowerCase()}` : `t:${(title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 80)}`;
}

export function runSearch(ctx: WorkspaceCtx, id: string, send: Send) {
  return exclusive(id, () => searchStep(ctx, id, send));
}

async function searchStep(ctx: WorkspaceCtx, id: string, send: Send) {
  const row = await loadRow(ctx, id);
  requireState(row, "searching");
  const policy = await getPolicy(ctx.db, ctx.workspaceId);
  const events = [...(row.events ?? [])];
  const push = (e: AgentEvent) => {
    events.push(e);
    send({ type: "event", event: e });
  };
  const report: SearchReport = { queries: [], totalFound: 0, afterDedupe: 0, verified: 0, dropped: [] };
  const queries = (row.plan?.queries ?? []).filter((q) => q.enabled);
  const found = new Map<string, SourceCandidate & { score: number }>();
  const titleSeen = new Map<string, string>();
  const dropped: Record<string, number> = {};
  const drop = (reason: string) => (dropped[reason] = (dropped[reason] ?? 0) + 1);

  for (const ad of adapters({ allowPreprints: policy.allowPreprints })) {
    if (!ad.available()) {
      push(ev("finder", `${ad.label} is resting (it is busy or its free limit was reached), so it was skipped.`, "warn", { by: "code" }));
      continue;
    }
    for (const q of queries) {
      const t = Date.now();
      push(ev("finder", `Searching ${ad.label}: “${q.text}”`, "info", { by: "code" }));
      try {
        const hits = await ad.search(q, { allowPreprints: policy.allowPreprints, rows: 8 });
        report.queries.push({ queryId: q.id, adapter: ad.label, text: q.text, results: hits.length, ms: Date.now() - t });
        report.totalFound += hits.length;
        for (const h of hits) {
          const key = dedupeKey(h.csl.title, h.csl.DOI);
          const titleKey = dedupeKey(h.csl.title, undefined);
          const existing = found.get(key) ?? found.get(titleSeen.get(titleKey) ?? "");
          if (existing) {
            existing.foundBy.push({ adapter: ad.id, queryId: q.id });
            if (!existing.csl.abstract && h.csl.abstract) existing.csl = { ...existing.csl, abstract: h.csl.abstract };
            // Keep what a later database knows that the first did not: the PubMed Central ID and a free copy.
            if (!existing.csl.PMCID && h.csl.PMCID) existing.csl = { ...existing.csl, PMCID: h.csl.PMCID };
            if (!existing.openAccessUrl && h.openAccessUrl) existing.openAccessUrl = h.openAccessUrl;
            continue;
          }
          if (!h.csl.DOI) {
            drop("No DOI to verify");
            continue;
          }
          const year = cslYear(h.csl);
          if (policy.minYear && year && year < policy.minYear) {
            drop(`Before ${policy.minYear} (policy)`);
            continue;
          }
          if (!policy.allowPreprints && (isPreprintDoi(h.csl.DOI) || h.csl.genre === "preprint")) {
            drop("Preprint (policy excludes them)");
            continue;
          }
          titleSeen.set(titleKey, key);
          found.set(key, { id: "", csl: h.csl, foundBy: [{ adapter: ad.id, queryId: q.id }], relevance: null, verification: null, accepted: null, openAccessUrl: h.openAccessUrl, citedByCount: h.citedByCount, abstractAvailable: Boolean(h.csl.abstract), score: 0 });
        }
      } catch (err) {
        report.queries.push({ queryId: q.id, adapter: ad.label, text: q.text, results: 0, ms: Date.now() - t, error: err instanceof Error ? err.message : "failed" });
        push(ev("finder", `${ad.label} did not answer for “${q.text}”.`, "warn", { by: "code" }));
      }
    }
  }
  report.afterDedupe = found.size;

  // Keep the 20 most relevant (keyword relevance) before the expensive checks.
  const pool = [...found.values()];
  const ranked = bm25Rank(row.question + " " + (row.plan?.keyConcepts ?? []).join(" "), pool.map((c, i) => ({ id: String(i), text: `${c.csl.title ?? ""} ${c.csl.abstract ?? ""}` })));
  const top = ranked.slice(0, 20).map((r) => pool[Number(r.id)]);
  if (pool.length > 20) drop("Lower keyword relevance (kept the top 20)");
  top.forEach((c, i) => (c.id = `S${i + 1}`));
  push(ev("finder", `${report.totalFound} results from ${new Set(report.queries.map((q) => q.adapter)).size} databases, ${report.afterDedupe} unique.`, "ok", {
    by: "code",
    // One line per database, not one per search: easier to read on a projector.
    detail: [...new Set(report.queries.map((q) => q.adapter))].map((name) => {
      const mine = report.queries.filter((q) => q.adapter === name);
      const answered = mine.filter((q) => !q.error);
      return answered.length ? `${name}: ${answered.reduce((n, q) => n + q.results, 0)} results from ${answered.length} search${answered.length === 1 ? "" : "es"}${answered.length < mine.length ? ` (${mine.length - answered.length} got no answer)` : ""}` : `${name}: no answer just now`;
    }),
  }));
  push(ev("verifier", `Checking the ${top.length} most relevant against doi.org, Crossref and OpenAlex. No AI is involved in this step.`, "info", { by: "code" }));

  // Lock 1 on every candidate.
  let cursor = 0;
  const verified: SourceCandidate[] = [];
  const worker = async () => {
    while (cursor < top.length) {
      const c = top[cursor++];
      const v = await verifyReference({ raw: c.csl.DOI!, format: "doi", authors: [], doi: c.csl.DOI });
      c.verification = v;
      if (v.status === "mismatch") {
        drop("Failed verification");
        continue;
      }
      if (v.record?.abstract && !c.csl.abstract) c.csl = { ...c.csl, abstract: v.record.abstract };
      c.abstractAvailable = Boolean(c.csl.abstract);
      verified.push(c);
      send({ type: "candidate", candidate: c });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  report.verified = verified.filter((c) => c.verification?.status === "verified").length;
  {
    const retracted = verified.filter((c) => c.verification?.flags.some((f) => f.code === "retracted")).length;
    const failed = top.length - verified.length;
    push(
      ev("verifier", `${report.verified} of ${top.length} candidates are verified real records.`, "ok", {
        by: "code",
        detail: [
          `${report.verified} verified: the DOI is registered and the record matches`,
          ...(verified.length - report.verified ? [`${verified.length - report.verified} need a look (for example retracted, or the databases disagree)`] : []),
          ...(retracted ? [`${retracted} retracted: shown, but never pre-selected`] : []),
          ...(failed ? [`${failed} failed the check and were dropped`] : []),
        ],
      }),
    );
  }

  // Screening: AI Finder if available, keyword relevance otherwise.
  let screened = screenByRelevance(row.question, verified);
  if (aiAvailable() && verified.length) {
    try {
      push(ev("finder", `Reading ${verified.length} titles and abstracts to judge how relevant each one is…`, "info", { by: "ai" }));
      // A small reading budget is shared out: the more candidates, the shorter each abstract.
      const abstractCut = aiIsCompact() ? Math.max(120, Math.min(320, Math.floor(11000 / verified.length))) : 700;
      const out = await runAgent(
        finder,
        { question: redactPersonal(row.question).text, candidates: verified.map((c) => ({ id: c.id, title: c.csl.title ?? "", year: cslYear(c.csl), venue: (c.csl["container-title"] as string) ?? null, abstract: c.csl.abstract ? c.csl.abstract.slice(0, abstractCut) : null })) },
        agentCtx(ctx, id, send),
      );
      const allowed = new Set(verified.map((c) => c.id));
      const ai = new Map<string, { relevance: "high" | "medium" | "low"; reason: string }>();
      for (const s of out.output.screened) if (allowed.has(s.id)) ai.set(s.id, { relevance: s.relevance, reason: s.reason });
      if (ai.size) screened = new Map([...screened, ...ai]);
      const tally = { high: 0, medium: 0, low: 0 };
      for (const v of ai.values()) tally[v.relevance]++;
      push(ev("finder", `Screened ${ai.size} candidates.`, "ok", { by: "ai", detail: [`${tally.high} highly relevant`, `${tally.medium} related`, `${tally.low} off-topic`] }));
    } catch {
      push(ev("finder", "The AI Finder could not answer, so relevance was scored by keyword overlap instead.", "warn", { by: "rules" }));
    }
  } else if (verified.length) {
    push(ev("finder", "Relevance scored by keyword overlap (no AI connected).", "info", { by: "rules" }));
  }
  const order = { high: 0, medium: 1, low: 2 } as const;
  for (const c of verified) {
    const s = screened.get(c.id);
    c.relevance = s?.relevance ?? "low";
    c.relevanceReason = s?.reason ?? null;
  }
  verified.sort((a, b) => order[a.relevance!] - order[b.relevance!] || Number(b.abstractAvailable) - Number(a.abstractAvailable) || (b.citedByCount ?? 0) - (a.citedByCount ?? 0));
  // Pre-select: relevant, verified, with an abstract, not retracted, up to the policy limit. The student decides.
  let picked = 0;
  for (const c of verified) {
    const ok = c.relevance !== "low" && c.verification?.status === "verified" && c.abstractAvailable && picked < Math.min(policy.maxSources, 6);
    c.accepted = ok ? true : false;
    if (ok) picked++;
  }
  report.dropped = Object.entries(dropped).map(([reason, count]) => ({ reason, count }));
  // Open-access full text: when a paper may be read in full, claims are later checked against the paper itself.
  const pre = verified.filter((c) => c.accepted);
  if (pre.length) {
    const got = await Promise.all(pre.map((c) => fetchFullText(c.csl, c.openAccessUrl).catch(() => null)));
    got.forEach((ft, i) => {
      if (ft) {
        pre[i].fullTextAvailable = true;
        pre[i].fullTextSource = FULL_TEXT_SOURCE[ft.source] ?? ft.source;
      }
    });
    const n = got.filter(Boolean).length;
    push(
      ev("finder", n ? `Free full text found for ${n} of the ${pre.length} pre-selected sources. Their claims can be checked against the paper itself.` : `None of the ${pre.length} pre-selected sources has free full text Knowlix can read, so their claims will be checked against the abstracts.`, n ? "ok" : "info", {
        by: "code",
        detail: pre.filter((c) => c.fullTextAvailable).map((c) => `${c.id} · ${(c.csl.title ?? "").slice(0, 90)} (${c.fullTextSource})`),
      }),
    );
  }
  push(ev("orchestrator", `Checkpoint 2: ${picked} sources pre-selected. Review, change and approve them.`, "info", { by: "code" }));
  const saved = await save(ctx, id, { state: "sources_review", searchReport: report, sources: verified, events });
  await tryLog(ctx.db, ctx.workspaceId, { actor: "agent:finder", action: "research.searched", subjectType: "run", subjectId: id, summary: `Found ${report.totalFound} results; ${verified.length} verified candidates shown for review.` });
  send({ type: "done", run: toDTO(saved) });
}

export async function chooseSources(ctx: WorkspaceCtx, id: string, acceptedIds: string[]) {
  const row = await loadRow(ctx, id);
  requireState(row, "sources_review");
  const policy = await getPolicy(ctx.db, ctx.workspaceId);
  const sources = (row.sources ?? []).map((s) => ({ ...s, accepted: acceptedIds.includes(s.id) }));
  const chosen = sources.filter((s) => s.accepted);
  if (!chosen.length) throw new ApiError(400, "none-chosen", "Choose at least one source to summarise.");
  if (chosen.length > policy.maxSources) throw new ApiError(400, "too-many", `Your policy allows at most ${policy.maxSources} sources per summary.`);
  if (chosen.some((s) => s.verification?.status === "mismatch")) throw new ApiError(409, "unverified", "A chosen source failed verification and cannot be used.");
  if (!chosen.some((s) => s.abstractAvailable)) throw new ApiError(409, "no-text", "None of the chosen sources has an abstract Knowlix can read, so nothing could be checked. Choose at least one with an abstract.");
  const events = [...(row.events ?? []), ev("orchestrator", `You approved ${chosen.length} source${chosen.length > 1 ? "s" : ""} (checkpoint 2).`, "ok", { by: "you" })];
  const saved = await save(ctx, id, { state: "writing", sources, sourcesApprovedAt: new Date(), events });
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "research.sources-approved", subjectType: "run", subjectId: id, summary: `Approved ${chosen.length} sources for the summary.`, details: { sources: chosen.map((c) => c.csl.DOI) } });
  return toDTO(saved);
}

/* ───────── Student upload: text extracted from a PDF in the browser; the file never reaches us ───────── */

export interface UploadInput {
  fileName: string;
  title: string;
  doi?: string | null;
  year?: number | null;
  authors?: string | null;
  passages: string[];
}

export async function addUploadedSource(ctx: WorkspaceCtx, id: string, input: UploadInput) {
  const row = await loadRow(ctx, id);
  requireState(row, "sources_review");
  const passages = input.passages.map((p) => cleanText(p, 900)).filter((p) => p.length > 30).slice(0, 40);
  if (!passages.length) throw new ApiError(422, "no-text", "No readable text was found in that PDF (it may be a scanned image).");
  const doi = normalizeDoi(input.doi ?? null);
  const raw = [input.authors, input.year ? `(${input.year}).` : "", input.title].filter(Boolean).join(" ");
  const parsed = doi
    ? { raw: doi, format: "doi" as const, authors: [], doi }
    : { ...parseReference(raw), title: cleanText(input.title, 300), year: input.year ?? undefined };
  const verification = await verifyReference(parsed);
  if (verification.provenWrong) {
    throw new ApiError(409, "proven-wrong", `The DOI found in this PDF did not check out: ${verification.reason} Remove it from the form and try again.`);
  }
  const policy = await getPolicy(ctx.db, ctx.workspaceId);
  if (!policy.allowPreprints && (isPreprintDoi(doi) || verification.flags.some((f) => f.code === "preprint"))) {
    throw new ApiError(403, "preprints-off", "Your course policy does not allow preprints, and this PDF is a preprint (not peer reviewed). It was not added.");
  }
  // Use the registry's record only when it really is this paper; otherwise keep what the student entered.
  const matched = verification.record && verification.record.title && (verification.status === "verified" || (doi !== null && !verification.provenWrong) || (verification.score ?? 0) >= 70);
  const base: CslItem = (matched ? verification.record : null) ?? {
    id: "upload",
    type: "article-journal",
    title: cleanText(input.title, 300),
    author: (input.authors ?? "")
      .split(/;|,| and /)
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((a) => ({ family: a.split(/\s+/).pop() ?? a, given: a.split(/\s+/).slice(0, -1).join(" ") || undefined })),
    issued: input.year ? { "date-parts": [[input.year]] } : undefined,
    DOI: doi ?? undefined,
  };
  const existing = row.sources ?? [];
  const n = existing.filter((s) => s.origin === "upload").length + 1;
  const candidate: SourceCandidate = {
    id: `U${n}`,
    csl: { ...base, abstract: passages.join(" ") },
    foundBy: [{ adapter: "upload", queryId: "upload" }],
    relevance: "high",
    relevanceReason: "Uploaded by you.",
    verification,
    accepted: true,
    abstractAvailable: true,
    origin: "upload",
    uploadName: input.fileName.slice(0, 120),
  };
  const chars = passages.reduce((t, p) => t + p.length, 0);
  const events = [...(row.events ?? []), ev("verifier", `You added “${input.fileName.slice(0, 60)}”. It was read in your browser; only ${passages.length} passages (${chars.toLocaleString()} characters) reached the server. ${verification.status === "verified" ? "Its record was verified." : "Its record could not be confirmed, so it is marked Please check."}`, verification.status === "verified" ? "ok" : "warn")];
  const saved = await save(ctx, id, { sources: [...existing, candidate], events });
  await tryLog(ctx.db, ctx.workspaceId, {
    actor: "student",
    action: "research.pdf-added",
    subjectType: "run",
    subjectId: id,
    summary: `Added a PDF as a source. Read in the browser; ${passages.length} passages (${chars.toLocaleString()} characters) were sent, never the file.`,
    details: { fileName: input.fileName.slice(0, 120), status: verification.status, doi },
  });
  return toDTO(saved);
}

/* ───────────────────────── Step 3: write + check + repair + critic (checkpoint 3) ───────────────────────── */

function sourceMeta(sources: SourceCandidate[]): SourceMeta[] {
  return sources.map((s) => ({ id: s.id, year: cslYear(s.csl), families: (s.csl.author ?? []).map((a) => a.family ?? "").filter(Boolean) }));
}

async function judgeSentences(ctx: AgentCtx, items: { id: string; text: string; citations: string[] }[], passages: Map<string, Passage>): Promise<Map<string, JudgeResult[]> | null> {
  const claims = items
    .filter((s) => s.citations.length)
    .map((s) => ({ id: s.id, text: s.text, passages: s.citations.map((pid) => ({ id: pid, text: passages.get(pid)!.text })) }));
  if (!claims.length) return new Map();
  const out = await runAgent(judge, { claims }, ctx);
  const map = new Map<string, JudgeResult[]>();
  for (const v of out.output.verdicts) {
    const claim = claims.find((c) => c.id === v.claimId);
    const passage = claim?.passages.find((p) => p.id === v.passageId);
    if (!claim || !passage) continue; // the Judge may only rule on pairs it was given
    const verified = v.verdict === "says_nothing" ? true : evidenceVerified(v.evidence, passage.text);
    const list = map.get(v.claimId) ?? [];
    if (!list.some((j) => j.passageId === v.passageId)) list.push({ passageId: v.passageId, verdict: v.verdict, evidence: v.evidence, reason: v.reason, evidenceVerified: verified });
    map.set(v.claimId, list);
  }
  return map;
}

export function runWrite(ctx: WorkspaceCtx, id: string, send: Send) {
  return exclusive(id, () => writeStep(ctx, id, send));
}

async function writeStep(ctx: WorkspaceCtx, id: string, send: Send) {
  const row = await loadRow(ctx, id);
  requireState(row, "writing");
  const policy: Policy = await getPolicy(ctx.db, ctx.workspaceId);
  const events = [...(row.events ?? [])];
  const push = (e: AgentEvent) => {
    events.push(e);
    send({ type: "event", event: e });
  };
  const chosen = (row.sources ?? []).filter((s) => s.accepted);
  let mode: "ai" | "extractive" = row.mode === "ai" && aiAvailable() && policy.aiWriting ? "ai" : "extractive";
  // A model on this computer reads slowly, and a free cloud allowance is small: both get a shorter reading list.
  const small = mode === "ai" && aiIsCompact();
  const passages = buildPassages(chosen, small ? 14 : 30);
  // Open-access full text adds passages from the paper itself, chosen for relevance to the question.
  const texts = await Promise.all(chosen.map((s) => (s.origin === "upload" || !s.csl.DOI ? null : fetchFullText(s.csl, s.openAccessUrl).catch(() => null))));
  let fullCount = 0;
  let fullSources = 0;
  texts.forEach((ft, i) => {
    const src = chosen[i];
    src.fullTextAvailable = src.origin === "upload" ? src.fullTextAvailable : Boolean(ft);
    if (!ft) return;
    src.fullTextSource = FULL_TEXT_SOURCE[ft.source] ?? ft.source;
    const extra = fullTextPassages(src.id, ft.text, row.question, small ? 3 : 6).filter((x) => !passages.some((p) => p.sourceId === src.id && p.text.slice(0, 80) === x.text.slice(0, 80)));
    if (extra.length) fullSources++;
    for (const x of extra) {
      passages.push({ ...x, id: `P${passages.length + 1}` });
      fullCount++;
    }
  });
  const pmap = new Map(passages.map((p) => [p.id, p]));
  const allowed = new Set(passages.map((p) => p.id));
  const meta = sourceMeta(chosen);
  const suspicious = passages.filter((p) => p.suspicious).length;
  push(
    ev("orchestrator", `Split ${chosen.length} sources into ${passages.length} numbered passages (P1–P${passages.length}). Only these passages may be cited.`, "info", {
      by: "code",
      detail: fullCount ? [`${passages.length - fullCount} from abstracts`, `${fullCount} from the open-access full text of ${fullSources} source${fullSources === 1 ? "" : "s"}`] : [`All ${passages.length} from abstracts or your own PDFs: no open-access full text was available`],
    }),
  );
  if (suspicious) push(ev("orchestrator", `${suspicious} passage${suspicious > 1 ? "s" : ""} contained text that looked like instructions to an AI. Treated as data and neutralised.`, "warn", { by: "code" }));

  const actx = agentCtx(ctx, id, send);
  let sentences: SummarySentence[] = [];
  const removed: RemovedSentence[] = [];
  let gaps: string[] = [];

  if (mode === "ai") {
    try {
      push(ev("writer", `Drafting a summary from ${passages.length} passages. It may cite passage numbers only, never a paper from memory…`, "info", { by: "ai" }));
      const out = await runAgent(
        writer,
        {
          question: redactPersonal(row.question).text,
          subQuestions: row.plan?.subQuestions ?? [],
          maxWords: policy.maxSummaryWords,
          passages: passages.map((p) => ({ id: p.id, source: p.sourceId, text: p.text })),
          sources: chosen.map((s) => ({ id: s.id, title: s.csl.title ?? "", year: cslYear(s.csl), firstAuthor: firstAuthorFamily(s.csl) })),
        },
        actx,
      );
      gaps = out.output.gaps.map((g) => cleanText(g, 300)).filter(Boolean);
      // A sentence that only says "the sources do not cover this" is an honest gap, not a claim: label it Not found.
      const isGap = (s: { text: string; citations: string[]; kind?: string }) => {
        if (s.kind === "reasoning") return false;
        // "The sources do not say…" as the whole point of the sentence, whether or not it cites anything.
        if (/^(the |these |those |none of the )?(available |cited |chosen |selected )?(sources?|passages?|studies|abstracts?|evidence)\b[^.]{0,50}\b(do(es)? not|did not|cannot|provides? no|offers? no|addresse?s?)\b/i.test(s.text.trim()) && /\b(not|no)\b/i.test(s.text)) return true;
        return !s.citations.length && /\b(sources?|passages?|studies|evidence|abstracts?)\b[^.]{0,60}\b(do(es)? not|did not|cannot|no |not |lack)/i.test(s.text);
      };
      const stated = out.output.sentences.filter(isGap).map((s) => cleanText(scrubProse(s.text), 300));
      gaps = [...new Set([...gaps, ...stated])].slice(0, 6);
      let dropTotal = 0;
      let quotedFor = 0;
      sentences = out.output.sentences.filter((s) => !isGap(s)).map((s, i) => {
        const { kept, dropped } = keepKnownIds(s.citations, allowed);
        dropTotal += dropped.length;
        let quote = s.quote && allowed.has(String(s.quote.passageId).toUpperCase()) ? { passageId: String(s.quote.passageId).toUpperCase(), text: s.quote.text } : null;
        const kind = s.kind === "reasoning" ? "reasoning" : "sourced";
        let text = scrubProse(s.text);
        // Wording copied from a cited passage is not thrown away: code puts it in quotation marks, which is what it is.
        if (kind === "sourced" && kept.length) {
          const fixed = quoteAllCopiedRuns(text, kept.map((id) => ({ id, text: pmap.get(id)?.text ?? "" })));
          if (fixed.added) {
            text = fixed.text;
            quote ??= fixed.first;
            quotedFor++;
          }
        }
        const checks = codeChecks({ text, kind, citations: kind === "reasoning" ? [] : kept, quote }, pmap, meta, dropped);
        return { id: `C${i + 1}`, text, kind, citations: kind === "reasoning" ? [] : kept, quote, label: "reported", why: "", checks, judge: [] } satisfies SummarySentence;
      });
      push(ev("writer", `Draft ready: ${sentences.length} sentences.${dropTotal ? ` Removed ${dropTotal} citation${dropTotal > 1 ? "s" : ""} to passages that do not exist.` : ""}`, dropTotal ? "warn" : "ok", { by: "ai", detail: sentences.slice(0, 8).map((s) => `${s.id} · ${s.text.slice(0, 110)}${s.text.length > 110 ? "…" : ""}`) }));
      if (quotedFor) push(ev("verifier", `${quotedFor} sentence${quotedFor > 1 ? "s" : ""} used the source's own wording, so code put those words in quotation marks.`, "info", { by: "code" }));
    } catch {
      push(ev("writer", "The AI Writer could not answer, so Knowlix switched to no-AI mode (exact quotes) for this summary.", "warn", { by: "rules" }));
      mode = "extractive";
    }
  }

  if (mode === "extractive") {
    sentences = extractiveSummary(row.question, passages, Math.min(6, Math.max(3, chosen.length)));
    push(ev("writer", `No-AI mode: quoted the most relevant passage from ${sentences.length} sources, word for word.`, "info", { by: "rules" }));
  } else {
    // Lock 2: code first, then the Judge, then the single repair attempt.
    {
      const kinds: Record<string, string> = { "citation-ids": "Passage numbers exist", quote: "Quotes are word for word", numbers: "Numbers appear in the passage", years: "Years appear in the passage", names: "Names appear in the source", similarity: "Not copied without quote marks" };
      const tally = new Map<string, { pass: number; fail: number }>();
      for (const s of sentences) {
        for (const c of s.checks) {
          if (c.outcome === "skip") continue;
          const t = tally.get(c.kind) ?? { pass: 0, fail: 0 };
          t[c.outcome === "pass" ? "pass" : "fail"]++;
          tally.set(c.kind, t);
        }
      }
      const fails = [...tally.values()].reduce((n, t) => n + t.fail, 0);
      push(
        ev("verifier", fails ? `Code checks done: ${fails} problem${fails > 1 ? "s" : ""} found in the draft.` : "Code checks done: every quote, number, year and name was found in the cited passage.", fails ? "warn" : "ok", {
          by: "code",
          detail: [...tally.entries()].map(([k, t]) => `${kinds[k] ?? k}: ${t.pass} passed${t.fail ? `, ${t.fail} failed` : ""}`),
        }),
      );
    }
    let judged: Map<string, JudgeResult[]> | null = null;
    try {
      push(ev("judge", "Comparing each sentence with the passage it cites. Only four answers are allowed…", "info", { by: "ai" }));
      judged = await judgeSentences(actx, sentences.filter((s) => s.kind === "sourced"), pmap);
      const words: Record<string, string> = { supports: "supports", partly: "partly supports", says_nothing: "says nothing about it", opposite: "says the opposite" };
      const lines: string[] = [];
      let unproven = 0;
      for (const [cid, list] of judged ?? []) {
        for (const j of list) {
          const shaky = j.verdict !== "says_nothing" && !j.evidenceVerified;
          lines.push(`${cid} vs ${j.passageId}: ${words[j.verdict]}${shaky ? " (its quoted evidence is not in the passage, so it does not count)" : ""}`);
          if (shaky) unproven++;
        }
      }
      push(ev("judge", `${lines.length} verdict${lines.length === 1 ? "" : "s"} in. Code re-checked that the evidence the Judge quoted is really in each passage${unproven ? `: ${unproven} was not` : ""}.`, unproven ? "warn" : "ok", { by: "ai", detail: lines.slice(0, 14) }));
    } catch {
      push(ev("judge", "The AI Judge could not answer: sentences that pass the code checks are labelled “Reported, not checked”.", "warn", { by: "rules" }));
    }
    const failures: { s: SummarySentence; problem: string }[] = [];
    for (const s of sentences) {
      s.judge = judged?.get(s.id) ?? [];
      const d = decideLabel(s, s.checks, judged ? s.judge : null);
      s.label = d.label;
      s.why = d.why;
      if (d.failed) failures.push({ s, problem: d.problem ?? d.why });
    }

    if (failures.length && policy.features.repairLoop) {
      push(ev("writer", `${failures.length} sentence${failures.length > 1 ? "s" : ""} failed a check. Each gets one rewrite, then it is removed.`, "warn", { by: "ai", detail: failures.slice(0, 8).map((f) => `${f.s.id}: ${f.problem}`) }));
      let rewrites = new Map<string, { text: string | null; citations: string[] }>();
      try {
        const out = await runAgent(
          repair,
          {
            question: redactPersonal(row.question).text,
            failures: failures.map((f) => ({ sentenceId: f.s.id, text: f.s.text, problem: f.problem, citations: f.s.citations })),
            passages: passages.map((p) => ({ id: p.id, text: p.text })),
          },
          actx,
        );
        rewrites = new Map(out.output.rewrites.map((r) => [r.sentenceId, { text: r.text, citations: r.citations }]));
      } catch {
        push(ev("writer", "The rewrite could not run, so the failed sentences are removed.", "warn", { by: "rules" }));
      }
      const retry: SummarySentence[] = [];
      for (const f of failures) {
        const rw = rewrites.get(f.s.id);
        if (!rw || !rw.text) {
          removed.push({ id: f.s.id, text: f.s.text, why: `${f.problem} It could not be fixed, so it was removed.`, citations: f.s.citations });
          f.s.text = "";
          continue;
        }
        const { kept, dropped } = keepKnownIds(rw.citations, allowed);
        f.s.originalText = f.s.text;
        f.s.citations = f.s.kind === "reasoning" ? [] : kept;
        const requoted = f.s.kind === "sourced" ? quoteAllCopiedRuns(scrubProse(rw.text), kept.map((pid) => ({ id: pid, text: pmap.get(pid)?.text ?? "" }))) : { text: scrubProse(rw.text), first: null };
        f.s.text = requoted.text;
        f.s.quote = requoted.first;
        f.s.repaired = true;
        f.s.checks = codeChecks({ text: f.s.text, kind: f.s.kind, citations: f.s.citations, quote: f.s.quote }, pmap, meta, dropped);
        retry.push(f.s);
      }
      let rejudged: Map<string, JudgeResult[]> | null = null;
      if (retry.some((s) => s.kind === "sourced")) {
        try {
          rejudged = await judgeSentences(actx, retry.filter((s) => s.kind === "sourced"), pmap);
        } catch {
          rejudged = null;
        }
      }
      for (const s of retry) {
        s.judge = rejudged?.get(s.id) ?? [];
        const d = decideLabel(s, s.checks, rejudged ? s.judge : null);
        if (d.failed) {
          removed.push({ id: s.id, text: s.originalText ?? s.text, why: `Rewritten once but still failed: ${d.problem ?? d.why} Removed.`, citations: s.citations });
          s.text = "";
        } else {
          s.label = d.label;
          s.why = `Rewritten once after a failed check. ${d.why}`;
        }
      }
      sentences = sentences.filter((s) => s.text);
      push(ev("writer", `Rewrite done: ${retry.length - removed.filter((r) => retry.some((s) => s.id === r.id)).length} fixed, ${removed.length} removed.`, removed.length ? "warn" : "ok", { by: "ai", detail: removed.slice(0, 6).map((r) => `Removed ${r.id}: ${r.why.slice(0, 120)}`) }));
    } else if (failures.length) {
      for (const f of failures) removed.push({ id: f.s.id, text: f.s.text, why: `${f.problem} Removed (repair is switched off by policy).`, citations: f.s.citations });
      sentences = sentences.filter((s) => !failures.some((f) => f.s.id === s.id));
    }
  }

  // Critic: rule-based checks always; the AI Critic adds judgement when available.
  let criticFlags: CriticFlag[] = ruleCritic(chosen, new Date().getFullYear());
  if (policy.features.critic && mode === "ai" && sentences.length) {
    try {
      push(ev("critic", "Looking for bias, gaps and overclaiming. It can raise flags but cannot change a word…", "info", { by: "ai" }));
      const out = await runAgent(
        critic,
        {
          question: redactPersonal(row.question).text,
          sources: chosen.map((s) => ({ id: s.id, title: s.csl.title ?? "", year: cslYear(s.csl), venue: (s.csl["container-title"] as string) ?? null, preprint: isPreprintDoi(s.csl.DOI) || s.csl.genre === "preprint", citedBy: s.citedByCount ?? null })),
          sentences: sentences.map((s) => ({ id: s.id, text: s.text, label: s.label })),
        },
        actx,
      );
      const ids = new Set(sentences.map((s) => s.id));
      // Flags that state a checkable fact are kept only when code agrees; the Critic's judgement calls pass through.
      const years = chosen.map((s) => cslYear(s.csl)).filter((y): y is number => typeof y === "number");
      const newest = years.length ? Math.max(...years) : null;
      const preprintShare = chosen.length ? chosen.filter((s) => isPreprintDoi(s.csl.DOI) || s.csl.genre === "preprint").length / chosen.length : 0;
      const holds = (type: string) => {
        if (type === "outdated") return newest !== null && new Date().getFullYear() - newest > 5;
        if (type === "preprint_heavy") return preprintShare >= 0.34;
        if (type === "low_evidence") return chosen.length < 3;
        return true;
      };
      const aiFlags = out.output.flags.filter((f) => holds(f.type)).map((f) => ({ ...f, message: cleanText(f.message, 300), sentenceIds: (f.sentenceIds ?? []).filter((x) => ids.has(x)) }));
      criticFlags = [...criticFlags, ...aiFlags.filter((f) => !criticFlags.some((c) => c.type === f.type))].slice(0, 6);
      push(ev("critic", aiFlags.length ? `Raised ${aiFlags.length} flag${aiFlags.length > 1 ? "s" : ""} for you to weigh.` : "Found nothing to flag.", "ok", { by: "ai", detail: aiFlags.map((f) => f.message) }));
    } catch {
      push(ev("critic", "The AI Critic could not answer; showing the rule-based checks only.", "warn", { by: "rules" }));
    }
  } else if (criticFlags.length) {
    push(ev("critic", `Rule-based review raised ${criticFlags.length} flag${criticFlags.length > 1 ? "s" : ""}.`, "info", { by: "rules", detail: criticFlags.map((f) => f.message) }));
  }
  {
    const st = sentenceStats(sentences, gaps, removed.length);
    push(ev("verifier", "Every sentence now carries its label.", "ok", { by: "code", detail: [`${st.verified} Verified`, `${st.reported} Reported, not checked`, `${st.reasoning} AI reasoning`, `${st.notFound} Not found`, `${st.removed} removed by the checks`] }));
  }

  const draft: SummaryDraft = {
    sentences,
    removed,
    gaps,
    critic: criticFlags,
    passages,
    mode,
    stats: sentenceStats(sentences, gaps, removed.length),
  };
  push(ev("orchestrator", "Checkpoint 3: read the labelled summary, then approve it or go back.", "info", { by: "code" }));
  const sourcesNow = (row.sources ?? []).map((s) => chosen.find((c) => c.id === s.id) ?? s);
  const saved = await save(ctx, id, { state: "summary_review", draft, mode, events, sources: sourcesNow });
  await tryLog(ctx.db, ctx.workspaceId, {
    actor: "agent:writer",
    action: "research.summary-drafted",
    subjectType: "run",
    subjectId: id,
    summary: `Summary drafted (${mode === "ai" ? "AI" : "no-AI quotes"}): ${draft.stats.verified} verified, ${draft.stats.reported} reported, ${draft.stats.reasoning} AI reasoning, ${draft.stats.notFound} not found, ${draft.stats.removed} removed by checks.`,
    details: draft.stats,
  });
  send({ type: "done", run: toDTO(saved) });
}

export async function reviewSentence(ctx: WorkspaceCtx, id: string, sentenceId: string, action: "override" | "remove" | "view", reason?: string) {
  const row = await loadRow(ctx, id);
  requireState(row, "summary_review");
  const policy = await getPolicy(ctx.db, ctx.workspaceId);
  const draft = row.draft!;
  let summary = "";
  if (action === "view") {
    // The student opened this sentence's evidence. Counted for the receipt; not worth a log line each.
    if (!draft.sentences.some((x) => x.id === sentenceId)) throw new ApiError(404, "not-found", "Sentence not found.");
    if (draft.viewed?.includes(sentenceId)) return toDTO(row);
    draft.viewed = [...(draft.viewed ?? []), sentenceId];
    return toDTO(await save(ctx, id, { draft }));
  }
  if (action === "override") {
    if (!policy.allowOverrides) throw new ApiError(403, "overrides-off", "Your course policy does not allow overrides.");
    const r = (reason ?? "").trim();
    if (r.length < 10) throw new ApiError(400, "reason-required", "Write a short reason (at least 10 characters). It goes on your receipt.");
    const s = draft.sentences.find((x) => x.id === sentenceId);
    if (!s) throw new ApiError(404, "not-found", "Sentence not found.");
    if (s.label !== "reported") throw new ApiError(409, "not-overridable", "Only “Reported, not checked” sentences can be confirmed by you.");
    s.override = { reason: r.slice(0, 500), at: new Date().toISOString() };
    summary = `Confirmed sentence ${sentenceId} myself: ${r.slice(0, 120)}`;
  } else {
    const i = draft.sentences.findIndex((x) => x.id === sentenceId);
    if (i < 0) throw new ApiError(404, "not-found", "Sentence not found.");
    const [s] = draft.sentences.splice(i, 1);
    draft.removed.push({ id: s.id, text: s.text, why: "Removed by you.", citations: s.citations });
    summary = `Removed sentence ${sentenceId} from the summary.`;
  }
  draft.stats = sentenceStats(draft.sentences, draft.gaps, draft.removed.length);
  const saved = await save(ctx, id, { draft });
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: `research.sentence-${action}`, subjectType: "run", subjectId: id, summary });
  return toDTO(saved);
}

export function approveSummary(ctx: WorkspaceCtx, id: string) {
  return exclusive(id, () => approveStep(ctx, id));
}

async function approveStep(ctx: WorkspaceCtx, id: string) {
  const row = await loadRow(ctx, id);
  requireState(row, "summary_review");
  if (!row.draft?.sentences.length && !row.draft?.gaps.length) {
    throw new ApiError(409, "empty-summary", "There is nothing left to approve: every sentence was removed. Go back and choose different sources.");
  }
  const chosen = (row.sources ?? []).filter((s) => s.accepted);
  const existing = await ctx.db.select({ doi: libraryItems.doi }).from(libraryItems).where(eq(libraryItems.workspaceId, ctx.workspaceId));
  const have = new Set(existing.map((e) => e.doi));
  let added = 0;
  for (const s of chosen) {
    const csl = s.verification?.record ? { ...s.verification.record, abstract: s.verification.record.abstract ?? s.csl.abstract } : s.csl;
    const cols = recordColumns(csl);
    if (cols.doi && have.has(cols.doi)) continue;
    await ctx.db.insert(libraryItems).values({
      workspaceId: ctx.workspaceId,
      csl,
      origin: "research",
      ...cols,
      status: s.verification?.status ?? "check",
      score: s.verification?.score ?? null,
      flags: s.verification?.flags ?? [],
      verification: s.verification,
      notes: `Used in research: “${row.question.slice(0, 160)}”`,
      tags: ["research"],
    });
    if (cols.doi) have.add(cols.doi);
    added++;
  }
  const opened = (row.draft?.viewed ?? []).filter((v) => row.draft?.sentences.some((x) => x.id === v)).length;
  const total = row.draft?.sentences.length ?? 0;
  const events = [...(row.events ?? []), ev("orchestrator", `You approved the summary (checkpoint 3) after opening the evidence for ${opened} of ${total} sentences. ${added} new source${added === 1 ? "" : "s"} saved to your library.`, "ok", { by: "you" })];
  const saved = await save(ctx, id, { state: "approved", summaryApprovedAt: new Date(), events });
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "research.summary-approved", subjectType: "run", subjectId: id, summary: `Approved the summary after opening the evidence for ${opened} of ${total} sentences; saved ${added} sources to the library.`, details: { evidenceOpened: opened, sentences: total } });
  return toDTO(saved);
}

export async function goBack(ctx: WorkspaceCtx, id: string, to: "plan" | "sources") {
  const row = await loadRow(ctx, id);
  requireState(row, "sources_review", "summary_review", "writing", "searching", "failed");
  const events = [...(row.events ?? []), ev("orchestrator", to === "plan" ? "You went back to edit the plan." : "You went back to change the sources.", "info", { by: "you" })];
  const patch: Partial<typeof researchRuns.$inferInsert> =
    to === "plan"
      ? { state: "plan_review", planApprovedAt: null, searchReport: null, sources: [], sourcesApprovedAt: null, draft: null, events }
      : { state: "sources_review", sourcesApprovedAt: null, draft: null, events };
  if (to === "sources" && !(row.sources ?? []).length) throw new ApiError(409, "no-sources", "There are no sources to go back to yet.");
  const saved = await save(ctx, id, patch);
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: `research.back-to-${to}`, subjectType: "run", subjectId: id, summary: events[events.length - 1].message });
  return toDTO(saved);
}

/* ───────────────────────── Export ───────────────────────── */

export async function exportRun(ctx: WorkspaceCtx, id: string, style: CitationStyleId) {
  const row = await loadRow(ctx, id);
  requireState(row, "approved");
  const draft = row.draft!;
  const chosen = (row.sources ?? []).filter((s) => s.accepted);
  const pmap = new Map(draft.passages.map((p) => [p.id, p]));
  const cslById = new Map(chosen.map((s, i) => [s.id, { ...(s.verification?.record ?? s.csl), id: `src-${i + 1}` }]));
  const lines: string[] = [];
  for (const s of draft.sentences) {
    const srcIds = [...new Set(s.citations.map((c) => pmap.get(c)?.sourceId).filter(Boolean) as string[])];
    const items = srcIds.map((sid) => cslById.get(sid)!).filter(Boolean);
    const cite = items.length ? await formatInText(items, style).catch(() => "") : "";
    const label = { verified: "Verified", reported: "Reported, not checked", reasoning: "AI reasoning", not_found: "Not found" }[s.label];
    lines.push(`${s.text}${cite ? ` ${cite}` : ""} [${label}${s.override ? "; confirmed by student" : ""}]`);
  }
  for (const g of draft.gaps) lines.push(`${g} [Not found]`);
  const usedIds = new Set(draft.sentences.flatMap((s) => s.citations.map((c) => pmap.get(c)?.sourceId)));
  const citedSources = chosen.filter((s) => usedIds.has(s.id));
  const { text: references, html: referencesHtml } = await formatMarkedList(citedSources.map((s) => cslById.get(s.id)!), style, {
    marks: citedSources.map((s) => (s.verification ? exportMark(s.verification.status, s.verification.reasonCode, s.verification.flags) : "Not checked")),
  });
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "research.exported", subjectType: "run", subjectId: id, summary: `Exported the approved summary in ${style.toUpperCase()}.` });
  return { summary: lines.join("\n\n"), references, referencesHtml, mode: draft.mode, stats: draft.stats };
}
