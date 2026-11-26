import { z } from "zod";
import { handle, rateLimit, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { joinWorkspace } from "@/server/services/workspace";

const body = z.object({ key: z.string().trim().min(10).max(40) });

export const POST = handle(async (req) => {
  const ctx = await requireWorkspace();
  rateLimit(`join:${ctx.workspaceId}`, 5);
  return joinWorkspace(ctx, (await readJson(req, body)).key);
});
