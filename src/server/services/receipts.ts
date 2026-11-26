import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import type { WorkspaceCtx } from "../auth/workspace";
import { activityLog, aiCalls, auditItems, audits, researchRuns, shareLinks } from "../db/schema";
import { verifyChain, tryLog } from "../audit/activity";
import { ApiError } from "../http/api";
import { summarise } from "./audits";
import type { RecordStatus, SummaryDraft } from "@/shared/types";

export type ReceiptKind = "audit" | "run";

export interface ReceiptDTO {
  kind: ReceiptKind;
  id: string;
  title: string;
  createdAt: string;
  generatedAt: string;
  workspaceShort: string;
  chain: { intact: boolean; count: number; head: string };
  log: { at: string; actor: string; summary: string; hash: string }[];
  audit?: {
    summary: ReturnType<typeof summarise>;
    items: { n: number; raw: string; status: RecordStatus; resolution: string | null; reason: string | null; verdict: string; recordTitle: string | null; doi: string | null; flags: string[] }[];
  };
  run?: {
    question: string;
    mode: string;
    state: string;
    planApprovedAt: string | null;
    sourcesApprovedAt: string | null;
    summaryApprovedAt: string | null;
    queries: string[];
    sources: { id: string; title: string; year: number | null; doi: string | null; status: string; firstAuthor: string | null }[];
    stats: SummaryDraft["stats"] | null;
    evidenceOpened: { opened: number; of: number };
    overrides: { text: string; reason: string }[];
    removed: { text: string; why: string }[];
    critic: { type: string; message: string }[];
    ai: { calls: number; failed: number; models: string[]; promptVersions: string[]; charsSent: number };
  };
}

export async function buildReceipt(db: Db, workspaceId: string, kind: ReceiptKind, id: string): Promise<ReceiptDTO> {
  const [chain, logRows] = await Promise.all([
    verifyChain(db, workspaceId),
    db.select().from(activityLog).where(and(eq(activityLog.workspaceId, workspaceId), eq(activityLog.subjectId, id))).orderBy(asc(activityLog.seq)),
  ]);
  const base = {
    kind,
    id,
    generatedAt: new Date().toISOString(),
    workspaceShort: workspaceId.slice(0, 8).toUpperCase(),
    chain: { intact: chain.intact, count: chain.count, head: chain.head },
    log: logRows.map((r) => ({ at: r.at, actor: r.actor, summary: r.summary, hash: r.hash })),
  };

  if (kind === "audit") {
    const [a] = await db.select().from(audits).where(and(eq(audits.id, id), eq(audits.workspaceId, workspaceId))).limit(1);
    if (!a) throw new ApiError(404, "not-found", "That audit does not exist.");
    const rows = await db.select().from(auditItems).where(eq(auditItems.auditId, id)).orderBy(asc(auditItems.position));
    return {
      ...base,
      title: a.title,
      createdAt: a.createdAt.toISOString(),
      audit: {
        summary: summarise(rows),
        items: rows.map((r) => ({
          n: r.position + 1,
          raw: r.raw,
          status: r.status as RecordStatus,
          resolution: r.resolution,
          reason: r.resolutionReason,
          verdict: r.result?.reason ?? "Not checked yet.",
          recordTitle: r.result?.suggestion?.record.title ?? r.result?.record?.title ?? null,
          doi: (r.resolution === "replaced" ? r.result?.suggestion?.record.DOI ?? r.result?.record?.DOI : r.result?.record?.DOI) ?? r.parsed.doi ?? null,
          flags: r.result?.flags.map((f) => f.label) ?? [],
        })),
      },
    };
  }

  const [r] = await db.select().from(researchRuns).where(and(eq(researchRuns.id, id), eq(researchRuns.workspaceId, workspaceId))).limit(1);
  if (!r) throw new ApiError(404, "not-found", "That research run does not exist.");
  const calls = await db.select().from(aiCalls).where(eq(aiCalls.runId, id));
  const chosen = (r.sources ?? []).filter((s) => s.accepted);
  return {
    ...base,
    title: r.question,
    createdAt: r.createdAt.toISOString(),
    run: {
      question: r.question,
      mode: r.mode,
      state: r.state,
      planApprovedAt: r.planApprovedAt?.toISOString() ?? null,
      sourcesApprovedAt: r.sourcesApprovedAt?.toISOString() ?? null,
      summaryApprovedAt: r.summaryApprovedAt?.toISOString() ?? null,
      queries: (r.plan?.queries ?? []).filter((q) => q.enabled).map((q) => q.text),
      sources: chosen.map((s) => ({
        id: s.id,
        title: s.csl.title ?? "",
        year: Number(s.csl.issued?.["date-parts"]?.[0]?.[0]) || null,
        doi: s.csl.DOI ?? null,
        status: s.verification?.status ?? "check",
        firstAuthor: s.csl.author?.[0]?.family ?? null,
      })),
      stats: r.draft?.stats ?? null,
      evidenceOpened: { opened: (r.draft?.sentences ?? []).filter((x) => r.draft?.viewed?.includes(x.id)).length, of: r.draft?.sentences.length ?? 0 },
      overrides: (r.draft?.sentences ?? []).filter((s) => s.override).map((s) => ({ text: s.text, reason: s.override!.reason })),
      removed: (r.draft?.removed ?? []).map((x) => ({ text: x.text, why: x.why })),
      critic: (r.draft?.critic ?? []).map((c) => ({ type: c.type, message: c.message })),
      ai: {
        calls: calls.length,
        failed: calls.filter((c) => !c.ok).length,
        models: [...new Set(calls.filter((c) => c.ok).map((c) => `${c.model} (${c.provider})`))],
        promptVersions: [...new Set(calls.map((c) => c.promptVersion))],
        charsSent: calls.reduce((n, c) => n + c.sent.user.length, 0),
      },
    },
  };
}

export async function receiptFor(ctx: WorkspaceCtx, kind: ReceiptKind, id: string) {
  const receipt = await buildReceipt(ctx.db, ctx.workspaceId, kind, id);
  const links = await ctx.db
    .select({ token: shareLinks.token })
    .from(shareLinks)
    .where(and(eq(shareLinks.workspaceId, ctx.workspaceId), eq(shareLinks.subjectId, id), isNull(shareLinks.revokedAt)))
    .limit(1);
  return { receipt, shareToken: links[0]?.token ?? null };
}

/** A read-only supervisor link. Anyone with it sees this one receipt, nothing else. */
export async function createShare(ctx: WorkspaceCtx, kind: ReceiptKind, id: string) {
  await buildReceipt(ctx.db, ctx.workspaceId, kind, id); // proves it exists and belongs to this workspace
  const token = randomBytes(18).toString("base64url");
  await ctx.db.insert(shareLinks).values({ token, workspaceId: ctx.workspaceId, kind, subjectId: id });
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "receipt.shared", subjectType: kind, subjectId: id, summary: "Created a read-only supervisor link to this receipt." });
  return { token };
}

export async function revokeShare(ctx: WorkspaceCtx, token: string) {
  const done = await ctx.db.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.token, token), eq(shareLinks.workspaceId, ctx.workspaceId))).returning({ token: shareLinks.token });
  if (!done.length) throw new ApiError(404, "not-found", "That link does not exist in your workspace.");
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "receipt.unshared", summary: "Revoked a supervisor link." });
}

export async function sharedReceipt(db: Db, token: string) {
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.token, token)).limit(1);
  if (!link || link.revokedAt) throw new ApiError(404, "not-found", "This link does not exist or was revoked by the student.");
  return buildReceipt(db, link.workspaceId, link.kind as ReceiptKind, link.subjectId);
}
