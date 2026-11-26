import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { approveSummary } from "@/server/services/research";

export const maxDuration = 60;

export const POST = handle(async (_req, ctx: RouteContext<"/api/research/[id]/approve">) => {
  const { id } = await ctx.params;
  return approveSummary(await requireWorkspace(), id);
});
