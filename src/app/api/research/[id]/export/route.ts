import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { exportRun } from "@/server/services/research";
import { citationStyleIds, type CitationStyleId } from "@/shared/policy";

export const GET = handle(async (req, ctx: RouteContext<"/api/research/[id]/export">) => {
  const { id } = await ctx.params;
  const s = new URL(req.url).searchParams.get("style") ?? "apa";
  const style = (citationStyleIds as string[]).includes(s) ? (s as CitationStyleId) : "apa";
  return exportRun(await requireWorkspace(), id, style);
});
