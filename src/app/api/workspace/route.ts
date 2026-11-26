import { handle } from "@/server/http/api";
import { requireWorkspace } from "@/server/auth/workspace";
import { deleteWorkspace, exportWorkspace } from "@/server/services/workspace";

export const GET = handle(async () => {
  const data = await exportWorkspace(await requireWorkspace());
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="knowlix-workspace-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});

export const DELETE = handle(async () => deleteWorkspace(await requireWorkspace()));
