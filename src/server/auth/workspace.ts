import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client";
import { workspaces } from "../db/schema";
import { sessionSecret } from "../env";
import { ApiError } from "../http/api";
import { WORKSPACE_COOKIE, cookieOptions, signWorkspaceToken, verifyWorkspaceToken } from "./token";
import { DEFAULT_POLICY, normalisePolicy, type Policy } from "@/shared/policy";

const known = new Set<string>();

async function ensureWorkspace(db: Db, id: string) {
  if (known.has(id)) return;
  await db
    .insert(workspaces)
    .values({ id, policy: DEFAULT_POLICY })
    .onConflictDoUpdate({ target: workspaces.id, set: { lastSeenAt: sql`now()` } });
  known.add(id);
}

export interface WorkspaceCtx {
  db: Db;
  workspaceId: string;
}

/** Every API route starts here: the caller's private workspace, or a 401. */
export async function requireWorkspace(): Promise<WorkspaceCtx> {
  const jar = await cookies();
  const id = await verifyWorkspaceToken(jar.get(WORKSPACE_COOKIE)?.value, sessionSecret());
  if (!id) throw new ApiError(401, "no-workspace", "Your private workspace could not be found. Reload the page to start one.");
  const db = await getDb();
  await ensureWorkspace(db, id);
  return { db, workspaceId: id };
}

export async function getPolicy(db: Db, workspaceId: string): Promise<Policy> {
  const rows = await db.select({ policy: workspaces.policy }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return normalisePolicy(rows[0]?.policy ?? DEFAULT_POLICY);
}

/* ───────────── Workspace key: move a workspace to another device ───────────── */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function newWorkspaceKey(): string {
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `KNX-${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key.trim().toUpperCase()).digest("hex");
}

export async function switchToWorkspace(workspaceId: string) {
  const jar = await cookies();
  const token = await signWorkspaceToken(workspaceId, sessionSecret());
  jar.set(WORKSPACE_COOKIE, token, cookieOptions(process.env.NODE_ENV === "production"));
  known.delete(workspaceId);
}

export function forgetWorkspace(id: string) {
  known.delete(id);
}
