import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { deleteFolder, renameFolder } from "@/server/services/library";

const body = z.object({ name: z.string().trim().min(1).max(60) });

export const PATCH = handle(async (req, ctx: RouteContext<"/api/folders/[id]">) => {
  const { id } = await ctx.params;
  return renameFolder(await requireWorkspace(), id, (await readJson(req, body)).name);
});

export const DELETE = handle(async (_req, ctx: RouteContext<"/api/folders/[id]">) => {
  const { id } = await ctx.params;
  await deleteFolder(await requireWorkspace(), id);
  return { ok: true };
});
