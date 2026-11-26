"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ExternalLink, BookOpen, Unlock, Check, CheckCheck } from "lucide-react";
import type { RunDTO } from "@/server/services/research";
import type { SourceCandidate } from "@/shared/types";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status";
import { Tip } from "@/components/ui/overlay";
import { cn, cslAuthors, cslVenue, cslYear, plural } from "@/lib/utils";
import { PdfUpload } from "./pdf-upload";
import { SourceMix } from "./source-mix";
import { trustLabel } from "@/shared/labels";
import { TrustLegend } from "@/components/ui/trust-legend";
import { findQuote, quotedPassages } from "@/shared/requests";

const REL = {
  high: { label: "Highly relevant", cls: "bg-ok-tint text-ok" },
  medium: { label: "Related", cls: "bg-info-tint text-info" },
  low: { label: "Off-topic", cls: "bg-pending-tint text-pending" },
} as const;

/**
 * Names the question mentions (runs of capitalised words or years, such as an event or a place)
 * that no source mentions anywhere in its title or abstract. If the thing asked about is in no
 * source, the honest answer to the question is "Not found", however many related studies exist.
 */
export function missingNames(question: string, sources: SourceCandidate[]): string[] {
  const names = [...new Set((question.match(/(?:\b[A-Z][A-Za-z0-9'’-]*|\b\d{4})(?:\s+(?:[A-Z][A-Za-z0-9'’-]*|\d{4}))+/g) ?? []).map((n) => n.trim()))];
  const hay = sources.map((x) => `${x.csl.title ?? ""} ${x.csl.abstract ?? ""}`.toLowerCase()).join("\n");
  return names.filter((n) => {
    const core = n.replace(/\b\d{4}\b/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    return core.length >= 4 && !hay.includes(core);
  });
}

