"use client";

import * as React from "react";
import { CircleCheck, CircleX, Search, TriangleExclamationPoint } from "lucide-react";
import type { RecordStatus } from "@/shared/types";
import { RECORD_STATUS } from "@/shared/labels";
import { StatusChip } from "@/components/ui/status";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BenchCase {
  id: string;
  category: string;
  kind: "real" | "imperfect" | "fake";
  style?: string;
  input: string;
  acceptable: string[];
  got: string;
  score?: number | null;
  reason?: string;
  pass: boolean;
  seriousError?: boolean;
  ms?: number;
}

const KIND: Record<BenchCase["kind"], { label: string; cls: string }> = {
  real: { label: "Real", cls: "bg-ok-tint text-ok" },
  imperfect: { label: "Real, with a slip", cls: "bg-info-tint text-info" },
  fake: { label: "Invented", cls: "bg-danger-tint text-danger" },
};

type Filter = "all" | BenchCase["kind"] | "wrong";

const isStatus = (s: string): s is Exclude<RecordStatus, "pending"> => s === "verified" || s === "check" || s === "mismatch";

/** Every test reference with the stamp it should get and the stamp it got. */
export function CaseBrowser({ cases, categories }: { cases: BenchCase[]; categories: Record<string, string> }) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [find, setFind] = React.useState("");
  const [limit, setLimit] = React.useState(30);
  const wrong = cases.filter((c) => !c.pass).length;

  const shown = React.useMemo(() => {
    const f = find.trim().toLowerCase();
    return cases.filter((c) => (filter === "all" ? true : filter === "wrong" ? !c.pass : c.kind === filter) && (!f || `${c.input} ${categories[c.category] ?? c.category} ${c.reason ?? ""}`.toLowerCase().includes(f)));
  }, [cases, categories, filter, find]);

  const tabs: [Filter, string, number][] = [
    ["all", "All", cases.length],
    ["real", "Real", cases.filter((c) => c.kind === "real").length],
    ["imperfect", "Real, with a slip", cases.filter((c) => c.kind === "imperfect").length],
    ["fake", "Invented", cases.filter((c) => c.kind === "fake").length],
    ["wrong", "Wrong answers", wrong],
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter the test references">
          {tabs.map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => {
                setFilter(id);
                setLimit(30);
              }}
              className={cn("rounded-full border px-3 py-1.5 text-[0.85rem] font-bold transition-colors", filter === id ? "border-accent bg-accent text-accent-ink" : "border-rule bg-card text-ink-2 hover:border-rule-strong")}
            >
              {label} <span className="tabular opacity-80">{n}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input className="pl-9" placeholder="Search the references" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search the test references" />
        </div>
      </div>

      <p className="mt-3 text-[0.85rem] text-ink-3 tabular" aria-live="polite">
        Showing {Math.min(limit, shown.length)} of {shown.length}
      </p>

      <ul className="mt-2 space-y-2">
        {shown.slice(0, limit).map((c) => (
          <li key={c.id} className={cn("rounded-xl border bg-card px-4 py-3", c.pass ? "border-rule" : "border-[color-mix(in_oklab,var(--danger)_40%,var(--rule))]")}>
            <div className="flex flex-wrap items-center gap-2 text-[0.78rem]">
              <span className="font-record font-bold text-ink-3">{c.id}</span>
              <span className={cn("rounded-full px-2 py-0.5 font-bold", KIND[c.kind].cls)}>{KIND[c.kind].label}</span>
              <span className="font-semibold text-ink-2">{categories[c.category] ?? c.category}</span>
              {c.style ? <span className="text-ink-3">· written as {c.style}</span> : null}
              <span className={cn("ml-auto inline-flex items-center gap-1 font-bold", c.pass ? "text-ok" : c.seriousError ? "text-danger" : "text-warn")}>
                {c.pass ? <CircleCheck className="size-4" aria-hidden /> : c.seriousError ? <CircleX className="size-4" aria-hidden /> : <TriangleExclamationPoint className="size-4" aria-hidden />}
                {c.pass ? "Correct" : c.seriousError ? "Serious error" : "Wrong label"}
              </span>
            </div>
            <p className="mt-1.5 font-record text-[0.86rem] leading-relaxed text-ink [overflow-wrap:anywhere]">{c.input}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.84rem] text-ink-2">
              <span>
                Should be: <strong className="text-ink">{c.acceptable.map((a) => (isStatus(a) ? RECORD_STATUS[a].name : a)).join(" or ")}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                Knowlix said: {isStatus(c.got) ? <StatusChip status={c.got} /> : <strong className="text-warn">{c.got === "error" ? "could not check (database did not answer)" : c.got}</strong>}
              </span>
              {typeof c.score === "number" ? <span className="tabular text-ink-3">match {c.score}/100</span> : null}
            </div>
            {c.reason ? <p className="mt-1 text-[0.84rem] text-ink-3">{c.reason}</p> : null}
          </li>
        ))}
      </ul>
      {shown.length > limit ? (
        <Button variant="secondary" className="mt-4" onClick={() => setLimit((l) => l + 60)}>
          Show 60 more
        </Button>
      ) : null}
      {!shown.length ? <p className="mt-6 rounded-xl bg-paper px-4 py-6 text-center text-ink-2">No test reference matches.</p> : null}
    </div>
  );
}
