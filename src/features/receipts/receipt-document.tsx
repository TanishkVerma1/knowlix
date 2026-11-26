import { ShieldCheck, ShieldX, Link2 } from "lucide-react";
import type { ReceiptDTO } from "@/server/services/receipts";
import { RECORD_STATUS } from "@/shared/labels";
import { Logo } from "@/components/ui/misc";
import { Stamp, StatusChip } from "@/components/ui/status";
import { cn } from "@/lib/utils";

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid border-t border-rule px-6 py-5 sm:px-8">
      <h2 className="mb-3 text-[1.02rem] font-bold text-ink">{title}</h2>
      {children}
    </section>
  );
}

const DECISION: Record<string, string> = { replaced: "Replaced with the real record", removed: "Removed", kept: "Kept unconfirmed, with a reason" };

/** The honesty receipt: what was checked, what the student decided, and proof the log was not edited. */
export function ReceiptDocument({ r, publicView = false }: { r: ReceiptDTO; publicView?: boolean }) {
  const run = r.run;
  const audit = r.audit;
  const overall: "verified" | "check" | "mismatch" = audit
    ? audit.summary.blocking
      ? "mismatch"
      : audit.summary.undecided || audit.summary.kept
        ? "check"
        : "verified"
    : run?.summaryApprovedAt
      ? (run.stats?.reported ?? 0) - run.overrides.length > 0
        ? "check"
        : "verified"
      : "check";

  return (
    <article className="overflow-hidden rounded-2xl border border-rule bg-card shadow-card print:rounded-none print:border-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 px-6 py-6 sm:px-8">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2.5 text-[1.5rem] font-extrabold leading-snug text-ink">
            <Logo className="size-8 shrink-0" />
            Honesty receipt
          </h1>
          <p className="mt-3 text-[1.1rem] font-bold leading-snug text-ink">{r.title}</p>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-[0.88rem] sm:grid-cols-2">
            <div className="flex gap-2"><dt className="text-ink-3">Type</dt><dd className="font-semibold text-ink">{r.kind === "audit" ? "Citation Audit" : "Research run"}</dd></div>
            <div className="flex gap-2"><dt className="text-ink-3">Started</dt><dd className="font-semibold text-ink">{fmt(r.createdAt)}</dd></div>
            <div className="flex gap-2"><dt className="text-ink-3">Receipt generated</dt><dd className="font-semibold text-ink">{fmt(r.generatedAt)}</dd></div>
            <div className="flex gap-2"><dt className="text-ink-3">Workspace</dt><dd className="font-record font-semibold text-ink">{r.workspaceShort}</dd></div>
          </dl>
        </div>
        <Stamp status={overall} date={r.generatedAt} size="lg" className="mr-4 mt-4" />
      </header>

      {publicView ? (
        <p className="flex items-center gap-2 border-t border-rule bg-info-tint px-6 py-2.5 text-[0.85rem] font-semibold text-info sm:px-8">
          <Link2 className="size-4" aria-hidden /> Read-only supervisor view shared by the student. It shows this receipt only.
        </p>
      ) : null}

      {audit ? (
        <>
          <Section title="Result">
            <div className="flex flex-wrap gap-2">
              <StatusChip status="verified" label={`Verified ${audit.summary.verified}`} />
              <StatusChip status="check" label={`Please check ${audit.summary.check}`} />
              <StatusChip status="mismatch" label={`Mismatch ${audit.summary.mismatch}`} />
              {audit.summary.removed ? <span className="rounded-full bg-paper-2 px-2.5 py-1 text-[0.8rem] font-bold text-ink-2">Removed {audit.summary.removed}</span> : null}
            </div>
            <p className="mt-3 text-[0.9rem] text-ink-2">
              {audit.summary.blocking
                ? `${audit.summary.blocking} ${audit.summary.blocking === 1 ? "reference is" : "references are"} proven wrong and still ${audit.summary.blocking === 1 ? "needs" : "need"} a decision, so export is locked.`
                : "No proven-wrong reference remains in the exported list."}
              {audit.summary.undecided ? ` ${audit.summary.undecided} unconfirmed ${audit.summary.undecided === 1 ? "reference still needs" : "references still need"} a decision.` : ""}
              {audit.summary.kept ? ` ${audit.summary.kept} ${audit.summary.kept === 1 ? "was" : "were"} kept unconfirmed, each with the reason shown below.` : ""}
            </p>
          </Section>
          <Section title="Every reference">
            <ol className="space-y-3">
              {audit.items.map((it) => (
                <li key={it.n} className="break-inside-avoid rounded-xl border border-rule px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-record text-[0.8rem] font-bold text-ink-3">No. {String(it.n).padStart(2, "0")}</span>
                    <StatusChip status={it.resolution === "replaced" ? "verified" : it.status} label={it.resolution === "replaced" ? "Fixed" : RECORD_STATUS[it.status].name} />
                    {it.resolution ? <span className="text-[0.82rem] font-semibold text-ink-2">{DECISION[it.resolution]}</span> : null}
                    {it.flags.map((f) => (
                      <span key={f} className="rounded bg-paper-2 px-1.5 text-[0.75rem] font-semibold text-ink-2">{f}</span>
                    ))}
                  </div>
                  <p className={cn("mt-1.5 font-record text-[0.85rem] text-ink [overflow-wrap:anywhere]", it.resolution === "removed" && "line-through decoration-ink-3")}>{it.raw}</p>
                  <p className="mt-1 text-[0.85rem] text-ink-2">{it.verdict}</p>
                  {it.reason ? <p className="mt-1 text-[0.85rem]"><span className="font-semibold text-warn">Student&rsquo;s reason:</span> “{it.reason}”</p> : null}
                </li>
              ))}
            </ol>
          </Section>
        </>
      ) : null}

      {run ? (
        <>
          <Section title="Checkpoints approved by the student">
            <ol className="grid gap-2 sm:grid-cols-3">
              {[
                ["1. Search plan", run.planApprovedAt],
                ["2. Sources", run.sourcesApprovedAt],
                ["3. Summary", run.summaryApprovedAt],
              ].map(([k, v]) => (
                <li key={k} className={cn("rounded-xl px-3 py-2.5", v ? "bg-ok-tint" : "bg-paper-2")}>
                  <p className="text-[0.85rem] font-bold text-ink">{k}</p>
                  <p className={cn("text-[0.82rem]", v ? "text-ok" : "text-ink-3")}>{v ? `Approved ${fmt(v)}` : "Not approved"}</p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[0.88rem] text-ink-2">
              Mode: <strong className="text-ink">{run.mode === "ai" ? "AI agents, every sentence checked" : "No-AI: exact quotes only"}</strong>. Searches: {run.queries.map((q) => `“${q}”`).join(", ") || "none"}.
            </p>
          </Section>
          <Section title="Sources used (each verified as a real record)">
            <ul className="space-y-1.5">
              {run.sources.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-2 text-[0.88rem]">
                  <StatusChip status={s.status as "verified"} />
                  <span className="text-ink">{s.firstAuthor ?? "Unknown"} ({s.year ?? "n.d."}). {s.title}</span>
                  {s.doi ? <span className="font-record text-[0.8rem] text-ink-3">doi:{s.doi}</span> : null}
                </li>
              ))}
            </ul>
          </Section>
          {run.stats ? (
            <Section title="Summary labels">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ["Verified", run.stats.verified],
                  ["Reported, not checked", run.stats.reported],
                  ["AI reasoning", run.stats.reasoning],
                  ["Not found", run.stats.notFound],
                  ["Repaired once", run.stats.repaired],
                  ["Removed by checks", run.stats.removed],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-paper px-3 py-2.5">
                    <p className="text-[0.75rem] font-semibold text-ink-3">{k}</p>
                    <p className="text-[1.4rem] font-extrabold leading-none text-ink tabular">{v}</p>
                  </div>
                ))}
              </div>
              {run.summaryApprovedAt ? (
                <p className="mt-4 text-[0.9rem] text-ink-2">
                  <span className="font-bold text-ink">Evidence opened before approving:</span>{" "}
                  <span className="tabular">{run.evidenceOpened.opened} of {run.evidenceOpened.of}</span> sentences. This counts the sentences whose source passage the student opened and read.
                </p>
              ) : null}
              {run.overrides.length ? (
                <div className="mt-4">
                  <p className="text-[0.88rem] font-bold text-ink">Sentences the student confirmed personally</p>
                  <ul className="mt-1.5 space-y-1.5 text-[0.85rem] text-ink-2">
                    {run.overrides.map((o, i) => (
                      <li key={i}>“{o.text}”: <span className="font-semibold text-warn">{o.reason}</span></li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {run.removed.length ? (
                <div className="mt-4">
                  <p className="text-[0.88rem] font-bold text-ink">Removed before the student saw the final summary</p>
                  <ul className="mt-1.5 space-y-1.5 text-[0.85rem] text-ink-2">
                    {run.removed.map((x, i) => (
                      <li key={i}><span className="line-through">{x.text}</span> {x.why}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </Section>
          ) : null}
          <Section title="AI use">
            <p className="text-[0.9rem] text-ink-2">
              {run.ai.calls
                ? `${run.ai.calls} AI call${run.ai.calls === 1 ? "" : "s"} (${run.ai.failed} failed and were handled). Models: ${run.ai.models.join(", ") || "none"}. Prompt versions: ${run.ai.promptVersions.join(", ")}. ${run.ai.charsSent.toLocaleString()} characters sent in total: the question and short passages from abstracts only.`
                : "No AI model was called. Plans, screening and summaries were produced without AI."}
            </p>
          </Section>
        </>
      ) : null}

      <Section title="Activity log">
        <p className={cn("flex items-center gap-2 text-[0.9rem] font-semibold", r.chain.intact ? "text-ok" : "text-danger")}>
          {r.chain.intact ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldX className="size-5" aria-hidden />}
          {r.chain.intact ? `Hash chain intact across ${r.chain.count} entries. Nothing was edited or deleted.` : "The hash chain is broken: the log was altered."}
        </p>
        <p className="mt-1 font-record text-[0.75rem] text-ink-3 [overflow-wrap:anywhere]">Chain head: {r.chain.head}</p>
        {r.log.length ? (
          <ol className="mt-3 space-y-1.5">
            {r.log.map((e, i) => (
              <li key={i} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 text-[0.84rem]">
                <span className="text-ink-3 tabular">{fmt(e.at)}</span>
                <span className="text-ink-2">
                  <span className="font-semibold text-ink">{e.actor.replace("agent:", "")}</span>: {e.summary}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </Section>
      <footer className="border-t border-rule px-6 py-4 text-[0.78rem] text-ink-3 sm:px-8">
        Knowlix checks references against doi.org, Crossref, OpenAlex and Open Library, and labels every AI-written sentence. Automatic checks can be wrong; this receipt records what was checked and what the student decided.
      </footer>
    </article>
  );
}
