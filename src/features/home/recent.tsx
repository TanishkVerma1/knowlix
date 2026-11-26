"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Stamp as StampIcon, Telescope, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/utils";
import { Skeleton } from "@/components/ui/misc";
import { StatusChip } from "@/components/ui/status";
import type { AuditSummary } from "@/server/services/audits";

export interface AuditListItem {
  id: string;
  title: string;
  isSample: boolean;
  createdAt: string;
  completedAt: string | null;
  summary: AuditSummary;
}

export interface RunListItem {
  id: string;
  question: string;
  state: string;
  mode: string;
  createdAt: string;
  stats: { verified: number; reported: number; reasoning: number; notFound: number } | null;
  sources: number;
}

const STATE_LABEL: Record<string, string> = {
  planning: "Planning",
  plan_review: "Waiting for you: approve the plan",
  searching: "Searching",
  sources_review: "Waiting for you: choose sources",
  writing: "Writing & checking",
  summary_review: "Waiting for you: review the summary",
  approved: "Approved",
  failed: "Stopped",
};

export function useAudits() {
  return useQuery({ queryKey: ["audits"], queryFn: () => api<{ audits: AuditListItem[] }>("/api/audits") });
}

export function useRuns() {
  return useQuery({ queryKey: ["runs"], queryFn: () => api<{ runs: RunListItem[] }>("/api/research"), retry: false });
}

export function AuditRow({ a }: { a: AuditListItem }) {
  const s = a.summary;
  return (
    <Link href={`/audit/${a.id}`} className="group flex items-center gap-4 rounded-xl border border-rule bg-card px-4 py-3 transition-[border-color,box-shadow] hover:border-rule-strong hover:shadow-card">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-tint text-accent">
        <StampIcon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{a.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.82rem] text-ink-3">
          {s.pending ? <StatusChip status="pending" label={`Checking ${s.pending}`} /> : null}
          {s.verified ? <StatusChip status="verified" label={`Verified ${s.verified}`} /> : null}
          {s.check ? <StatusChip status="check" label={`Please check ${s.check}`} /> : null}
          {s.mismatch ? <StatusChip status="mismatch" label={`Mismatch ${s.mismatch}`} /> : null}
          <span className="ml-1">{relativeTime(a.createdAt)}</span>
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

export function RunRow({ r }: { r: RunListItem }) {
  const waiting = r.state.endsWith("_review");
  return (
    <Link href={`/research/${r.id}`} className="group flex items-center gap-4 rounded-xl border border-rule bg-card px-4 py-3 transition-[border-color,box-shadow] hover:border-rule-strong hover:shadow-card">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-neutral-tint text-neutral">
        <Telescope className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{r.question}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-[0.82rem] text-ink-3">
          <span className={waiting ? "font-semibold text-warn" : ""}>{STATE_LABEL[r.state] ?? r.state}</span>
          {r.sources ? <span>· {r.sources} sources</span> : null}
          <span>· {relativeTime(r.createdAt)}</span>
        </span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

export function RecentWork() {
  const audits = useAudits();
  const runs = useRuns();
  const loading = audits.isLoading || runs.isLoading;
  const items = [
    ...(audits.data?.audits ?? []).map((a) => ({ kind: "audit" as const, at: a.createdAt, a })),
    ...(runs.data?.runs ?? []).map((r) => ({ kind: "run" as const, at: r.createdAt, r })),
  ]
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, 6);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-[68px]" />
        <Skeleton className="h-[68px]" />
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-rule-strong px-5 py-6 text-[0.95rem] text-ink-2">
        Nothing yet. Paste a reference list above, or press <strong className="text-ink">Try a sample list</strong> to watch Knowlix catch invented references.
      </div>
    );
  }
  return <div className="space-y-2">{items.map((i) => (i.kind === "audit" ? <AuditRow key={i.a.id} a={i.a} /> : <RunRow key={i.r.id} r={i.r} />))}</div>;
}
