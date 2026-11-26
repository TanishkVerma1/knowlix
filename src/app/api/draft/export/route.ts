import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { logDraftExport } from "@/server/services/drafts";

export const POST = handle(async () => logDraftExport(await requireWorkspace()));
