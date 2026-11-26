import { handle, readJson } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { updatePolicy } from "@/server/services/workspace";
import { policySchema } from "@/shared/policy";

export const PUT = handle(async (req) => ({ policy: await updatePolicy(await requireWorkspace(), await readJson(req, policySchema)) }));
