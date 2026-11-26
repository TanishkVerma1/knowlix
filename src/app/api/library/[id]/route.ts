import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { deleteItem, updateItem } from "@/server/services/library";

const body = z.object({
  notes: z.string().max(20_000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  folderId: z.string().uuid().nullable().optional(),
});

export const PATCH = handle(async (req, ctx: RouteContext<"/api/library/[id]">) => {
  const { id } = await ctx.params;
  return updateItem(await requireWorkspace(), id, await readJson(req, body));
});

export const DELETE = handle(async (_req, ctx: RouteContext<"/api/library/[id]">) => {
  const { id } = await ctx.params;
  await deleteItem(await requireWorkspace(), id);
  return { ok: true };
});
