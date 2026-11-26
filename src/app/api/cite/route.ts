import { z } from "zod";
import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { cite } from "@/server/services/library";
import { citationStyleIds } from "@/shared/policy";

const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), style: z.enum(citationStyleIds) });

export const POST = handle(async (req) => {
  const { ids, style } = await readJson(req, body);
  return cite(await requireWorkspace(), ids, style);
});
