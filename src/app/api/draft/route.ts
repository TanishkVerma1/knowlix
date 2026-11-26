import { z } from "zod";
import { handle, rateLimit, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { getDraft, saveDraft } from "@/server/services/drafts";
import { citationStyleIds } from "@/shared/policy";

export const GET = handle(async () => getDraft(await requireWorkspace()));

const body = z.object({ title: z.string().max(200), body: z.string().max(60_000, "A draft can be at most 60,000 characters."), style: z.enum(citationStyleIds) });

export const PUT = handle(async (req) => {
  const ctx = await requireWorkspace();
  rateLimit(`draft-save:${ctx.workspaceId}`, 120);
  return saveDraft(ctx, await readJson(req, body));
});
