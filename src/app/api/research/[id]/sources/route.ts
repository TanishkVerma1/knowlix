import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { chooseSources } from "@/server/services/research";

const body = z.object({ accepted: z.array(z.string().max(10)).max(30) });

export const POST = handle(async (req, ctx: RouteContext<"/api/research/[id]/sources">) => {
  const { id } = await ctx.params;
  return chooseSources(await requireWorkspace(), id, (await readJson(req, body)).accepted);
});
