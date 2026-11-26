import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { createWorkspaceKey } from "@/server/services/workspace";

export const POST = handle(async () => createWorkspaceKey(await requireWorkspace()));
