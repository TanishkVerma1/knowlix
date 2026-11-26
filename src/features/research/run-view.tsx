"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Cpu, FileSearch, LoaderCircle, ScrollText, Send } from "lucide-react";
import { useRun } from "./use-run";
import { AgentRoom, Pipeline, modelLabel } from "./agent-room";
import { PlanStep } from "./plan-step";
import { SourcesStep } from "./sources-step";
import { SummaryStep } from "./summary-step";
import { ExportStep } from "./export-step";
import { AiCallsSheet, useAiCalls } from "./ai-calls";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { RegisterRule } from "@/components/shell/app-shell";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { StatusChip } from "@/components/ui/status";
import { errorMessage } from "@/lib/api";
import { cn, cslYear } from "@/lib/utils";
import type { LiveAgentCall } from "@/shared/types";

/** What the student is waiting for, in one line, above the live agent room. */
function NowWorking({ title, status, children }: { title: string; status?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-2xl border border-accent bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <LoaderCircle className="size-5 shrink-0 animate-spin text-accent" aria-hidden />
        <h2 className="text-[1.08rem] font-extrabold text-ink">{title}</h2>
        {status ? (
          <p className="ml-auto font-bold text-accent tabular" aria-live="polite">
            {status}
          </p>
        ) : null}
      </div>
      <div className="sweep mt-3 h-1 rounded-full bg-paper-2" aria-hidden />
      {children}
    </div>
  );
}

