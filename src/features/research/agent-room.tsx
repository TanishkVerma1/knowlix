"use client";

import * as React from "react";
import { Check, ChevronDown, Compass, Eye, FileOutput, Gavel, Hand, LoaderCircle, Lock, PenLine, Search, ShieldCheck, Workflow, CircleX } from "lucide-react";
import type { AgentEvent, LiveAgentCall, RunState } from "@/shared/types";
import { AGENTS } from "@/shared/labels";
import { cn } from "@/lib/utils";

type Station = AgentEvent["agent"];

const ICON: Record<Station, typeof Compass> = {
  planner: Compass,
  finder: Search,
  verifier: ShieldCheck,
  writer: PenLine,
  judge: Gavel,
  critic: Eye,
  orchestrator: Workflow,
};

const PROVIDER: Record<string, string> = { groq: "Groq", gemini: "Google Gemini", ollama: "on this computer", mock: "test double", none: "no answer" };

export function modelLabel(provider: string | null, model: string | null): string {
  if (!model || model === "none") return "AI model";
  const where = provider ? PROVIDER[provider] ?? provider : "";
  return provider === "ollama" ? `${model}, ${where}` : where ? `${model} via ${where}` : model;
}

/* ───────────────────────── The pipeline: agents and your three checkpoints, live ───────────────────────── */

type ChipState = "idle" | "queued" | "working" | "done";

const PHASES: { id: 1 | 2 | 3 | 4; name: string; working: RunState | null; review: RunState; agents: { key: Station | "formatter"; label: string }[]; gate: string }[] = [
  { id: 1, name: "Plan", working: "planning", review: "plan_review", agents: [{ key: "planner", label: "Planner" }], gate: "You approve the plan" },
  { id: 2, name: "Sources", working: "searching", review: "sources_review", agents: [{ key: "finder", label: "Finder" }, { key: "verifier", label: "Verifier" }], gate: "You choose the sources" },
  { id: 3, name: "Summary", working: "writing", review: "summary_review", agents: [{ key: "writer", label: "Writer" }, { key: "verifier", label: "Checker" }, { key: "judge", label: "Judge" }, { key: "critic", label: "Critic" }], gate: "You review the summary" },
  { id: 4, name: "Export", working: null, review: "approved", agents: [{ key: "formatter", label: "Formatter" }], gate: "Your work, with a receipt" },
];

function phaseOf(state: RunState): number {
  if (state === "planning" || state === "plan_review" || state === "failed") return 1;
  if (state === "searching" || state === "sources_review") return 2;
  if (state === "writing" || state === "summary_review") return 3;
  return 4;
}

/** Which agent is busy right now: an open AI call wins, otherwise whoever spoke last. */
function activeStation(liveEvents: AgentEvent[], calls: LiveAgentCall[]): Station | null {
  const open = calls.find((c) => c.status === "working");
  if (open) return open.agent === "repair" ? "writer" : open.agent;
  for (let i = liveEvents.length - 1; i >= 0; i--) if (liveEvents[i].agent !== "orchestrator") return liveEvents[i].agent;
  return null;
}

