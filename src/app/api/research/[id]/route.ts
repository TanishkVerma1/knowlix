import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { getRun } from "@/server/services/research";

export const GET = handle(async (_req, ctx: RouteContext<"/api/research/[id]">) => {
  const { id } = await ctx.params;
  return getRun(await requireWorkspace(), id);
});
