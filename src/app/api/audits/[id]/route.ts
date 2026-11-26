import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { getAudit } from "@/server/services/audits";

export const GET = handle(async (_req, ctx: RouteContext<"/api/audits/[id]">) => {
  const { id } = await ctx.params;
  return getAudit(await requireWorkspace(), id);
});
