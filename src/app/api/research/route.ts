import { z } from "zod";
import { handle, rateLimit, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { createRun, listRuns } from "@/server/services/research";

export const maxDuration = 60;

export const GET = handle(async () => ({ runs: await listRuns(await requireWorkspace()) }));

const body = z.object({ question: z.string().trim().min(8, "Write your question as a full sentence.").max(500), live: z.boolean().optional() });

export const POST = handle(async (req) => {
  const ctx = await requireWorkspace();
  rateLimit(`research:${ctx.workspaceId}`, 12);
  const input = await readJson(req, body);
  // live: the run page opens at once and streams the Planner; otherwise the plan is drafted before replying.
  return createRun(ctx, input.question, { defer: input.live === true });
});