export function Pipeline({ state, mode, liveEvents, calls }: { state: RunState; mode: "ai" | "extractive"; liveEvents: AgentEvent[]; calls: LiveAgentCall[] }) {
  const current = phaseOf(state);
  const approved = state === "approved";
  const active = activeStation(liveEvents, calls);
  return (
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Who is working, and where you decide">
      {PHASES.map((p) => {
        const isCurrent = p.id === current;
        const past = p.id < current || approved;
        const working = isCurrent && state === p.working;
        const waiting = isCurrent && state === p.review && !approved;
        const activeIdx = working ? p.agents.findIndex((a) => a.key === active) : -1;
        return (
          <li
            key={p.id}
            aria-current={isCurrent ? "step" : undefined}
            className={cn(
              "flex flex-col rounded-2xl border px-3.5 py-3 transition-colors",
              isCurrent ? "border-accent bg-accent-tint shadow-card" : past ? "border-rule bg-card" : "border-dashed border-rule-strong",
            )}
          >
            <div className="flex items-center gap-2">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[0.75rem] font-extrabold tabular", past ? "bg-[var(--ok-stamp)] text-white" : isCurrent ? "bg-accent text-accent-ink" : "bg-paper-2 text-ink-3")}>
                {past ? <Check className="size-3.5" aria-hidden /> : p.id}
              </span>
              <span className={cn("text-[0.92rem] font-extrabold", isCurrent || past ? "text-ink" : "text-ink-3")}>{p.name}</span>
              <span className={cn("ml-auto text-[0.75rem] font-semibold", working ? "text-accent" : waiting ? "text-accent" : "text-ink-3")}>
                {past ? "Done" : working ? "Agents working" : waiting ? "Your turn" : "Locked"}
              </span>
            </div>

            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {p.agents.map((a, i) => {
                const st: ChipState = past || waiting ? "done" : working ? (i === activeIdx ? "working" : i < activeIdx ? "done" : "queued") : "idle";
                const Icon = a.key === "formatter" ? FileOutput : ICON[a.key];
                const ai = a.key !== "formatter" && AGENTS[a.key].kind === "ai";
                const kind = !ai ? "code" : mode === "ai" ? "AI" : "rules";
                return (
                  <li
                    key={`${a.key}-${a.label}`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8rem] font-bold leading-none",
                      st === "working" && "agent-live border-accent bg-card text-accent",
                      st === "done" && "border-transparent bg-ok-tint text-ok",
                      st === "queued" && "border-rule bg-card text-ink-2",
                      st === "idle" && "border-rule bg-transparent text-ink-3",
                    )}
                  >
                    {st === "working" ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : st === "done" ? <Check className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
                    {a.label}
                    <span className="font-semibold opacity-70">· {kind}</span>
                    <span className="sr-only">{st === "working" ? " (working now)" : st === "done" ? " (finished)" : ""}</span>
                  </li>
                );
              })}
            </ul>

            <p className={cn("mt-2.5 flex items-center gap-1.5 border-t pt-2 text-[0.8rem] font-semibold", isCurrent ? "border-[color-mix(in_oklab,var(--accent)_25%,transparent)]" : "border-rule", waiting ? "text-accent" : past ? "text-ok" : "text-ink-3")}>
              {past ? <Check className="size-3.5" aria-hidden /> : waiting ? <Hand className="size-3.5" aria-hidden /> : <Lock className="size-3.5" aria-hidden />}
              {p.gate}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────────────────── One AI call, typed out as it happens ───────────────────────── */

function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function useElapsed(since: string, running: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);
  return Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
}

function CallConsole({ call, defaultOpen }: { call: LiveAgentCall; defaultOpen: boolean }) {
  const working = call.status === "working";
  const [open, setOpen] = React.useState(defaultOpen);
  const boxRef = React.useRef<HTMLPreElement>(null);
  const elapsed = useElapsed(call.startedAt, working);
  const shown = open || working;

  React.useEffect(() => {
    const el = boxRef.current;
    if (el && working) el.scrollTop = el.scrollHeight;
  }, [call.text, working]);

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-rail-2 bg-rail text-rail-ink">
      <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={shown} disabled={working}>
        <span className="font-mono text-[0.78rem] font-bold tracking-wide text-rail-ink">
          {modelLabel(call.provider, call.model)}
        </span>
        <span className="font-mono text-[0.72rem] text-rail-muted tabular">
          persona {call.promptVersion} · {call.sentChars.toLocaleString()} characters sent{call.attempt > 1 ? " · second try" : ""}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[0.75rem] font-bold tabular">
          {working ? (
            <>
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
              {call.text ? "typing" : "reading"} · {elapsed}s
            </>
          ) : call.status === "done" ? (
            <>
              <Check className="size-3.5 text-[#7be0a9]" aria-hidden />
              answered in {((call.latencyMs ?? 0) / 1000).toFixed(1)}s
            </>
          ) : (
            <>
              <CircleX className="size-3.5 text-[#ff9b8e]" aria-hidden />
              rejected
            </>
          )}
          {!working ? <ChevronDown className={cn("size-3.5 text-rail-muted transition-transform", shown && "rotate-180")} aria-hidden /> : null}
        </span>
      </button>
      {shown ? (
        <pre ref={boxRef} className={cn("overflow-auto whitespace-pre-wrap border-t border-rail-2 px-3.5 py-3 font-mono text-[0.8rem] leading-relaxed text-rail-ink [overflow-wrap:anywhere]", working ? "max-h-64" : "max-h-72")} aria-live="off">
          {call.text ? (working ? call.text : pretty(call.text)) : <span className="text-rail-muted">{working ? "Reading what it was sent. The answer appears here as it is typed…" : "No answer came back."}</span>}
          {working ? <span className="caret" aria-hidden /> : null}
        </pre>
      ) : null}
      {call.error && !working ? <p className="border-t border-rail-2 px-3.5 py-2 text-[0.8rem] font-semibold text-[#ffb3a8]">{call.error}</p> : null}
    </div>
  );
}

/* ───────────────────────── The room: everything each agent did, in order ───────────────────────── */

type Item = { kind: "event"; at: number; event: AgentEvent } | { kind: "call"; at: number; call: LiveAgentCall };

interface Block {
  station: Station;
  by: AgentEvent["by"];
  items: Item[];
}

const BY: Record<NonNullable<AgentEvent["by"]>, { label: string; cls: string }> = {
  ai: { label: "AI", cls: "bg-neutral-tint text-neutral" },
  code: { label: "Code, no AI", cls: "bg-paper-2 text-ink-2" },
  rules: { label: "Rules, no AI", cls: "bg-warn-tint text-warn" },
  you: { label: "You", cls: "bg-accent-tint text-accent" },
};

const TONE: Record<NonNullable<AgentEvent["tone"]>, string> = { info: "text-ink-2", ok: "text-ok", warn: "text-warn", error: "text-danger" };

function buildBlocks(events: AgentEvent[], calls: LiveAgentCall[]): Block[] {
  const items: Item[] = [
    ...events.map((event) => ({ kind: "event" as const, at: new Date(event.at).getTime(), event })),
    ...calls.map((call) => ({ kind: "call" as const, at: new Date(call.startedAt).getTime(), call })),
  ].sort((a, b) => a.at - b.at);
  const blocks: Block[] = [];
  for (const it of items) {
    const station: Station = it.kind === "event" ? it.event.agent : it.call.agent === "repair" ? "writer" : it.call.agent;
    const by: AgentEvent["by"] = it.kind === "event" ? it.event.by : "ai";
    const last = blocks[blocks.length - 1];
    // A "You" step always stands on its own; otherwise consecutive steps by the same agent share a block.
    if (last && last.station === station && by !== "you" && last.by !== "you") {
      last.items.push(it);
      if (by === "ai") last.by = "ai";
      else if (!last.by) last.by = by;
    } else blocks.push({ station, by, items: [it] });
  }
  return blocks;
}

export function AgentRoom({
  events,
  calls,
  running,
  compact = false,
  title = "Agent room",
}: {
  events: AgentEvent[];
  calls: LiveAgentCall[];
  running: boolean;
  /** Narrow side-panel layout. */
  compact?: boolean;
  title?: string;
}) {
  const blocks = React.useMemo(() => buildBlocks(events, calls), [events, calls]);
  const endRef = React.useRef<HTMLLIElement>(null);
  const count = events.length + calls.length;
  React.useEffect(() => {
    if (running) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count, running]);
  const lastCallId = calls[calls.length - 1]?.callId;

  return (
    <section className="rounded-2xl border border-rule bg-card shadow-card" aria-labelledby="room-h">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-3">
        <h2 id="room-h" className="text-[0.98rem] font-extrabold text-ink">
          {title}
        </h2>
        <p className="flex items-center gap-2 text-[0.8rem] text-ink-3">
          {running ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-tint px-2.5 py-1 font-bold text-accent">
              <span className="live-dot" aria-hidden /> Live
            </span>
          ) : (
            <span>{count} steps, in order</span>
          )}
        </p>
      </div>
      <ol className={cn("space-y-4 overflow-y-auto px-4 py-4", compact ? "max-h-[32rem]" : "max-h-[40rem]")} aria-live="polite" aria-relevant="additions">
        {blocks.map((b, bi) => {
          const Icon = b.by === "you" ? Hand : ICON[b.station];
          const info = AGENTS[b.station];
          const by = b.by ?? (info.kind === "code" ? "code" : "ai");
          const isLast = bi === blocks.length - 1;
          const busy = running && isLast;
          return (
            <li key={`${b.station}-${b.items[0].at}-${bi}`} className="fade-up relative flex gap-3" ref={isLast ? endRef : undefined}>
              {!isLast ? <span className="absolute left-[15px] top-9 h-[calc(100%-1.25rem)] w-px bg-rule" aria-hidden /> : null}
              <span className={cn("relative mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border", busy ? "agent-live border-accent bg-accent-tint text-accent" : by === "ai" ? "border-transparent bg-neutral-tint text-neutral" : by === "you" ? "border-transparent bg-accent-tint text-accent" : "border-transparent bg-paper-2 text-ink-2")}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[0.92rem] font-extrabold text-ink">{by === "you" ? "You" : info.name}</span>
                  {by !== "you" ? <span className={cn("rounded-full px-2 py-0.5 text-[0.72rem] font-bold leading-none", BY[by].cls)}>{BY[by].label}</span> : null}
                  {!compact && by !== "you" ? <span className="text-[0.8rem] text-ink-3">{info.role}</span> : null}
                  <time className="ml-auto text-[0.75rem] text-ink-3 tabular" dateTime={new Date(b.items[0].at).toISOString()}>
                    {new Date(b.items[0].at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </time>
                </p>
                <div className="mt-1 space-y-1.5">
                  {b.items.map((it, ii) =>
                    it.kind === "event" ? (
                      <div key={`e-${ii}`}>
                        <p className={cn("text-[0.92rem] leading-snug", TONE[it.event.tone ?? "info"], it.event.tone === "ok" && "font-semibold")}>{it.event.message}</p>
                        {it.event.detail?.length ? (
                          <ul className="mt-1 space-y-0.5 border-l-2 border-rule pl-3">
                            {it.event.detail.map((d, di) => (
                              <li key={di} className="text-[0.84rem] leading-snug text-ink-2 [overflow-wrap:anywhere]">
                                {d}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : (
                      <CallConsole key={it.call.callId} call={it.call} defaultOpen={!compact && it.call.callId === lastCallId && running} />
                    ),
                  )}
                </div>
              </div>
            </li>
          );
        })}
        {!blocks.length ? <li className="text-[0.9rem] text-ink-3">Each agent&apos;s work appears here, step by step, as it happens.</li> : null}
      </ol>
    </section>
  );
}
