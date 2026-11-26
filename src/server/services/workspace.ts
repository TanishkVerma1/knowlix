import "server-only";
import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { WorkspaceCtx } from "../auth/workspace";
import { forgetWorkspace, getPolicy, hashKey, newWorkspaceKey, switchToWorkspace } from "../auth/workspace";
import { activityLog, aiCalls, auditItems, audits, folders, libraryItems, reports, researchRuns, shareLinks, workspaces } from "../db/schema";
import { tryLog, verifyChain } from "../audit/activity";
import { ApiError } from "../http/api";
import { dbDriver } from "../db/client";
import { aiStatus } from "../agents/providers/status";
import { normalisePolicy, type Policy, POLICY_PRESETS } from "@/shared/policy";

export async function sessionInfo(ctx: WorkspaceCtx) {
  const [policy, [ws], counts] = await Promise.all([
    getPolicy(ctx.db, ctx.workspaceId),
    ctx.db.select({ createdAt: workspaces.createdAt, keyHash: workspaces.keyHash }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).limit(1),
    ctx.db.execute(sql`
      select
        (select count(*) from library_items where workspace_id = ${ctx.workspaceId})::int as library,
        (select count(*) from audits where workspace_id = ${ctx.workspaceId})::int as audits,
        (select count(*) from research_runs where workspace_id = ${ctx.workspaceId})::int as runs
    `),
  ]);
  const c = (counts as unknown as { rows: { library: number; audits: number; runs: number }[] }).rows?.[0] ?? { library: 0, audits: 0, runs: 0 };
  return {
    workspace: { id: ctx.workspaceId, short: ctx.workspaceId.slice(0, 8).toUpperCase(), createdAt: ws?.createdAt?.toISOString() ?? null, hasKey: Boolean(ws?.keyHash) },
    policy,
    ai: aiStatus(),
    db: dbDriver(),
    counts: c,
  };
}

export async function updatePolicy(ctx: WorkspaceCtx, next: Policy) {
  const policy = normalisePolicy(next);
  // A preset name is a promise about the switches. If they differ from the preset, this is a custom policy.
  if (policy.preset !== "custom") {
    const preset = POLICY_PRESETS[policy.preset].policy;
    const same = preset.aiWriting === policy.aiWriting && preset.allowPreprints === policy.allowPreprints && preset.allowOverrides === policy.allowOverrides;
    if (!same) policy.preset = "custom";
  }
  await ctx.db.update(workspaces).set({ policy }).where(eq(workspaces.id, ctx.workspaceId));
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "policy.updated", summary: `Policy set to “${policy.preset}” (AI writing ${policy.aiWriting ? "on" : "off"}, preprints ${policy.allowPreprints ? "allowed" : "excluded"}, overrides ${policy.allowOverrides ? "allowed" : "off"}).`, details: { policy } });
  return policy;
}

/** Creates (or rotates) the key that moves this workspace to another device. Shown once. */
export async function createWorkspaceKey(ctx: WorkspaceCtx) {
  const key = newWorkspaceKey();
  await ctx.db.update(workspaces).set({ keyHash: hashKey(key) }).where(eq(workspaces.id, ctx.workspaceId));
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "workspace.key-created", summary: "Created a new workspace key (any older key stopped working)." });
  return { key };
}

export async function joinWorkspace(ctx: WorkspaceCtx, key: string) {
  const [ws] = await ctx.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.keyHash, hashKey(key))).limit(1);
  if (!ws) throw new ApiError(404, "bad-key", "That workspace key is not valid. Check it and try again.");
  await switchToWorkspace(ws.id);
  await tryLog(ctx.db, ws.id, { actor: "student", action: "workspace.joined", summary: "This workspace was opened on another device with its key." });
  return { ok: true };
}

/** Right to erasure: removes everything, including the append-only log (the only allowed deletion). */
export async function deleteWorkspace(ctx: WorkspaceCtx) {
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('knowlix.erasing', 'on', true)`);
    await tx.delete(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  });
  forgetWorkspace(ctx.workspaceId);
  // Start over under a brand-new identity so nothing links the old and new workspace.
  await switchToWorkspace(randomUUID());
  return { deleted: true };
}

export async function exportWorkspace(ctx: WorkspaceCtx) {
  const w = ctx.workspaceId;
  const [lib, fs, au, items, runs, calls, log, reps] = await Promise.all([
    ctx.db.select().from(libraryItems).where(eq(libraryItems.workspaceId, w)),
    ctx.db.select().from(folders).where(eq(folders.workspaceId, w)),
    ctx.db.select().from(audits).where(eq(audits.workspaceId, w)),
    ctx.db.select().from(auditItems).where(eq(auditItems.workspaceId, w)),
    ctx.db.select().from(researchRuns).where(eq(researchRuns.workspaceId, w)),
    ctx.db.select().from(aiCalls).where(eq(aiCalls.workspaceId, w)),
    ctx.db.select().from(activityLog).where(eq(activityLog.workspaceId, w)).orderBy(activityLog.seq),
    ctx.db.select().from(reports).where(eq(reports.workspaceId, w)),
  ]);
  return { exportedAt: new Date().toISOString(), library: lib, folders: fs, audits: au, auditItems: items, researchRuns: runs, aiCalls: calls, activityLog: log, reports: reps };
}

export async function activity(ctx: WorkspaceCtx, limit = 200) {
  const [rows, chain] = await Promise.all([
    ctx.db.select().from(activityLog).where(eq(activityLog.workspaceId, ctx.workspaceId)).orderBy(desc(activityLog.seq)).limit(limit),
    verifyChain(ctx.db, ctx.workspaceId),
  ]);
  return {
    chain,
    entries: rows.map((r) => ({ seq: r.seq, at: r.at, actor: r.actor, action: r.action, summary: r.summary, subjectType: r.subjectType, subjectId: r.subjectId, hash: r.hash, prevHash: r.prevHash, details: r.details })),
  };
}

/** Proves the log is append-only: asks Postgres to rewrite an entry and reports the refusal. */
export async function tamperTest(ctx: WorkspaceCtx) {
  // The attempt itself is logged first, so there is always an entry to attack, even in a brand-new workspace.
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "log.tamper-test", summary: "Asked the database to rewrite this log. It must refuse." });
  try {
    const res = (await ctx.db.execute(sql`update activity_log set summary = 'tampered' where workspace_id = ${ctx.workspaceId} returning seq`)) as unknown as { rows?: unknown[] };
    if (!res.rows?.length) return { refused: true, message: "There was nothing to edit: this log is empty." };
    return { refused: false, message: "The database accepted the edit. This should never happen." };
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause?.message ?? (err instanceof Error ? err.message : String(err));
    return { refused: true, message: cause.includes("append-only") ? "Postgres refused: activity_log is append-only." : cause };
  }
}

export async function submitReport(ctx: WorkspaceCtx, subjectType: string, subjectId: string, note: string) {
  const [r] = await ctx.db.insert(reports).values({ workspaceId: ctx.workspaceId, subjectType, subjectId, note: note.slice(0, 2000) }).returning();
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "report.submitted", subjectType, subjectId, summary: `Reported a check as possibly wrong: ${note.slice(0, 140)}` });
  return { id: r.id };
}

export async function listShareLinks(ctx: WorkspaceCtx) {
  return ctx.db.select().from(shareLinks).where(eq(shareLinks.workspaceId, ctx.workspaceId));
}
