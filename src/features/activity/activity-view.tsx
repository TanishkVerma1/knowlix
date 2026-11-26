"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldCheck, ShieldX, Hammer, User, Cpu, ShieldHalf, Workflow, Lock } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { relativeTime, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";

interface Entry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  summary: string;
  hash: string;
  prevHash: string;
}

const ACTOR: Record<string, { label: string; Icon: typeof User; cls: string }> = {
  student: { label: "You", Icon: User, cls: "bg-accent-tint text-accent" },
  verifier: { label: "Verifier", Icon: ShieldHalf, cls: "bg-ok-tint text-ok" },
  orchestrator: { label: "Orchestrator", Icon: Workflow, cls: "bg-paper-2 text-ink-2" },
  system: { label: "System", Icon: Workflow, cls: "bg-paper-2 text-ink-2" },
};

function actorInfo(a: string) {
  if (ACTOR[a]) return ACTOR[a];
  const name = a.replace("agent:", "");
  return { label: name.charAt(0).toUpperCase() + name.slice(1), Icon: Cpu, cls: "bg-neutral-tint text-neutral" };
}

export function ActivityView() {
  const q = useQuery({ queryKey: ["activity"], queryFn: () => api<{ chain: { intact: boolean; count: number; head: string; brokenAtSeq: number | null }; entries: Entry[] }>("/api/activity") });
  const tamper = useMutation({ mutationFn: () => api<{ refused: boolean; message: string }>("/api/activity/tamper-test", { body: {} }) });

  if (q.isLoading) return <Skeleton className="h-80" />;
  if (!q.data) return <EmptyState title="The activity log could not be loaded">{errorMessage(q.error)}</EmptyState>;
  const { chain, entries } = q.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cn("rounded-2xl p-5", chain.intact ? "bg-ok-tint" : "bg-danger-tint")}>
          <p className={cn("flex items-center gap-2 text-[1.05rem] font-bold", chain.intact ? "text-ok" : "text-danger")}>
            {chain.intact ? <ShieldCheck className="size-6" aria-hidden /> : <ShieldX className="size-6" aria-hidden />}
            {chain.intact ? "Log intact" : `Chain broken at entry ${chain.brokenAtSeq}`}
          </p>
          <p className="mt-1 text-[0.9rem] text-ink-2">
            Each of the {chain.count} entries contains the fingerprint (SHA-256) of the one before it. Changing any past entry would break every fingerprint after it, and Knowlix re-checks the whole chain each time you open this page.
          </p>
          <p className="mt-2 font-record text-[0.75rem] text-ink-3 [overflow-wrap:anywhere]">Latest fingerprint: {chain.head}</p>
        </div>
        <div className="rounded-2xl border border-rule bg-card p-5 shadow-card">
          <p className="flex items-center gap-2 text-[1.05rem] font-bold text-ink">
            <Lock className="size-5 text-ink-3" aria-hidden /> Append-only, enforced by the database
          </p>
          <p className="mt-1 text-[0.9rem] text-ink-2">A Postgres trigger rejects every edit and deletion of this log, even if Knowlix&rsquo;s own code tried. Ask the database to rewrite history and see what happens:</p>
          <Button variant="secondary" className="mt-3" onClick={() => tamper.mutate()} loading={tamper.isPending}>
            <Hammer className="size-4" aria-hidden /> Try to edit the log
          </Button>
          {tamper.data ? (
            <p className={cn("fade-up mt-3 rounded-lg px-3 py-2 text-[0.9rem] font-semibold", tamper.data.refused ? "bg-ok-tint text-ok" : "bg-danger-tint text-danger")} role="status">
              {tamper.data.refused ? `Refused. ${tamper.data.message}` : tamper.data.message}
            </p>
          ) : null}
        </div>
      </div>

      {entries.length ? (
        <ol className="overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
          {entries.map((e) => {
            const a = actorInfo(e.actor);
            return (
              <li key={e.seq} className="flex gap-4 border-b border-rule px-5 py-3.5 last:border-0">
                <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg", a.cls)}>
                  <a.Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.95rem] text-ink">
                    <span className="font-bold">{a.label}</span> <span className="text-ink-2">· {e.summary}</span>
                  </p>
                  <p className="mt-0.5 text-[0.78rem] text-ink-3">
                    <span className="tabular">#{e.seq}</span> · {relativeTime(e.at)} · <span className="font-record">{e.action}</span> · <span className="font-record">{e.hash.slice(0, 12)}…</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState title="Nothing logged yet">Every check, decision and AI step will be recorded here.</EmptyState>
      )}
    </div>
  );
}
