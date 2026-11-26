"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, CircleCheck, CircleX } from "lucide-react";
import { api } from "@/lib/api";
import { Sheet } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/misc";
import { AGENTS } from "@/shared/labels";
import { cn } from "@/lib/utils";

export interface AiCall {
  id: string;
  agent: string;
  promptVersion: string;
  provider: string;
  model: string;
  temperature: number;
  sent: { system: string; user: string };
  received: string | null;
  latencyMs: number;
  ok: boolean;
  error: string | null;
  createdAt: string;
}

export function useAiCalls(runId: string, enabled = true) {
  // Refreshed only when a step finishes, so a call never shows twice (once live, once stored).
  return useQuery({ queryKey: ["ai-calls", runId], queryFn: () => api<{ calls: AiCall[] }>(`/api/research/${runId}/ai-calls`), enabled, staleTime: Infinity, refetchOnWindowFocus: false });
}

function CallRow({ c }: { c: AiCall }) {
  const [open, setOpen] = React.useState(false);
  const name = (AGENTS as Record<string, { name: string }>)[c.agent]?.name ?? (c.agent === "repair" ? "Writer (repair)" : c.agent);
  return (
    <li className="rounded-xl border border-rule bg-card">
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {c.ok ? <CircleCheck className="size-4 shrink-0 text-ok" aria-label="succeeded" /> : <CircleX className="size-4 shrink-0 text-danger" aria-label="failed" />}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{name}</span>
          <span className="block truncate text-[0.8rem] text-ink-3">
            {c.provider} · {c.model} · temperature {c.temperature} · {c.promptVersion} · {c.latencyMs} ms · {c.sent.user.length.toLocaleString()} characters sent
          </span>
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="space-y-3 border-t border-rule px-4 py-3">
          {c.error ? <p className="text-[0.85rem] font-semibold text-danger">{c.error}</p> : null}
          <details>
            <summary className="cursor-pointer text-[0.85rem] font-semibold text-ink-2">System prompt (persona and rules)</summary>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-3 font-mono text-[0.75rem] leading-relaxed text-ink-2">{c.sent.system}</pre>
          </details>
          <div>
            <p className="text-[0.85rem] font-semibold text-ink-2">Exactly what was sent</p>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-3 font-mono text-[0.75rem] leading-relaxed text-ink-2">{c.sent.user}</pre>
          </div>
          {c.received ? (
            <div>
              <p className="text-[0.85rem] font-semibold text-ink-2">What came back</p>
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-3 font-mono text-[0.75rem] leading-relaxed text-ink-2">{c.received}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** "Sent to the AI": every call, with the persona, the exact data sent and the raw reply. */
export function AiCallsSheet({ runId, open, onOpenChange }: { runId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useAiCalls(runId, open);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Sent to the AI" label="Every AI call in this research run">
      <div className="space-y-4 p-6">
        <p className="text-[0.92rem] text-ink-2">
          Every AI call in this run, in order. Only your question and short numbered passages from source abstracts are sent, never your drafts or uploads. Personal details are removed first.
        </p>
        {q.isLoading ? (
          <Skeleton className="h-20" />
        ) : q.data?.calls.length ? (
          <ol className="space-y-2.5">{q.data.calls.map((c) => <CallRow key={c.id} c={c} />)}</ol>
        ) : (
          <p className="rounded-xl border border-dashed border-rule-strong px-4 py-6 text-center text-[0.92rem] text-ink-2">
            No AI calls in this run. It ran in no-AI mode: keyword plans, keyword screening and exact quotes.
          </p>
        )}
      </div>
    </Sheet>
  );
}
