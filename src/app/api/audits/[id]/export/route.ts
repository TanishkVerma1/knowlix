import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { exportAudit } from "@/server/services/audits";
import { citationStyleIds, type CitationStyleId } from "@/shared/policy";

const FORMATS = ["text", "bibtex", "ris", "csl"] as const;

export const GET = handle(async (req, ctx: RouteContext<"/api/audits/[id]/export">) => {
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  const style = (citationStyleIds as string[]).includes(sp.get("style") ?? "") ? (sp.get("style") as CitationStyleId) : "apa";
  const format = (FORMATS as readonly string[]).includes(sp.get("format") ?? "") ? (sp.get("format") as (typeof FORMATS)[number]) : "text";
  return exportAudit(await requireWorkspace(), id, style, format);
});
