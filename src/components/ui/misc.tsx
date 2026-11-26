import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-paper-2", className)} aria-hidden />;
}

export function Panel({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-2xl border border-rule bg-card shadow-card", className)} {...props}>
      {children}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      {icon ? <div className="mb-4 text-ink-3">{icon}</div> : null}
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      {children ? <div className="mt-1.5 max-w-md text-[0.95rem] text-ink-2">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children, icon, className }: { tone?: "info" | "warn" | "danger" | "ok" | "neutral"; title?: React.ReactNode; children?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  const tones = {
    info: "bg-info-tint text-info",
    warn: "bg-warn-tint text-warn",
    danger: "bg-danger-tint text-danger",
    ok: "bg-ok-tint text-ok",
    neutral: "bg-neutral-tint text-neutral",
  };
  return (
    <div className={cn("flex gap-3 rounded-lg px-4 py-3", tones[tone], className)} role={tone === "danger" ? "alert" : "status"}>
      {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
      <div className="min-w-0 text-[0.92rem] leading-snug">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "text-ink-2")}>{children}</div> : null}
      </div>
    </div>
  );
}

/** The Knowlix mark: a registrar's seal with a check. Drawn in the current text colour. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="none" stroke="currentColor">
      <circle cx="16" cy="16" r="13.6" strokeWidth="1.7" />
      <circle cx="16" cy="16" r="10.6" strokeWidth="1" strokeDasharray="1.1 1.9" opacity="0.75" />
      <path d="m10.6 16.4 3.6 3.7 7.3-8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SectionTitle({ children, aside, className }: { children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-4", className)}>
      <h2 className="text-[1.05rem] font-bold text-ink">{children}</h2>
      {aside}
    </div>
  );
}
