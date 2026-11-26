import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { approvePlan, updatePlan } from "@/server/services/research";

const body = z.object({
  queries: z
    .array(
      z.object({
        id: z.string().max(10),
        text: z.string().max(120),
        enabled: z.boolean(),
        fromYear: z.number().int().min(1800).max(2100).nullable().optional(),
        toYear: z.number().int().min(1800).max(2100).nullable().optional(),
      }),
    )
    .max(8),
  approve: z.boolean().optional(),
});

export const POST = handle(async (req, ctx: RouteContext<"/api/research/[id]/plan">) => {
  const { id } = await ctx.params;
  const ws = await requireWorkspace();
  const { queries, approve } = await readJson(req, body);
  const run = await updatePlan(ws, id, queries);
  return approve ? approvePlan(ws, id) : run;
});
