import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { tamperTest } from "@/server/services/workspace";

export const POST = handle(async () => tamperTest(await requireWorkspace()));