function SourceRow({ c, checked, onToggle, disabled, suggested, byAi }: { c: SourceCandidate; checked: boolean; onToggle: () => void; disabled: boolean; suggested: boolean; byAi: boolean }) {
  const [open, setOpen] = React.useState(false);
  const v = c.verification;
  const retracted = v?.flags.some((f) => f.code === "retracted");
  const preprint = v?.flags.some((f) => f.code === "preprint");
  const year = cslYear(c.csl);
  const venue = cslVenue(c.csl);
  return (
    <li className={cn("rounded-2xl border bg-card shadow-card transition-colors", checked ? "border-accent" : "border-rule")}>
      <div className="flex gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-record text-[0.8rem] font-bold text-ink-3">{c.id}</span>
            {v ? <StatusChip status={v.status} label={trustLabel(v.status, v.reasonCode, v.flags).name} tone={trustLabel(v.status, v.reasonCode, v.flags).tone} /> : null}
            {suggested ? <span className="rounded-full bg-neutral-tint px-2.5 py-1 text-[0.78rem] font-bold leading-none text-neutral">{byAi ? "AI suggestion" : "Suggested"}</span> : null}
            {c.relevance ? (
              <Tip content={c.relevanceReason ?? ""}>
                <span tabIndex={0} className={cn("rounded-full px-2.5 py-1 text-[0.78rem] font-bold leading-none", REL[c.relevance].cls)}>{REL[c.relevance].label}</span>
              </Tip>
            ) : null}
            {c.origin === "upload" ? <span className="rounded-full bg-accent-tint px-2.5 py-1 text-[0.78rem] font-bold leading-none text-accent">Your PDF · {c.uploadName}</span> : null}
            {c.fullTextAvailable && c.origin !== "upload" ? (
              <Tip content={`The open-access full text can be read (${c.fullTextSource ?? "open access"}), so sentences are checked against the paper itself, not only its abstract.`}>
                <span tabIndex={0} className="rounded-full bg-ok-tint px-2.5 py-1 text-[0.78rem] font-bold leading-none text-ok">Full text</span>
              </Tip>
            ) : null}
            {retracted ? <span className="rounded-full bg-danger-tint px-2.5 py-1 text-[0.78rem] font-bold leading-none text-danger">Retracted</span> : null}
            {preprint ? <span className="rounded-full bg-warn-tint px-2.5 py-1 text-[0.78rem] font-bold leading-none text-warn">Preprint</span> : null}
            {!c.abstractAvailable ? (
              <Tip content="No abstract is available, so no sentence can be checked against this source.">
                <span tabIndex={0} className="rounded-full bg-paper-2 px-2.5 py-1 text-[0.78rem] font-bold leading-none text-ink-3">No abstract</span>
              </Tip>
            ) : null}
          </div>
          <p className="mt-1.5 font-bold leading-snug text-ink">{c.csl.title}</p>
          <p className="mt-0.5 text-[0.88rem] text-ink-2">
            {cslAuthors(c.csl)}
            {year ? ` · ${year}` : ""}
            {venue ? ` · ${venue}` : ""}
            {typeof c.citedByCount === "number" ? <span className="tabular"> · cited {c.citedByCount.toLocaleString()} times</span> : null}
          </p>
          {c.relevanceReason ? <p className="mt-1 text-[0.85rem] text-ink-3">{c.relevanceReason}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {c.csl.abstract ? (
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-[0.85rem] font-semibold text-accent hover:text-accent-hover">
                <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
                {open ? "Hide abstract" : "Read abstract"}
              </button>
            ) : null}
            {c.csl.DOI ? (
              <a href={`https://doi.org/${c.csl.DOI}`} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-record text-[0.8rem] text-ink-3 [overflow-wrap:anywhere] hover:text-accent">
                doi:{c.csl.DOI} <ExternalLink className="size-3" aria-hidden />
              </a>
            ) : null}
            {c.openAccessUrl ? (
              <a href={c.openAccessUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.8rem] font-semibold text-ok hover:underline">
                <Unlock className="size-3.5" aria-hidden /> Free to read
              </a>
            ) : null}
          </div>
          {open && c.csl.abstract ? <p className="fade-up mt-2 rounded-lg bg-paper px-3 py-2 text-[0.9rem] leading-relaxed text-ink-2">{c.csl.abstract}</p> : null}
          <div className="mt-3">
            <Button type="button" variant={checked ? "primary" : "secondary"} aria-pressed={checked} onClick={onToggle} disabled={disabled && !checked} aria-label={`${checked ? "Approved" : "Approve"}: ${c.csl.title}`}>
              {checked ? <Check className="size-4" aria-hidden /> : null}
              {checked ? "Approved" : "Approve this source"}
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

export function SourcesStep({
  run,
  busy,
  maxSources,
  onApprove,
  onBack,
  onUploaded,
}: {
  run: RunDTO;
  busy: boolean;
  maxSources: number;
  onApprove: (ids: string[]) => void;
  onBack: () => void;
  onUploaded: (run: RunDTO) => void;
}) {
  // At this checkpoint "accepted" is only a recommendation. Nothing is approved until the student clicks.
  const reviewing = run.state === "sources_review";
  const suggestedIds = reviewing ? run.sources.filter((s) => s.accepted && s.origin !== "upload").map((s) => s.id) : [];
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set(reviewing ? [] : run.sources.filter((s) => s.accepted).map((s) => s.id)));
  const report = run.searchReport;
  const missing = missingNames(run.question, run.sources);
  // A quotation in the request is looked for, word for word, in what the sources say. It is never confirmed on trust.
  const quoteChecks = quotedPassages(run.question).map((q) => ({ quote: q, at: findQuote(q, run.sources.map((x) => `${x.csl.title ?? ""}. ${x.csl.abstract ?? ""}`)) }));
  const chosen = run.sources.filter((s) => picked.has(s.id));
  const withAbstract = chosen.filter((s) => s.abstractAvailable).length;
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-5 pb-4">
      {report ? (
        <section className="rounded-2xl border border-rule bg-card px-5 py-4 shadow-card" aria-labelledby="report-h">
          <h2 id="report-h" className="sr-only">Search report</h2>
          <p className="text-[0.95rem] text-ink-2">
            {report.totalFound} results from {new Set(report.queries.map((q) => q.adapter)).size} database{new Set(report.queries.map((q) => q.adapter)).size === 1 ? "" : "s"}, {report.afterDedupe} unique. The {run.sources.length} most relevant were checked by the Verifier: <strong className="text-ink">{report.verified} are verified real records</strong>.
          </p>
          <details className="mt-2">
          <summary className="cursor-pointer text-[0.88rem] font-semibold text-accent hover:text-accent-hover">Show the {report.queries.length} searches and what was left out</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-[0.85rem]">
              <caption className="sr-only">Searches run</caption>
              <thead className="text-[0.75rem] text-ink-3">
                <tr>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Search</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Database</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">Results</th>
                </tr>
              </thead>
              <tbody>
                {report.queries.map((q, i) => (
                  <tr key={i} className="border-t border-rule">
                    <td className="py-1.5 pr-3 font-record text-ink-2">{q.text}</td>
                    <td className="py-1.5 pr-3 text-ink-2">{q.adapter}</td>
                    <td className={cn("py-1.5 text-right tabular", q.error ? "text-warn" : "text-ink")}>{q.error ? "no answer" : q.results}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.dropped.length ? <p className="mt-3 text-[0.85rem] text-ink-3">Left out: {report.dropped.map((d) => `${d.count} × ${d.reason.toLowerCase()}`).join(" · ")}.</p> : null}
          </details>
        </section>
      ) : null}

      {quoteChecks.map((c) =>
        c.at < 0 ? (
          <div key={c.quote} className="rounded-2xl border border-[color-mix(in_oklab,var(--warn)_35%,var(--rule))] bg-warn-tint px-5 py-4" role="status">
            <p className="text-[1.05rem] font-bold text-warn">Quote not found</p>
            <p className="mt-1 text-[0.95rem] text-ink-2">
              The words “{c.quote.slice(0, 200)}” do not appear in the title or abstract of any of the {run.sources.length} sources found. The full text was not available to check here, so this quote is not confirmed. Do not use it as a quotation unless you find it in the source yourself.
            </p>
          </div>
        ) : (
          <div key={c.quote} className="rounded-2xl border border-rule bg-ok-tint px-5 py-4" role="status">
            <p className="text-[1.05rem] font-bold text-ok">Quote found</p>
            <p className="mt-1 text-[0.95rem] text-ink-2">
              These exact words appear in {run.sources[c.at].id}: “{run.sources[c.at].csl.title}”. Read them in context before you quote them.
            </p>
          </div>
        ),
      )}

      {missing.length ? (
        <div className="rounded-2xl border border-[color-mix(in_oklab,var(--warn)_35%,var(--rule))] bg-warn-tint px-5 py-4" role="status">
          <p className="text-[1.05rem] font-bold text-warn">Not found</p>
          <p className="mt-1 text-[0.95rem] text-ink-2">
            No source in the databases mentions {missing.map((n) => `“${n}”`).join(" or ")}, so no study answers your question as you asked it. Nothing was invented to fill the gap.
            {run.sources.length ? " The sources below are related real studies. Each one was checked and is labelled; approve one only if a related study is useful to you." : ""}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[1.05rem] font-bold text-ink">Choose the sources to summarise</h2>
          <p className="text-[0.9rem] text-ink-2">Nothing is added until you approve it. Sources marked {run.mode === "ai" ? "“AI suggestion”" : "“Suggested”"} are recommended because they are relevant, verified and have an abstract. Approved sources go into your reference list. Up to {maxSources} by your policy.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[0.9rem] font-semibold text-ink-2 tabular" aria-live="polite">
            {chosen.length} of {maxSources} approved
          </p>
          {suggestedIds.some((id) => !picked.has(id)) ? (
            <Button type="button" variant="secondary" onClick={() => setPicked((p) => new Set([...p, ...suggestedIds].slice(0, maxSources)))}>
              <CheckCheck className="size-4" aria-hidden /> Approve the {plural(suggestedIds.length, "suggestion")}
            </Button>
          ) : null}
          <PdfUpload
            runId={run.id}
            onAdded={(next) => {
              // Your own PDF is listed like any other source: it still needs your approval click.
              onUploaded(next);
            }}
          />
        </div>
      </div>

      {run.sources.length && !run.sources.some((s) => s.relevance === "high" || s.relevance === "medium") ? (
        <div className="rounded-2xl border border-[color-mix(in_oklab,var(--warn)_35%,var(--rule))] bg-warn-tint px-5 py-4">
          <p className="font-bold text-warn">Nothing clearly relevant was found</p>
          <p className="mt-1 text-[0.92rem] text-ink-2">The sources below are real, but none is clearly about your question, so none is suggested. That is an honest result: go back and reword the searches, or add your own PDF.</p>
        </div>
      ) : null}

      <TrustLegend show={["references", "suggestion"]} />

      <SourceMix chosen={chosen} />

      {run.sources.length ? (
        <ul className="space-y-3">
          {run.sources.map((c) => (
            <SourceRow key={c.id} c={c} checked={picked.has(c.id)} onToggle={() => toggle(c.id)} disabled={picked.size >= maxSources} suggested={suggestedIds.includes(c.id)} byAi={run.mode === "ai"} />
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-rule-strong px-6 py-10 text-center text-ink-2">
          <BookOpen className="mx-auto mb-3 size-7 text-ink-3" aria-hidden />
          No verified sources were found. An honest “not found” is better than a guess. Go back and broaden the searches.
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-t-2xl border border-b-0 border-rule bg-card px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(17_24_39/0.25)]">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft className="size-4" aria-hidden /> Back to the plan
        </Button>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          {!chosen.length ? <span className="text-[0.85rem] font-semibold text-ink-3">Approve at least one source to continue.</span> : null}
          {chosen.length && !withAbstract ? <span className="text-[0.85rem] font-semibold text-warn">Approve at least one source with an abstract.</span> : null}
          <Button variant="primary" size="lg" onClick={() => onApprove([...picked])} loading={busy} disabled={!chosen.length || !withAbstract}>
            Write from {plural(chosen.length, "approved source")} <ArrowRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
