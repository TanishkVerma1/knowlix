import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { addRecord } from "@/server/services/library";
import type { CslItem } from "@/shared/types";

export const maxDuration = 60;

const body = z.object({
  csl: z.looseObject({ id: z.string(), type: z.string(), title: z.string().optional() }),
  origin: z.enum(["related", "research"]),
  folderId: z.string().uuid().nullable().optional(),
});

export const POST = handle(async (req) => {
  const { csl, origin, folderId } = await readJson(req, body);
  return addRecord(await requireWorkspace(), csl as CslItem, origin, folderId ?? null);
});