export function RunView() {
  const { id } = useParams<{ id: string }>();
  const { query, run, live, action, setRun } = useRun(id);
  const session = useSession();
  const [callsOpen, setCallsOpen] = React.useState(false);
  const policy = session.data?.policy;
  const stored = useAiCalls(id, Boolean(query.data && query.data.aiCalls > 0));
  // Stored AI calls from finished steps, in the same shape as the live ones.
  const pastCalls = React.useMemo<LiveAgentCall[]>(
    () =>
      (stored.data?.calls ?? []).map((c) => ({
        callId: c.id,
        agent: c.agent as LiveAgentCall["agent"],
        name: c.agent,
        promptVersion: c.promptVersion,
        task: "",
        sentChars: c.sent.system.length + c.sent.user.length,
        attempt: 1,
        provider: c.provider,
        model: c.model,
        text: c.received ?? "",
        status: c.ok ? "done" : "failed",
        latencyMs: c.latencyMs,
        error: c.error,
        startedAt: new Date(new Date(c.createdAt).getTime() - c.latencyMs).toISOString(),
      })),
    [stored.data],
  );

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-16" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (!run) {
    return (
      <EmptyState title="This research run could not be opened" action={<Button asChild variant="secondary"><Link href="/research">Back to Research</Link></Button>}>
        {errorMessage(query.error)}
      </EmptyState>
    );
  }

  const busy = action.isPending;
  const wide = run.state === "summary_review" || run.state === "approved";
  const working = run.state === "planning" || run.state === "searching" || run.state === "writing";
  const aiActive = run.mode === "ai" || run.aiCalls > 0;
  const events = [...run.events, ...live.events.filter((e) => !run.events.some((r) => r.at === e.at && r.message === e.message))];
  const calls = [...pastCalls, ...live.calls];
  const ai = session.data?.ai;
  const aiName = ai?.active ? modelLabel(ai.active.id, ai.active.model) : null;

  return (
    <div>
      <Link href="/research" className="mb-4 inline-flex items-center gap-1.5 text-[0.9rem] font-semibold text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All research
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-[52rem]">
          <h1 className="text-[1.5rem] font-extrabold leading-[1.14] text-ink sm:text-[1.8rem]">{run.question}</h1>
          <p className="mt-2 inline-flex items-center gap-2 text-[0.88rem] font-semibold">
            {run.mode === "ai" ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-tint px-2.5 py-1 text-neutral">
                <Cpu className="size-4" aria-hidden /> Live AI agents{aiName ? ` · ${aiName}` : ""} · every sentence checked
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-warn-tint px-2.5 py-1 text-warn">
                <FileSearch className="size-4" aria-hidden /> No-AI mode: rules and exact quotes, no AI model is running
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {aiActive ? (
            <Button variant="secondary" onClick={() => setCallsOpen(true)}>
              <Send className="size-4" aria-hidden /> Sent to the AI{run.aiCalls ? ` (${run.aiCalls})` : ""}
            </Button>
          ) : null}
          <Button variant="ghost" asChild>
            <Link href={`/receipts/run/${run.id}`}>
              <ScrollText className="size-4" aria-hidden /> Receipt
            </Link>
          </Button>
        </div>
      </div>

      <RegisterRule className="mt-4" />
      <div className="mt-5">
        <Pipeline state={run.state} mode={run.mode} liveEvents={live.events} calls={live.calls} />
      </div>

      {working ? (
        <div className="mt-6">
          {run.state === "planning" ? (
            <NowWorking title={run.mode === "ai" ? "The Planner is turning your question into a search plan" : "Building a keyword search plan"}>
              <p className="mt-2 text-[0.92rem] text-ink-2">Nothing is searched until you approve the plan.</p>
            </NowWorking>
          ) : null}
          {run.state === "searching" ? (
            <NowWorking
              title="The Finder is searching, the Verifier is checking each result"
              status={(() => {
                const searched = live.events.filter((e) => e.agent === "finder" && e.message.startsWith("Searching ")).length;
                const total = (run.plan?.queries.filter((q) => q.enabled).length ?? 0) * (run.plan?.sources.length ?? 1);
                return live.candidates.length ? `${live.candidates.length} sources checked so far` : `Searched ${Math.min(searched, total)} of ${total}`;
              })()}
            >
              <p className="mt-2 text-[0.92rem] text-ink-2">Every candidate is checked against doi.org, Crossref and OpenAlex before you see it. That check is code, not AI.</p>
              {live.candidates.length ? (
                <ul className="mt-3 grid gap-2 lg:grid-cols-2">
                  {live.candidates.map((c) => (
                    <li key={c.id} className="fade-up flex items-center gap-3 rounded-xl border border-rule bg-card-2 px-3 py-2">
                      {c.verification ? <StatusChip status={c.verification.status} /> : null}
                      <span className="min-w-0 flex-1 truncate text-[0.9rem] text-ink">{c.csl.title}</span>
                      <span className="shrink-0 text-[0.8rem] text-ink-3 tabular">{cslYear(c.csl) ?? ""}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </NowWorking>
          ) : null}
          {run.state === "writing" ? (
            <NowWorking title={run.mode === "ai" ? "Writer, Checker, Judge and Critic are at work" : "Selecting exact quotes"}>
              <p className="mt-2 text-[0.92rem] text-ink-2">
                {run.mode === "ai"
                  ? "The Writer may cite passage numbers only. Code then checks every quote, number, year and name; the Judge gives one of four fixed answers; a failed sentence gets one rewrite and is then removed."
                  : "Quoting the most relevant passage from each source, word for word."}
              </p>
            </NowWorking>
          ) : null}
          <AgentRoom events={events} calls={calls} running title="Agent room: watch the work happen" />
          {ai?.active?.local && run.mode === "ai" ? (
            <p className="mt-3 text-[0.85rem] text-ink-3">
              The AI model is running on this computer, so nothing leaves it, but answers are typed slowly. Add a free cloud key in Settings for answers in seconds.
            </p>
          ) : null}
        </div>
      ) : (
        <div className={cn("mt-6 grid gap-6", wide ? "" : "xl:grid-cols-[minmax(0,1fr)_24rem]")}>
          <div className="min-w-0">
            {run.state === "plan_review" && run.plan ? (
              <PlanStep run={run} busy={busy} onApprove={(queries) => action.mutate({ path: "plan", body: { queries, approve: true } })} />
            ) : null}

            {run.state === "sources_review" ? (
              <SourcesStep
                run={run}
                busy={busy}
                maxSources={policy?.maxSources ?? 8}
                onApprove={(ids) => action.mutate({ path: "sources", body: { accepted: ids } })}
                onBack={() => action.mutate({ path: "back", body: { to: "plan" } })}
                onUploaded={(next) => setRun(next)}
              />
            ) : null}

            {run.state === "summary_review" && run.draft ? (
              <SummaryStep
                run={run}
                busy={busy}
                allowOverrides={policy?.allowOverrides ?? true}
                onApprove={() => action.mutate({ path: "approve" })}
                onBack={() => action.mutate({ path: "back", body: { to: "sources" } })}
                onSentence={(sid, act, reason) => action.mutateAsync({ path: `sentences/${sid}`, body: { action: act, reason } })}
              />
            ) : null}

            {run.state === "approved" ? <ExportStep run={run} defaultStyle={policy?.defaultStyle ?? "apa"} /> : null}

            {run.state === "failed" ? (
              <EmptyState title="This run stopped" action={<Button variant="secondary" onClick={() => action.mutate({ path: "back", body: { to: "plan" } })}>Go back to the plan</Button>}>
                {run.error ?? "Something went wrong."}
              </EmptyState>
            ) : null}
          </div>
          <aside className={cn("min-w-0", !wide && "xl:sticky xl:top-6 xl:self-start")}>
            {wide ? (
              <details className="group">
                <summary className="cursor-pointer list-none text-[0.92rem] font-semibold text-ink-2 hover:text-ink">
                  <span className="underline decoration-rule-strong underline-offset-4 group-open:hidden">Show what each agent did ({events.length + calls.length} steps)</span>
                  <span className="hidden underline decoration-rule-strong underline-offset-4 group-open:inline">Hide the agent room</span>
                </summary>
                <div className="mt-3">
                  <AgentRoom events={events} calls={calls} running={false} title="Agent room: what each agent did" />
                </div>
              </details>
            ) : (
              <AgentRoom events={events} calls={calls} running={false} compact title="Agent room" />
            )}
          </aside>
        </div>
      )}

      <AiCallsSheet runId={run.id} open={callsOpen} onOpenChange={setCallsOpen} />
    </div>
  );
}
