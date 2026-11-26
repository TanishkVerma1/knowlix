import "server-only";
import { createHash } from "node:crypto";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { activityLog } from "../db/schema";

export const GENESIS_HASH = "0".repeat(64);

export type Actor =
  | "student"
  | "system"
  | "verifier"
  | "agent:planner"
  | "agent:finder"
  | "agent:writer"
  | "agent:judge"
  | "agent:critic"
  | "orchestrator";

export interface ActivityEntry {
  actor: Actor;
  action: string;
  subjectType?: string;
  subjectId?: string;
  summary: string;
  details?: Record<string, unknown>;
}

/** Stable JSON (sorted keys) so a hash can be recomputed exactly later. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

export function entryHash(prevHash: string, e: ActivityEntry & { at: string }): string {
  const body = canonical({
    at: e.at,
    actor: e.actor,
    action: e.action,
    subjectType: e.subjectType ?? null,
    subjectId: e.subjectId ?? null,
    summary: e.summary,
    details: e.details ?? null,
  });
  return createHash("sha256").update(`${prevHash}\n${body}`).digest("hex");
}

/** Appends one entry to the workspace's hash chain. Serialised per workspace. */
export async function logActivity(db: Db, workspaceId: string, entry: ActivityEntry): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from workspaces where id = ${workspaceId} for update`);
    const last = await tx
      .select({ hash: activityLog.hash })
      .from(activityLog)
      .where(eq(activityLog.workspaceId, workspaceId))
      .orderBy(desc(activityLog.seq))
      .limit(1);
    const prevHash = last[0]?.hash ?? GENESIS_HASH;
    const at = new Date().toISOString();
    const hash = entryHash(prevHash, { ...entry, at });
    await tx.insert(activityLog).values({
      workspaceId,
      at,
      actor: entry.actor,
      action: entry.action,
      subjectType: entry.subjectType ?? null,
      subjectId: entry.subjectId ?? null,
      summary: entry.summary,
      details: entry.details ?? null,
      prevHash,
      hash,
    });
  });
}

/** Never let logging failures break the student's action; report them instead. */
export async function tryLog(db: Db, workspaceId: string, entry: ActivityEntry) {
  try {
    await logActivity(db, workspaceId, entry);
  } catch (err) {
    console.error("[knowlix] activity log append failed", err);
  }
}

export async function verifyChain(db: Db, workspaceId: string) {
  const rows = await db.select().from(activityLog).where(eq(activityLog.workspaceId, workspaceId)).orderBy(asc(activityLog.seq));
  let prev = GENESIS_HASH;
  for (const r of rows) {
    const expected = entryHash(prev, {
      at: r.at,
      actor: r.actor as Actor,
      action: r.action,
      subjectType: r.subjectType ?? undefined,
      subjectId: r.subjectId ?? undefined,
      summary: r.summary,
      details: (r.details as Record<string, unknown> | null) ?? undefined,
    });
    if (r.prevHash !== prev || r.hash !== expected) {
      return { intact: false, count: rows.length, brokenAtSeq: r.seq, head: rows[rows.length - 1]?.hash ?? GENESIS_HASH };
    }
    prev = r.hash;
  }
  return { intact: true, count: rows.length, brokenAtSeq: null as number | null, head: prev };
}
