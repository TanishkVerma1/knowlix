"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { RunDTO } from "@/server/services/research";
import type { AgentEvent, AgentStreamEvent, LiveAgentCall, SourceCandidate } from "@/shared/types";
import { api, ClientApiError, errorMessage, stream } from "@/lib/api";

type StreamEvent =
  | { type: "event"; event: AgentEvent }
  | { type: "candidate"; candidate: SourceCandidate }
  | { type: "done"; run: RunDTO }
  | { type: "error"; message: string }
  | AgentStreamEvent;

type Step = "draft" | "search" | "write";

export interface LiveState {
  events: AgentEvent[];
  candidates: SourceCandidate[];
  /** AI calls of the step that is running now, with their answers as they are typed. */
  calls: LiveAgentCall[];
  running: Step | null;
}

const IDLE: LiveState = { events: [], candidates: [], calls: [], running: null };

export function useRun(id: string) {
  const qc = useQueryClient();
  const key = React.useMemo(() => ["run", id], [id]);
  const [live, setLive] = React.useState<LiveState>(IDLE);
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<RunDTO>(`/api/research/${id}`),
    // A step that is running somewhere else (another tab, or before a reload): keep looking until it lands.
    refetchInterval: (q) => {
      const st = q.state.data?.state;
      return !live.running && (st === "planning" || st === "searching" || st === "writing") ? 3000 : false;
    },
  });
  const started = React.useRef<string | null>(null);

  const setRun = React.useCallback((run: RunDTO) => qc.setQueryData(key, run), [qc, key]);

  const runStream = React.useCallback(
    async (step: Step) => {
      setLive({ events: [], candidates: [], calls: [], running: step });
      try {
        await stream<StreamEvent>(`/api/research/${id}/${step}`, (e) => {
          if (e.type === "event") setLive((l) => ({ ...l, events: [...l.events, e.event] }));
          else if (e.type === "candidate") setLive((l) => ({ ...l, candidates: [...l.candidates, e.candidate] }));
          else if (e.type === "agent-start") setLive((l) => ({ ...l, calls: [...l.calls, e.call] }));
          else if (e.type === "agent-token")
            setLive((l) => ({
              ...l,
              calls: l.calls.map((c) => (c.callId === e.callId ? { ...c, text: e.reset ? e.text : c.text + e.text, provider: e.provider ?? c.provider, model: e.model ?? c.model } : c)),
            }));
          else if (e.type === "agent-end")
            setLive((l) => ({
              ...l,
              calls: l.calls.map((c) => (c.callId === e.callId ? { ...c, status: e.ok ? "done" : "failed", latencyMs: e.latencyMs, provider: e.provider, model: e.model, error: e.error ?? null, text: e.text ?? c.text } : c)),
            }));
          else if (e.type === "done") setRun(e.run);
          else if (e.type === "error") toast.error(e.message);
        });
      } catch (err) {
        // "busy" means this step is already running elsewhere; the page simply waits for it.
        if (!(err instanceof ClientApiError && err.code === "busy")) toast.error(errorMessage(err));
      } finally {
        // Load the stored copies of the calls before dropping the live ones, so nothing flickers away.
        await qc.invalidateQueries({ queryKey: ["ai-calls", id] }).catch(() => {});
        setLive((l) => ({ ...l, calls: [], running: null }));
        qc.invalidateQueries({ queryKey: key });
        qc.invalidateQueries({ queryKey: ["runs"] });
      }
    },
    [id, key, qc, setRun],
  );

  // The orchestrator moves on as soon as a checkpoint is approved.
  const state = query.data?.state;
  React.useEffect(() => {
    if (!state || live.running) return;
    const step: Step | null = state === "planning" ? "draft" : state === "searching" ? "search" : state === "writing" ? "write" : null;
    if (step && started.current !== `${step}:${query.data?.updatedAt}`) {
      started.current = `${step}:${query.data?.updatedAt}`;
      void runStream(step);
    }
  }, [state, live.running, query.data?.updatedAt, runStream]);

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api<RunDTO>(`/api/research/${id}/${path}`, { body: body ?? {} }),
    onSuccess: (run) => {
      setRun(run);
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return { query, run: query.data, live, action, setRun };
}
