import { z } from "zod";
import { handle, rateLimit, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { addUploadedSource } from "@/server/services/research";

export const maxDuration = 60;

/** Receives PASSAGES extracted in the browser, never the PDF file itself. */
const body = z.object({
  fileName: z.string().max(200),
  title: z.string().trim().min(3, "Give the paper a title").max(300),
  doi: z.string().max(200).nullable().optional(),
  year: z.number().int().min(1500).max(2100).nullable().optional(),
  authors: z.string().max(400).nullable().optional(),
  passages: z.array(z.string().max(1200)).min(1).max(40),
});

export const POST = handle(async (req, ctx: RouteContext<"/api/research/[id]/upload">) => {
  const { id } = await ctx.params;
  const ws = await requireWorkspace();
  rateLimit(`upload:${ws.workspaceId}`, 10);
  return addUploadedSource(ws, id, await readJson(req, body));
});
