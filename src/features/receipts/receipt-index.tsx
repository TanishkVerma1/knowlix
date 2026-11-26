"use client";

import Link from "next/link";
import { ScrollText, ChevronRight } from "lucide-react";
import { useAudits, useRuns } from "@/features/home/recent";
import { Skeleton, EmptyState } from "@/components/ui/misc";
import { relativeTime } from "@/lib/utils";

export function ReceiptIndex() {
  const audits = useAudits();
  const runs = useRuns();
  if (audits.isLoading || runs.isLoading) return <Skeleton className="h-40" />;
  const rows = [
    ...(audits.data?.audits ?? []).map((a) => ({ href: `/receipts/audit/${a.id}`, title: a.title, kind: "Citation Audit", at: a.createdAt })),
    ...(runs.data?.runs ?? []).map((r) => ({ href: `/receipts/run/${r.id}`, title: r.question, kind: "Research run", at: r.createdAt })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (!rows.length) {
    return (
      <EmptyState icon={<ScrollText className="size-9" />} title="No receipts yet">
        Every Citation Audit and research run gets a receipt you can print or share with a supervisor.
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.href}>
          <Link href={r.href} className="group flex items-center gap-4 rounded-xl border border-rule bg-card px-4 py-3 hover:border-rule-strong hover:shadow-card">
            <ScrollText className="size-5 shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{r.title}</span>
              <span className="text-[0.82rem] text-ink-3">{r.kind} · {relativeTime(r.at)}</span>
            </span>
            <ChevronRight className="size-5 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
