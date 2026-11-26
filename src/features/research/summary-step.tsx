"use client";

import * as React from "react";
import { ArrowLeft, Check, CircleCheck, CircleX, CircleSlash, Eye, PenLine, Trash, Wrench, ShieldAlert } from "lucide-react";
import type { RunDTO } from "@/server/services/research";
import type { ClaimLabel, Passage, SourceCandidate, SummarySentence } from "@/shared/types";
import { CLAIM_LABELS, JUDGE_VERDICTS } from "@/shared/labels";
import { ClaimChip, ClaimIcon, toneChip, toneText } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Label, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { cn, cslAuthors, cslYear } from "@/lib/utils";
import { TrustLegend } from "@/components/ui/trust-legend";

function shortCite(s: SourceCandidate | undefined) {
  if (!s) return "?";
  const fam = s.csl.author?.[0]?.family ?? s.csl.author?.[0]?.literal ?? "Anon.";
  const more = (s.csl.author?.length ?? 0) > 2 ? " et al." : (s.csl.author?.length ?? 0) === 2 ? ` & ${s.csl.author![1].family ?? ""}` : "";
  return `${fam}${more}, ${cslYear(s.csl) ?? "n.d."}`;
}

/** Shows a passage with the Judge's evidence span highlighted. */
function PassageText({ passage, highlight }: { passage: Passage; highlight?: string }) {
  const text = passage.text;
  const h = highlight?.trim();
  const i = h ? text.toLowerCase().indexOf(h.toLowerCase().replace(/[“”"]/g, "")) : -1;
  return (
    <p className="text-[0.9rem] leading-relaxed text-ink-2">
      {i >= 0 && h ? (
        <>
          {text.slice(0, i)}
          <mark className="rounded bg-[color-mix(in_oklab,var(--ok)_22%,transparent)] px-0.5 text-ink">{text.slice(i, i + h.replace(/[“”"]/g, "").length)}</mark>
          {text.slice(i + h.replace(/[“”"]/g, "").length)}
        </>
      ) : (
        text
      )}
    </p>
  );
}

function SentenceDetail({
  s,
  passages,
  sources,
  canOverride,
  onOverride,
  onRemove,
}: {
  s: SummarySentence;
  passages: Map<string, Passage>;
  sources: Map<string, SourceCandidate>;
  canOverride: boolean;
  onOverride: () => void;
  onRemove: () => void;
}) {
  const info = CLAIM_LABELS[s.label];
  return (
    <div className="space-y-4">
      <div className={cn("rounded-xl px-4 py-3", toneChip[info.tone])}>
        <p className="flex items-center gap-2 font-bold">
          <ClaimIcon label={s.label} /> {info.name}
        </p>
        <p className="mt-1 text-[0.9rem] text-ink-2">{s.why}</p>
        {s.override ? <p className="mt-2 text-[0.85rem] font-semibold text-ink">Confirmed by you: “{s.override.reason}”</p> : null}
      </div>

      {s.repaired && s.originalText ? (
        <div className="rounded-xl border border-rule bg-card-2 px-4 py-3">
          <p className="flex items-center gap-1.5 text-[0.8rem] font-bold text-ink-3">
            <Wrench className="size-3.5" aria-hidden /> Rewritten once by the repair loop. Original:
          </p>
          <p className="mt-1 text-[0.88rem] text-ink-3 line-through">{s.originalText}</p>
        </div>
      ) : null}

      {s.checks.length ? (
        <div>
          <p className="mb-2 text-[0.85rem] font-semibold text-ink-2">Code checks</p>
          <ul className="space-y-1.5">
            {s.checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-[0.88rem]">
                {c.outcome === "pass" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-label="passed" /> : c.outcome === "fail" ? <CircleX className="mt-0.5 size-4 shrink-0 text-danger" aria-label="failed" /> : <CircleSlash className="mt-0.5 size-4 shrink-0 text-ink-3" aria-label="skipped" />}
                <span className="text-ink-2">
                  <span className="font-semibold capitalize text-ink">{c.kind.replace("-", " ")}:</span> {c.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {s.citations.length ? (
        <div>
          <p className="mb-2 text-[0.85rem] font-semibold text-ink-2">Cited passages{s.judge.length ? " and the Judge's verdicts" : ""}</p>
          <ul className="space-y-3">
            {s.citations.map((pid) => {
              const p = passages.get(pid);
              const src = p ? sources.get(p.sourceId) : undefined;
              const j = s.judge.find((x) => x.passageId === pid);
              return (
                <li key={pid} className="rounded-xl border border-rule bg-card px-4 py-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="font-record text-[0.8rem] font-bold text-ink-2">{pid}</span>
                    {p ? <span className="text-[0.75rem] font-semibold text-ink-3">{p.location === "full-text" ? (src?.origin === "upload" ? "from your PDF" : "from the full text") : "from the abstract"}{src ? ` of ${shortCite(src)}` : ""}</span> : null}
                    {j ? (
                      <span className={cn("rounded-full px-2 py-0.5 text-[0.75rem] font-bold", toneChip[JUDGE_VERDICTS[j.verdict].tone])}>
                        Judge: {JUDGE_VERDICTS[j.verdict].name}
                      </span>
                    ) : null}
                    {j && j.verdict !== "says_nothing" ? (
                      <span className={cn("text-[0.75rem] font-semibold", j.evidenceVerified ? "text-ok" : "text-warn")}>{j.evidenceVerified ? "evidence found in passage" : "evidence quote not found"}</span>
                    ) : null}
                    {p?.suspicious ? (
                      <span className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-warn">
                        <ShieldAlert className="size-3.5" aria-hidden /> contained instruction-like text (treated as data)
                      </span>
                    ) : null}
                  </div>
                  {p ? <PassageText passage={p} highlight={j?.evidence} /> : <p className="text-[0.88rem] text-danger">Passage not found.</p>}
                  {j?.reason ? <p className="mt-1.5 text-[0.82rem] italic text-ink-3">Judge: {j.reason}</p> : null}
                  {src ? (
                    <p className="mt-2 border-t border-rule pt-2 text-[0.8rem] text-ink-3">
                      From {src.id}: {cslAuthors(src.csl, 2)} ({cslYear(src.csl) ?? "n.d."}). <span className="italic">{src.csl.title}</span>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
        {s.label === "reported" && !s.override ? (
          <Button variant="secondary" size="sm" onClick={onOverride} disabled={!canOverride}>
            <PenLine className="size-4" aria-hidden /> I checked this myself
          </Button>
        ) : null}
        <Button variant="quiet-danger" size="sm" onClick={onRemove}>
          <Trash className="size-4" aria-hidden /> Remove sentence
        </Button>
      </div>
    </div>
  );
}

export function SummaryStep({
  run,
  busy,
  allowOverrides,
  onApprove,
  onBack,
  onSentence,
}: {
  run: RunDTO;
  busy: boolean;
  allowOverrides: boolean;
  onApprove: () => void;
  onBack: () => void;
  onSentence: (sid: string, action: "override" | "remove" | "view", reason?: string) => Promise<unknown>;
}) {
  const draft = run.draft!;
  const passages = React.useMemo(() => new Map(draft.passages.map((p) => [p.id, p])), [draft.passages]);
  const sources = React.useMemo(() => new Map(run.sources.map((s) => [s.id, s])), [run.sources]);
  // Nothing is open at first: the student chooses what to read, and each sentence they open is counted.
  const [selected, setSelected] = React.useState<string | null>(null);
  const opened = draft.sentences.filter((x) => draft.viewed?.includes(x.id)).length;
  const open = (sid: string) => {
    setSelected(sid);
    if (!draft.viewed?.includes(sid)) void onSentence(sid, "view").catch(() => {});
  };
  const [overrideFor, setOverrideFor] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const sel = draft.sentences.find((s) => s.id === selected) ?? null;
  const counts: [ClaimLabel, number][] = [
    ["verified", draft.stats.verified],
    ["reported", draft.stats.reported],
    ["reasoning", draft.stats.reasoning],
    ["not_found", draft.stats.notFound],
  ];

  return (
    <div className="space-y-5">
      <TrustLegend show={["claims"]} />
      {draft.mode === "extractive" ? (
        <Notice tone="neutral" title="No-AI mode: exact quotes only">
          No AI wrote these sentences. Each one is copied word for word from a source abstract, chosen by keyword relevance. Add an AI key in Settings for written summaries (still fully checked).
        </Notice>
      ) : null}

      <div className="flex flex-wrap gap-2" aria-label="Label counts">
        {counts.map(([l, n]) => (
          <span key={l} className={cn("inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[0.9rem] font-bold", toneChip[CLAIM_LABELS[l].tone])}>
            <ClaimIcon label={l} />
            {CLAIM_LABELS[l].short}
            <span className="tabular text-ink">{n}</span>
          </span>
        ))}
        {draft.stats.removed ? (
          <span className="inline-flex items-center gap-2 rounded-xl bg-danger-tint px-3 py-2 text-[0.9rem] font-bold text-danger">
            <Trash className="size-4" aria-hidden /> Removed by checks <span className="tabular text-ink">{draft.stats.removed}</span>
          </span>
        ) : null}
        {draft.stats.repaired ? (
          <span className="inline-flex items-center gap-2 rounded-xl bg-paper-2 px-3 py-2 text-[0.9rem] font-bold text-ink-2">
            <Wrench className="size-4" aria-hidden /> Repaired <span className="tabular text-ink">{draft.stats.repaired}</span>
          </span>
        ) : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <section className="min-w-0 rounded-2xl border border-rule bg-card shadow-card" aria-labelledby="sum-h">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-rule px-5 py-3.5">
            <h2 id="sum-h" className="text-[1.05rem] font-bold text-ink">Labelled summary</h2>
            <p className="flex items-center gap-2.5 text-[0.85rem] font-semibold text-ink-2" aria-live="polite">
              <span>
                Evidence opened: <span className="tabular text-ink">{opened} of {draft.sentences.length}</span>
              </span>
              <span className="h-2 w-24 overflow-hidden rounded-full bg-paper-2" aria-hidden>
                <span className="block h-full rounded-full bg-[var(--ok-stamp)] transition-[width] duration-300" style={{ width: `${draft.sentences.length ? (opened / draft.sentences.length) * 100 : 0}%` }} />
              </span>
            </p>
          </div>
          <ol className="divide-y divide-rule">
            {draft.sentences.map((s) => {
              const tone = CLAIM_LABELS[s.label].tone;
              const isSel = s.id === selected;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => open(s.id)}
                    aria-pressed={isSel}
                    className={cn("flex w-full gap-3 px-5 py-4 text-left transition-colors hover:bg-card-2", isSel && "bg-accent-tint/60")}
                  >
                    <ClaimIcon label={s.label} className={cn("mt-1", toneText[tone])} />
                    <span className="min-w-0 flex-1">
                      <span className="text-[1.02rem] leading-relaxed text-ink">{s.text}</span>{" "}
                      {s.citations.map((pid) => {
                        const p = passages.get(pid);
                        return (
                          <span key={pid} className="ml-0.5 inline-flex items-center rounded-md bg-paper-2 px-1.5 py-px align-middle text-[0.75rem] font-semibold text-ink-2">
                            {shortCite(p ? sources.get(p.sourceId) : undefined)} · <span className="font-record">{pid}</span>
                          </span>
                        );
                      })}
                      <span className="mt-1.5 flex flex-wrap items-center gap-2">
                        <ClaimChip label={s.label} compact />
                        {s.override ? <span className="inline-flex items-center gap-1 text-[0.78rem] font-semibold text-ok"><Check className="size-3.5" aria-hidden /> confirmed by you</span> : null}
                        {s.repaired ? <span className="inline-flex items-center gap-1 text-[0.78rem] font-semibold text-ink-3"><Wrench className="size-3.5" aria-hidden /> repaired once</span> : null}
                        {draft.viewed?.includes(s.id) ? <span className="inline-flex items-center gap-1 text-[0.78rem] font-semibold text-ink-3"><Eye className="size-3.5" aria-hidden /> evidence opened</span> : <span className="text-[0.78rem] font-semibold text-accent">Open the evidence</span>}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {draft.gaps.map((g, i) => (
              <li key={`gap-${i}`} className="flex gap-3 px-5 py-4">
                <ClaimIcon label="not_found" className={cn("mt-1", toneText.warn)} />
                <span>
                  <span className="text-[1.02rem] leading-relaxed text-ink">{g}</span>
                  <span className="mt-1.5 block">
                    <ClaimChip label="not_found" compact />
                  </span>
                </span>
              </li>
            ))}
            {!draft.sentences.length ? <li className="px-5 py-8 text-center text-ink-2">Every sentence failed the checks and was removed. Try different sources.</li> : null}
          </ol>

          {draft.removed.length ? (
            <div className="border-t border-rule bg-card-2 px-5 py-4">
              <h3 className="text-[0.9rem] font-bold text-danger">Removed ({draft.removed.length}), shown so nothing disappears silently</h3>
              <ul className="mt-2 space-y-2.5">
                {draft.removed.map((r) => (
                  <li key={r.id} className="text-[0.88rem]">
                    <span className="text-ink-3 line-through">{r.text}</span>
                    <span className="mt-0.5 block text-ink-2">{r.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-rule bg-card p-5 shadow-card" aria-labelledby="why-h">
            <h2 id="why-h" className="mb-3 text-[1.05rem] font-bold text-ink">Why this label?</h2>
            {sel ? (
              <SentenceDetail
                s={sel}
                passages={passages}
                sources={sources}
                canOverride={allowOverrides}
                onOverride={() => {
                  setReason("");
                  setOverrideFor(sel.id);
                }}
                onRemove={() => onSentence(sel.id, "remove").then(() => setSelected(null))}
              />
            ) : (
              <div className="rounded-xl bg-paper px-4 py-4 text-[0.92rem] text-ink-2">
                <p className="font-bold text-ink">Click any sentence to open its evidence.</p>
                <p className="mt-1">You will see the exact passage it rests on, every code check, and the Judge&rsquo;s answer with the deciding words highlighted.</p>
                <p className="mt-2 text-[0.85rem] text-ink-3">Your receipt records how many you opened before approving, so your supervisor can see you read the sources, not just the summary.</p>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-rule bg-card p-5 shadow-card" aria-labelledby="critic-h">
            <h2 id="critic-h" className="flex items-center gap-2 text-[1.05rem] font-bold text-ink">
              <Eye className="size-5 text-neutral" aria-hidden /> Critic&rsquo;s flags
            </h2>
            <p className="mt-0.5 text-[0.82rem] text-ink-3">The Critic can only raise flags. It never edits.</p>
            {draft.critic.length ? (
              <ul className="mt-3 space-y-2.5">
                {draft.critic.map((f, i) => (
                  <li key={i} className={cn("rounded-xl px-3 py-2.5 text-[0.88rem]", f.severity === "warn" ? "bg-warn-tint" : "bg-paper")}>
                    <p className={cn("font-bold capitalize", f.severity === "warn" ? "text-warn" : "text-ink-2")}>{f.type.replace(/_/g, " ")}</p>
                    <p className="text-ink-2">{f.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[0.9rem] text-ink-2">Nothing flagged.</p>
            )}
          </section>
        </aside>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-t-2xl border border-b-0 border-rule bg-card px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(17_24_39/0.25)]">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft className="size-4" aria-hidden /> Back to sources
        </Button>
        <p className="ml-auto hidden text-[0.85rem] text-ink-3 md:block">Checkpoint 3 of 3 · you stay the author</p>
        <Button variant="primary" size="lg" onClick={onApprove} loading={busy} disabled={!draft.sentences.length}>
          <Check className="size-4" aria-hidden /> Approve summary
        </Button>
      </div>

      <Dialog
        open={overrideFor !== null}
        onOpenChange={(o) => !o && setOverrideFor(null)}
        title="Confirm this sentence yourself?"
        description="Knowlix could not fully confirm it. If you read the source and it does support the sentence, say how. Your note goes on the honesty receipt."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOverrideFor(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={reason.trim().length < 10}
              loading={busy}
              onClick={() => overrideFor && onSentence(overrideFor, "override", reason).then(() => setOverrideFor(null))}
            >
              Confirm with this note
            </Button>
          </>
        }
      >
        <Label htmlFor="ov-reason">How did you check it?</Label>
        <Textarea id="ov-reason" className="mt-1.5" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Read the full paper; Table 2 reports this effect for the same population." maxLength={500} />
      </Dialog>
    </div>
  );
}
