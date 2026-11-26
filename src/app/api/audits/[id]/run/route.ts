import { handle, ndjsonStream, rateLimit } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { runAudit } from "@/server/services/audits";

export const maxDuration = 120;

export const POST = handle(async (req, ctx: RouteContext<"/api/audits/[id]/run">) => {
  const { id } = await ctx.params;
  const ws = await requireWorkspace();
  rateLimit(`run:${ws.workspaceId}`, 30);
  const recheck = new URL(req.url).searchParams.get("recheck") === "1";
  return ndjsonStream((send) => runAudit(ws, id, send, { recheck }));
});
