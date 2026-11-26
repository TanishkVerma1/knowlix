import { z } from "zod";
import { handle, rateLimit, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { createAudit, listAudits } from "@/server/services/audits";

export const GET = handle(async () => ({ audits: await listAudits(await requireWorkspace()) }));

const body = z.object({ text: z.string().max(100_000).optional(), sample: z.boolean().optional() });

export const POST = handle(async (req) => {
  const ctx = await requireWorkspace();
  rateLimit(`audit:${ctx.workspaceId}`, 20);
  return createAudit(ctx, await readJson(req, body));
});
