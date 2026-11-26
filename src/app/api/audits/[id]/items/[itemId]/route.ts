import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { resolveItem } from "@/server/services/audits";

const body = z.object({ action: z.enum(["replace", "remove", "keep", "undo"]), reason: z.string().max(500).optional() });

export const PATCH = handle(async (req, ctx: RouteContext<"/api/audits/[id]/items/[itemId]">) => {
  const { id, itemId } = await ctx.params;
  const { action, reason } = await readJson(req, body);
  return resolveItem(await requireWorkspace(), id, itemId, action, reason);
});
