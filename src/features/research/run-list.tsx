"use client";

import { RunRow, useRuns } from "@/features/home/recent";
import { Skeleton } from "@/components/ui/misc";

export function RunList() {
  const { data, isLoading } = useRuns();
  if (isLoading) return <Skeleton className="h-[68px]" />;
  if (!data?.runs.length) return <p className="text-[0.95rem] text-ink-2">No research yet. Ask your first question above.</p>;
  return <div className="space-y-2">{data.runs.map((r) => <RunRow key={r.id} r={r} />)}</div>;
}
