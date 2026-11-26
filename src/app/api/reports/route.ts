import { z } from "zod";
import { handle, rateLimit, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { submitReport } from "@/server/services/workspace";

const body = z.object({
  subjectType: z.string().max(40),
  subjectId: z.string().max(80),
  note: z.string().trim().min(5, "Tell us briefly what looks wrong").max(2000),
});

export const POST = handle(async (req) => {
  const ctx = await requireWorkspace();
  rateLimit(`report:${ctx.workspaceId}`, 10);
  const { subjectType, subjectId, note } = await readJson(req, body);
  return submitReport(ctx, subjectType, subjectId, note);
});
