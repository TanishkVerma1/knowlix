import { handle, ndjsonStream, rateLimit } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { assertStep, runPlan } from "@/server/services/research";

export const maxDuration = 300;

/** Step 1 as a stream: the Planner drafts the search plan while the student watches. */
export const POST = handle(async (_req, ctx: RouteContext<"/api/research/[id]/draft">) => {
  const { id } = await ctx.params;
  const ws = await requireWorkspace();
  rateLimit(`draft:${ws.workspaceId}`, 12);
  await assertStep(ws, id, "plan");
  return ndjsonStream((send) => runPlan(ws, id, send));
});
