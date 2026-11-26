"use client";

import * as React from "react";
import { ChevronDown, Replace, Trash, Undo2, PenLine, Flag, Lock, CircleCheck, SearchX, ExternalLink, RefreshCw } from "lucide-react";
import type { AuditItemDTO } from "@/server/services/audits";
import { RECORD_STATUS, trustLabel } from "@/shared/labels";
import { Stamp, StatusIcon, toneText } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/overlay";
import { cn } from "@/lib/utils";
import { AnswerStrip, Evidence, RecordSummary } from "./evidence";
import { explainVerification } from "@/shared/explain";

export type Decision = "replace" | "remove" | "keep" | "undo";

const FORMAT_LABEL: Record<string, string> = {
  apa: "APA",
  mla: "MLA",
  ieee: "IEEE",
  harvard: "Harvard",
  bibtex: "BibTeX",
  ris: "RIS",
  doi: "DOI only",
  isbn: "ISBN only",
  arxiv: "arXiv ID",
  url: "Link",
  text: "Free text",
};

const TONE_RULE: Record<string, string> = {
  ok: "bg-[var(--ok-stamp)]",
  warn: "bg-[var(--warn-stamp)]",
  danger: "bg-[var(--danger-stamp)]",
  pending: "bg-rule-strong",
};

