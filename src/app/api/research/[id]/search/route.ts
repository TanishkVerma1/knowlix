import { handle, ndjsonStream, rateLimit } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { assertStep, runSearch } from "@/server/services/research";

export const maxDuration = 300;

export const POST = handle(async (_req, ctx: RouteContext<"/api/research/[id]/search">) => {
  const { id } = await ctx.params;
  const ws = await requireWorkspace();
  rateLimit(`search:${ws.workspaceId}`, 10);
  await assertStep(ws, id, "search");
  return ndjsonStream((send) => runSearch(ws, id, send));
});
