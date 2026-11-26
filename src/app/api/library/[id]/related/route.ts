import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { relatedPapers, type RelatedKind } from "@/server/services/library";

export const maxDuration = 60;

export const GET = handle(async (req, ctx: RouteContext<"/api/library/[id]/related">) => {
  const { id } = await ctx.params;
  const k = new URL(req.url).searchParams.get("kind");
  const kind: RelatedKind = k === "cited-by" || k === "similar" ? k : "references";
  return relatedPapers(await requireWorkspace(), id, kind);
});
