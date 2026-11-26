import * as React from "react";
import { CircleCheck, OctagonX, LoaderCircle, TriangleExclamationPoint, FileText, Lightbulb, SearchX, CircleDot } from "lucide-react";
import { CLAIM_LABELS, RECORD_STATUS, type Tone } from "@/shared/labels";
import type { ClaimLabel, RecordStatus } from "@/shared/types";
import { cn, stampDate } from "@/lib/utils";

export const toneText: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-neutral",
  pending: "text-pending",
};
export const toneChip: Record<Tone, string> = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  danger: "bg-danger-tint text-danger",
  info: "bg-info-tint text-info",
  neutral: "bg-neutral-tint text-neutral",
  pending: "bg-pending-tint text-pending",
};

export function StatusIcon({ status, className }: { status: RecordStatus; className?: string }) {
  const c = cn("size-4 shrink-0", className);
  if (status === "verified") return <CircleCheck className={c} aria-hidden />;
  if (status === "check") return <TriangleExclamationPoint className={c} aria-hidden />;
  if (status === "mismatch") return <OctagonX className={c} aria-hidden />;
  return <LoaderCircle className={cn(c, "animate-spin")} aria-hidden />;
}

/** Status chip for tables and lists: icon + word, never colour alone. */
export function StatusChip({ status, className, label, tone }: { status: RecordStatus; className?: string; label?: string; tone?: Tone }) {
  const info = { ...RECORD_STATUS[status], tone: tone ?? RECORD_STATUS[status].tone };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.8rem] font-bold leading-none", toneChip[info.tone], className)}>
      <StatusIcon status={status} className="size-3.5" />
      {label ?? info.name}
    </span>
  );
}

export function ClaimIcon({ label, className }: { label: ClaimLabel; className?: string }) {
  const c = cn("size-4 shrink-0", className);
  if (label === "verified") return <CircleCheck className={c} aria-hidden />;
  if (label === "reported") return <FileText className={c} aria-hidden />;
  if (label === "reasoning") return <Lightbulb className={c} aria-hidden />;
  return <SearchX className={c} aria-hidden />;
}

export function ClaimChip({ label, className, compact }: { label: ClaimLabel; className?: string; compact?: boolean }) {
  const info = CLAIM_LABELS[label];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.78rem] font-bold leading-none", toneChip[info.tone], className)}>
      <ClaimIcon label={label} className="size-3.5" />
      {compact ? info.short : info.name}
    </span>
  );
}

/** The rubber stamp. `land` plays the press animation once (the signature moment). */
export function Stamp({ status, date, land = false, size = "md", className, word, tone }: { status: RecordStatus; date?: string | null; land?: boolean; size?: "sm" | "md" | "lg"; className?: string; word?: string; tone?: Tone }) {
  if (status === "pending") {
    return (
      <span className={cn("inline-flex items-center gap-2 rounded-lg border border-dashed border-rule-strong px-3 py-2 text-[0.8rem] font-semibold text-ink-3", className)}>
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        Checking
      </span>
    );
  }
  const info = { ...RECORD_STATUS[status], tone: tone ?? RECORD_STATUS[status].tone };
  return (
    <span className={cn("relative inline-flex", className)} role="img" aria-label={`${word ?? info.name}${date ? `, ${stampDate(date)}` : ""}`}>
      {land ? <span aria-hidden className="stamp-ring pointer-events-none absolute inset-0 rounded-lg border-2" style={{ borderColor: `var(--${info.tone}-stamp)` }} /> : null}
      <span className={cn("stamp", land && "stamp-land", size === "lg" && "scale-125", size === "sm" && "scale-[0.85]")} data-tone={info.tone} aria-hidden>
        <span className="stamp-word">{word ?? info.stamp}</span>
        {date ? <span className="stamp-date">{stampDate(date)}</span> : null}
      </span>
    </span>
  );
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <CircleDot className={cn("size-3.5", toneText[tone], className)} aria-hidden />;
}
