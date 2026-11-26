import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { activity } from "@/server/services/workspace";

export const GET = handle(async () => activity(await requireWorkspace()));
