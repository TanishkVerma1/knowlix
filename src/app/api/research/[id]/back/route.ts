import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { goBack } from "@/server/services/research";

const body = z.object({ to: z.enum(["plan", "sources"]) });

export const POST = handle(async (req, ctx: RouteContext<"/api/research/[id]/back">) => {
  const { id } = await ctx.params;
  return goBack(await requireWorkspace(), id, (await readJson(req, body)).to);
});
