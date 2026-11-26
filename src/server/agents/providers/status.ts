import "server-only";
import { aiAvailable, providerSummary } from "./index";

export function aiStatus() {
  const list = providerSummary();
  const active = list.find((p) => p.configured) ?? null;
  return {
    mode: aiAvailable() ? ("ai" as const) : ("extractive" as const),
    active: active ? { id: active.id, label: active.label, model: active.model, local: active.local } : null,
    providers: list,
  };
}
