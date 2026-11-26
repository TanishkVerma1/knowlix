import { handle, ApiError } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { receiptFor } from "@/server/services/receipts";

export const GET = handle(async (_req, ctx: RouteContext<"/api/receipts/[kind]/[id]">) => {
  const { kind, id } = await ctx.params;
  if (kind !== "audit" && kind !== "run") throw new ApiError(404, "not-found", "Unknown receipt type.");
  return receiptFor(await requireWorkspace(), kind, id);
});
