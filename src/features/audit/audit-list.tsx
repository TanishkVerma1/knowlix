"use client";

import { AuditRow, useAudits } from "@/features/home/recent";
import { Skeleton } from "@/components/ui/misc";

export function AuditList() {
  const { data, isLoading } = useAudits();
  if (isLoading) return <Skeleton className="h-[68px]" />;
  if (!data?.audits.length) return <p className="text-[0.95rem] text-ink-2">No audits yet. Your first one will appear here.</p>;
  return <div className="space-y-2">{data.audits.map((a) => <AuditRow key={a.id} a={a} />)}</div>;
}