export function RecordCard({
  item,
  landed,
  expanded,
  dimmed,
  busy,
  allowOverrides,
  onToggle,
  onDecide,
  onKeep,
  onReport,
  onRecheck,
}: {
  item: AuditItemDTO;
  landed: boolean;
  expanded: boolean;
  dimmed: boolean;
  busy: boolean;
  allowOverrides: boolean;
  onToggle: () => void;
  onDecide: (d: Decision) => void;
  onKeep: () => void;
  onReport: () => void;
  onRecheck?: () => void;
}) {
  const r = item.result;
  const removed = item.resolution === "removed";
  const replaced = item.resolution === "replaced";
  const kept = item.resolution === "kept";
  const effective = replaced ? "verified" : item.status;
  const tone = RECORD_STATUS[effective].tone;
  // The official record fixes wrong details; it cannot clear a warning about the paper itself (retracted, disputed).
  const paperProblem = Boolean(r && !r.suggestion && r.flags.some((f) => f.code === "retracted" || f.code === "expression-of-concern" || f.code === "second-opinion-disagrees"));
  const canReplace = Boolean(r && !paperProblem && r.reasonCode !== "web-page" && (r.suggestion?.record || (!r.provenWrong && r.status === "check" && r.record)));
  const needsDecision = !item.resolution && (item.status === "check" || item.status === "mismatch");
  const panelId = `evidence-${item.id}`;
  const explanation = React.useMemo(() => (r ? explainVerification(r) : null), [r]);

  return (
    <article
      className={cn(
        "group/card relative overflow-hidden rounded-2xl border bg-card shadow-card transition-[opacity,box-shadow,border-color] duration-300",
        item.status === "mismatch" && !item.resolution ? "border-[color-mix(in_oklab,var(--danger)_35%,var(--rule))]" : "border-rule",
        dimmed && "opacity-90",
        removed && "opacity-60",
      )}
      aria-labelledby={`ref-${item.id}`}
    >
      {/* The index card's printed header rule, inked in the card's status. */}
      <div className={cn("h-1 w-full", item.status === "pending" ? "sweep" : TONE_RULE[tone])} aria-hidden />

      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.78rem] text-ink-3">
            <span className="font-record font-bold tracking-wider text-ink-2">No. {String(item.position + 1).padStart(2, "0")}</span>
            <span className="rounded-md border border-rule px-1.5 py-px font-semibold">{FORMAT_LABEL[item.parsed.format] ?? item.parsed.format}</span>
            {r ? (
              <span className="tabular">
                checked {new Date(r.checkedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                {r.durationMs >= 150 ? ` · ${(r.durationMs / 1000).toFixed(1)} s` : ""}
              </span>
            ) : null}
          </div>

          <p id={`ref-${item.id}`} className={cn("text-[1.02rem] font-medium leading-relaxed text-ink [overflow-wrap:anywhere]", removed && "line-through decoration-ink-3")}>
            {item.raw}
          </p>

          {r && explanation ? (
            <>
              <div className="mt-3 flex items-start gap-2">
                <StatusIcon status={effective} className={cn("mt-0.5 size-5", toneText[tone])} />
                <p className={cn("text-[1rem] font-bold leading-snug", toneText[tone])}>{replaced ? "Replaced with the real record." : explanation.headline}</p>
              </div>
              {!replaced && !removed ? <AnswerStrip explanation={explanation} /> : null}
            </>
          ) : (
            <p className="mt-3 text-[0.92rem] text-ink-3">Comparing with doi.org, Crossref and OpenAlex…</p>
          )}

          {r && r.flags.length ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {r.flags.filter((f) => !(r.provenWrong && (f.code === "year-off-by-one" || f.code === "no-doi"))).map((f) => (
                <Tip key={f.code} content={f.detail}>
                  <span
                    tabIndex={0}
                    className={cn(
                      "inline-flex items-center rounded-md px-2 py-0.5 text-[0.78rem] font-bold",
                      f.severity === "danger" ? "bg-danger-tint text-danger" : f.severity === "warn" ? "bg-warn-tint text-warn" : "bg-paper-2 text-ink-2",
                    )}
                  >
                    {f.label}
                  </span>
                </Tip>
              ))}
            </div>
          ) : null}

          {/* The paper the student probably meant (only for proven-wrong DOIs). */}
          {r?.provenWrong && !item.resolution ? (
            r.suggestion ? (
              <div className="mt-3">
                <RecordSummary record={r.suggestion.record} source={r.suggestion.source} label="Did you mean this real paper?" />
              </div>
            ) : r.searchedForIntended ? (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-danger-tint px-3 py-2 text-[0.88rem] font-semibold text-danger">
                <SearchX className="mt-0.5 size-4 shrink-0" aria-hidden />
                We also searched for a paper with this title and these authors. None exists, so this reference looks invented.
              </p>
            ) : null
          ) : null}

          {kept ? (
            <p className="mt-3 rounded-lg bg-warn-tint px-3 py-2 text-[0.88rem] text-ink-2">
              <span className="font-bold text-warn">Kept unconfirmed.</span> Your reason: “{item.resolutionReason}”. This goes on your honesty receipt.
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-start justify-end sm:w-36 sm:justify-center sm:pt-6">
          <Stamp status={effective} date={r?.checkedAt} land={landed} word={replaced ? undefined : trustLabel(effective, r?.reasonCode).stamp} />
        </div>
      </div>

      {r ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-card-2 px-4 py-2.5 sm:px-5">
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded} aria-controls={panelId}>
            <ChevronDown className={cn("size-4 transition-transform", expanded && "rotate-180")} aria-hidden />
            {expanded ? "Hide the reasons" : "Why this stamp?"}
          </Button>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {item.resolution ? (
              <Button variant="ghost" size="sm" onClick={() => onDecide("undo")} disabled={busy}>
                <Undo2 className="size-4" aria-hidden />
                Undo {item.resolution === "kept" ? "keep" : item.resolution === "replaced" ? "replace" : "remove"}
              </Button>
            ) : needsDecision ? (
              <>
                {r.reasonCode === "service-unavailable" && onRecheck ? (
                  <Button variant="primary" size="sm" onClick={onRecheck} disabled={busy}>
                    <RefreshCw className="size-4" aria-hidden />
                    Check again
                  </Button>
                ) : null}
                {canReplace ? (
                  <Button variant="primary" size="sm" onClick={() => onDecide("replace")} disabled={busy}>
                    <Replace className="size-4" aria-hidden />
                    {r.provenWrong ? "Use the real paper" : "Use the official record"}
                  </Button>
                ) : null}
                {item.status === "check" ? (
                  allowOverrides ? (
                    <Button variant="secondary" size="sm" onClick={onKeep} disabled={busy}>
                      <PenLine className="size-4" aria-hidden />
                      Keep with a reason
                    </Button>
                  ) : (
                    <Tip content="Your course policy does not allow keeping unconfirmed references.">
                      <span>
                        <Button variant="secondary" size="sm" disabled>
                          <Lock className="size-4" aria-hidden />
                          Keep with a reason
                        </Button>
                      </span>
                    </Tip>
                  )
                ) : (
                  <Tip content="Proven wrong: it can only be replaced or removed.">
                    <span>
                      <Button variant="secondary" size="sm" disabled>
                        <Lock className="size-4" aria-hidden />
                        Keep
                      </Button>
                    </span>
                  </Tip>
                )}
                <Button variant="quiet-danger" size="sm" onClick={() => onDecide("remove")} disabled={busy} className="ml-2">
                  <Trash className="size-4" aria-hidden />
                  Remove
                </Button>
              </>
            ) : effective === "verified" ? (
              <span className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-ok">
                <CircleCheck className="size-4" aria-hidden /> Ready to cite
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {r && expanded ? (
        <div id={panelId} className="fade-up border-t border-rule px-4 py-5 sm:px-5">
          <Evidence result={r} explanation={explanation ?? undefined} />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-4">
            {r.record?.DOI ? (
              <a href={`https://doi.org/${r.record.DOI}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[0.88rem] font-semibold text-accent hover:underline">
                Open the record at doi.org <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : (
              <span />
            )}
            <button type="button" onClick={onReport} className="inline-flex items-center gap-1.5 text-[0.85rem] font-semibold text-ink-3 hover:text-ink">
              <Flag className="size-3.5" aria-hidden />
              Report a wrong check
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}
