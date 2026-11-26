"use client";

import * as React from "react";
import { Plus, Trash, ArrowRight, Info, ShieldAlert } from "lucide-react";
import type { RunDTO } from "@/server/services/research";
import type { PlanQuery } from "@/shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function PlanStep({ run, busy, onApprove }: { run: RunDTO; busy: boolean; onApprove: (queries: PlanQuery[]) => void }) {
  const plan = run.plan!;
  const [queries, setQueries] = React.useState<PlanQuery[]>(plan.queries);
  const enabled = queries.filter((q) => q.enabled && q.text.trim().length >= 2).length;
  const update = (i: number, patch: Partial<PlanQuery>) => setQueries((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  return (
    <div className="space-y-5">
      {plan.integrityNote ? (
        <Notice tone="neutral" icon={<ShieldAlert className="size-5" />} title="A note on academic integrity">
          {plan.integrityNote}
        </Notice>
      ) : null}

      <section className="rounded-2xl border border-rule bg-card p-5 shadow-card" aria-labelledby="plan-q">
        <h2 id="plan-q" className="text-[1.05rem] font-bold text-ink">Search plan</h2>
        <p className="mt-1.5 text-[1.05rem] leading-snug text-ink-2">
          <span className="font-semibold text-ink">In neutral words:</span> {plan.restatedQuestion}
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-[0.85rem] font-semibold text-ink-3">Sub-questions</h3>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[0.95rem] text-ink-2">
              {plan.subQuestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-[0.85rem] font-semibold text-ink-3">Key concepts</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {plan.keyConcepts.map((k) => (
                <span key={k} className="rounded-md bg-paper-2 px-2 py-1 text-[0.85rem] font-semibold text-ink-2">{k}</span>
              ))}
            </div>
            {plan.include.length || plan.exclude.length ? (
              <p className="mt-3 text-[0.88rem] text-ink-2">
                {plan.include.length ? <><strong className="text-ink">Include:</strong> {plan.include.join("; ")}. </> : null}
                {plan.exclude.length ? <><strong className="text-ink">Exclude:</strong> {plan.exclude.join("; ")}.</> : null}
              </p>
            ) : null}
          </div>
        </div>
        {plan.assumptions.length ? (
          <p className="mt-4 flex items-start gap-2 text-[0.88rem] text-ink-3">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            Assumed: {plan.assumptions.join(" · ")}
          </p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-rule bg-card p-5 shadow-card" aria-labelledby="plan-searches">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="plan-searches" className="text-[1.05rem] font-bold text-ink">Searches to run</h2>
            <p className="text-[0.88rem] text-ink-2">In {plan.sources.join(" and ")}. Edit, switch off or add searches. Nothing runs until you approve.</p>
          </div>
        </div>
        <ul className="mt-4 space-y-2.5">
          {queries.map((q, i) => (
            <li key={q.id} className={cn("rounded-xl border px-3 py-3", q.enabled ? "border-rule bg-card-2" : "border-dashed border-rule-strong bg-transparent opacity-70")}>
              <div className="flex flex-wrap items-center gap-2.5">
                <label className="inline-flex cursor-pointer items-center gap-2 text-[0.85rem] font-semibold text-ink-2">
                  <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={q.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                  <span className="font-record tabular">{q.id}</span>
                </label>
                <Input aria-label={`Search ${q.id}`} value={q.text} onChange={(e) => update(i, { text: e.target.value })} className="h-9 min-w-0 flex-1 font-record" maxLength={120} />
                <Input
                  aria-label={`From year for ${q.id}`}
                  type="number"
                  placeholder="From year"
                  value={q.fromYear ?? ""}
                  onChange={(e) => update(i, { fromYear: e.target.value ? Number(e.target.value) : null })}
                  className="h-9 w-28 tabular"
                  min={1800}
                  max={2100}
                />
                <Button variant="ghost" size="icon" aria-label={`Delete search ${q.id}`} onClick={() => setQueries((qs) => qs.filter((_, j) => j !== i))} disabled={queries.length <= 1}>
                  <Trash className="size-4" />
                </Button>
              </div>
              <p className="mt-1.5 pl-7 text-[0.82rem] text-ink-3">{q.purpose}</p>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={queries.length >= 8}
            onClick={() => setQueries((qs) => [...qs, { id: `Q${Math.max(0, ...qs.map((q) => Number(q.id.slice(1)) || 0)) + 1}`, text: "", purpose: "Added by you", enabled: true, fromYear: null, toYear: null }])}
          >
            <Plus className="size-4" aria-hidden /> Add a search
          </Button>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" onClick={() => onApprove(queries)} loading={busy} disabled={!enabled}>
          Approve plan and search <ArrowRight className="size-4" aria-hidden />
        </Button>
        <p className="text-[0.88rem] text-ink-3">Checkpoint 1 of 3 · {enabled} search{enabled === 1 ? "" : "es"} will run</p>
      </div>
    </div>
  );
}
