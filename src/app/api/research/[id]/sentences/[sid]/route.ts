import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { reviewSentence } from "@/server/services/research";

const body = z.object({ action: z.enum(["override", "remove", "view"]), reason: z.string().max(500).optional() });

export const POST = handle(async (req, ctx: RouteContext<"/api/research/[id]/sentences/[sid]">) => {
  const { id, sid } = await ctx.params;
  const { action, reason } = await readJson(req, body);
  return reviewSentence(await requireWorkspace(), id, sid, action, reason);
});
