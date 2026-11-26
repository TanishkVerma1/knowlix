import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { saveAuditToLibrary } from "@/server/services/audits";

const body = z.object({ folderId: z.string().uuid().nullable().optional() });

export const POST = handle(async (req, ctx: RouteContext<"/api/audits/[id]/library">) => {
  const { id } = await ctx.params;
  const { folderId } = await readJson(req, body);
  return saveAuditToLibrary(await requireWorkspace(), id, folderId ?? null);
});
