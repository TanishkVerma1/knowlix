import { z } from "zod";
import { handle, rateLimit, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { addByInput, listLibrary } from "@/server/services/library";

export const maxDuration = 60;

export const GET = handle(async () => listLibrary(await requireWorkspace()));

const body = z.object({ input: z.string().min(3).max(5000), folderId: z.string().uuid().nullable().optional(), preview: z.boolean().optional() });

export const POST = handle(async (req) => {
  const ctx = await requireWorkspace();
  rateLimit(`lib:${ctx.workspaceId}`, 40);
  const { input, folderId, preview } = await readJson(req, body);
  return addByInput(ctx, input, folderId ?? null, { preview });
});
