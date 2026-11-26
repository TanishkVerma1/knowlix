import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { createShare, revokeShare } from "@/server/services/receipts";

const body = z.object({ kind: z.enum(["audit", "run"]), id: z.string().uuid() });

export const POST = handle(async (req) => {
  const { kind, id } = await readJson(req, body);
  return createShare(await requireWorkspace(), kind, id);
});

const del = z.object({ token: z.string().min(10).max(60) });

export const DELETE = handle(async (req) => {
  await revokeShare(await requireWorkspace(), (await readJson(req, del)).token);
  return { ok: true };
});
