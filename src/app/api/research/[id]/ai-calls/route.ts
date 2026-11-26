import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { listAiCalls } from "@/server/services/research";

export const GET = handle(async (_req, ctx: RouteContext<"/api/research/[id]/ai-calls">) => {
  const { id } = await ctx.params;
  return { calls: await listAiCalls(await requireWorkspace(), id) };
});
