import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { createFolder } from "@/server/services/library";

const body = z.object({ name: z.string().trim().min(1, "Give the folder a name").max(60), color: z.string().optional() });

export const POST = handle(async (req) => {
  const { name, color } = await readJson(req, body);
  return createFolder(await requireWorkspace(), name, color);
});
