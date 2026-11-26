import { handle } from "@/server/http/api";
import { getDb } from "@/server/db/client";
import { sharedReceipt } from "@/server/services/receipts";

/** Public, read-only: the supervisor view of one receipt. No workspace cookie involved. */
export const GET = handle(async (_req, ctx: RouteContext<"/api/share/[token]">) => {
  const { token } = await ctx.params;
  return sharedReceipt(await getDb(), token);
});
