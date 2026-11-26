import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { sessionInfo } from "@/server/services/workspace";

export const GET = handle(async () => sessionInfo(await requireWorkspace()));
