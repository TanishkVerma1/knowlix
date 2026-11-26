import { handle, ndjsonStream, rateLimit } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { assertStep, runWrite } from "@/server/services/research";

export const maxDuration = 300;

export const POST = handle(async (_req, ctx: RouteContext<"/api/research/[id]/write">) => {
  const { id } = await ctx.params;
  const ws = await requireWorkspace();
  rateLimit(`write:${ws.workspaceId}`, 10);
  await assertStep(ws, id, "write");
  return ndjsonStream((send) => runWrite(ws, id, send));
});
