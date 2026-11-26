"use client";

import { CircleCheck, CircleX, TriangleExclamationPoint, CircleMinus, CircleSlash, CircleQuestionMark, ExternalLink, ArrowRight } from "lucide-react";
import type { CheckStep, CslItem, FieldComparison, VerificationResult } from "@/shared/types";
import type { Answer, Explanation } from "@/shared/explain";
import { cn, cslAuthors, cslVenue, cslYear } from "@/lib/utils";

const ANSWER: Record<Answer, { Icon: typeof CircleCheck; text: string; chip: string; word: string }> = {
  yes: { Icon: CircleCheck, text: "text-ok", chip: "bg-ok-tint text-ok", word: "Yes" },
  no: { Icon: CircleX, text: "text-danger", chip: "bg-danger-tint text-danger", word: "No" },
  caution: { Icon: TriangleExclamationPoint, text: "text-warn", chip: "bg-warn-tint text-warn", word: "Careful" },
  unknown: { Icon: CircleQuestionMark, text: "text-pending", chip: "bg-pending-tint text-pending", word: "Unknown" },
};

const SHORT_Q = { exists: "Exists", details: "Details match", safe: "Safe to cite" } as const;

/** The three answers behind every stamp, readable at a glance on the closed card. */
export function AnswerStrip({ explanation }: { explanation: Explanation }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="The three checks behind this stamp">
      {explanation.questions.map((q) => {
        const a = ANSWER[q.answer];
        return (
          <li key={q.id} className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.82rem] leading-none", a.chip)}>
            <a.Icon className="size-4 shrink-0" aria-hidden />
            <span className="font-bold">{SHORT_Q[q.id]}?</span>
            <span className="font-semibold">
              <span className="sr-only">{a.word}: </span>
              {q.short}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** "Why this stamp?": each question answered in full, then what to do. */
export function WhyThisStamp({ explanation }: { explanation: Explanation }) {
  return (
    <section aria-label="Why this stamp">
      <h3 className="text-[0.98rem] font-extrabold text-ink">Why this stamp?</h3>
      <p className="mt-1 text-[0.92rem] text-ink-2">{explanation.why}</p>
      <ol className="mt-3 divide-y divide-rule overflow-hidden rounded-xl border border-rule">
        {explanation.questions.map((q, i) => {
          const a = ANSWER[q.answer];
          return (
            <li key={q.id} className="flex gap-3 bg-card px-4 py-3">
              <a.Icon className={cn("mt-0.5 size-5 shrink-0", a.text)} aria-hidden />
              <div className="min-w-0">
                <p className="text-[0.92rem] font-bold text-ink">
                  <span className="tabular text-ink-3">{i + 1}. </span>
                  {q.question}
                </p>
                <p className="mt-0.5 text-[0.92rem] leading-relaxed text-ink-2">{q.text}</p>
                {q.href ? (
                  <a href={q.href} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[0.88rem] font-semibold text-accent hover:underline">
                    {q.hrefLabel ?? "Open"} <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {explanation.scoreNote ? <p className="mt-3 rounded-xl bg-info-tint px-4 py-2.5 text-[0.9rem] text-ink-2"><strong className="text-info">About the score.</strong> {explanation.scoreNote}</p> : null}
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-paper px-4 py-2.5 text-[0.92rem] text-ink">
        <ArrowRight className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <span>
          <strong>What to do now.</strong> {explanation.next}
        </span>
      </p>
    </section>
  );
}

const FIELD_LABEL: Record<FieldComparison["field"], string> = { title: "Title", authors: "Authors", year: "Year", venue: "Journal / publisher" };
const VERDICT = {
  match: { label: "Match", cls: "bg-ok-tint text-ok", Icon: CircleCheck },
  close: { label: "Close", cls: "bg-warn-tint text-warn", Icon: TriangleExclamationPoint },
  differs: { label: "Differs", cls: "bg-danger-tint text-danger", Icon: CircleX },
  missing: { label: "Not compared", cls: "bg-pending-tint text-pending", Icon: CircleMinus },
} as const;

const SOURCE_NAME: Record<string, string> = {
  crossref: "Crossref",
  datacite: "DataCite",
  "doi.org": "doi.org",
  openalex: "OpenAlex",
  openlibrary: "Open Library",
  googlebooks: "Google Books",
  arxiv: "arXiv",
};

export function RecordSummary({ record, source, label = "Official record" }: { record: CslItem; source?: string | null; label?: string }) {
  const year = cslYear(record);
  const venue = cslVenue(record);
  return (
    <div className="rounded-xl border border-rule bg-card-2 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.8rem] font-semibold text-ink-3">
          {label}
          {source ? ` · from ${SOURCE_NAME[source] ?? source}` : ""}
        </p>
        {record.DOI ? (
          <a href={`https://doi.org/${record.DOI}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-record text-[0.82rem] text-accent hover:underline">
            doi:{record.DOI}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : record.URL ? (
          <a href={record.URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[0.82rem] text-accent hover:underline">
            Open record <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
      <p className="mt-1 font-semibold leading-snug text-ink">{record.title || "Untitled"}</p>
      <p className="mt-0.5 text-[0.9rem] text-ink-2">
        {cslAuthors(record, 6)}
        {year ? ` · ${year}` : ""}
        {venue ? ` · ${venue}` : ""}
      </p>
    </div>
  );
}

export function FieldTable({ fields }: { fields: FieldComparison[] }) {
  if (!fields.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-rule">
      <table className="w-full min-w-[34rem] text-left text-[0.88rem]">
        <caption className="sr-only">Field-by-field comparison with the official record</caption>
        <thead className="bg-card-2 text-[0.78rem] font-semibold text-ink-3">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Field</th>
            <th scope="col" className="px-3 py-2 font-semibold">You wrote</th>
            <th scope="col" className="px-3 py-2 font-semibold">Official record</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Result</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const v = VERDICT[f.verdict];
            return (
              <tr key={f.field} className="border-t border-rule align-top">
                <th scope="row" className="whitespace-nowrap px-3 py-2.5 font-semibold text-ink">
                  {FIELD_LABEL[f.field]}
                  <span className="block text-[0.75rem] font-normal text-ink-3 tabular">
                    {Math.round(f.points)}/{f.weight} pts
                  </span>
                </th>
                <td className="px-3 py-2.5 text-ink-2">{f.entered ?? <span className="italic text-ink-3">not separated</span>}</td>
                <td className="px-3 py-2.5 text-ink-2">
                  {f.found ?? <span className="italic text-ink-3">none</span>}
                  {f.note ? <span className="mt-1 block text-[0.78rem] text-ink-3">{f.note}</span> : null}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.75rem] font-bold", v.cls)}>
                    <v.Icon className="size-3.5" aria-hidden />
                    {v.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const STEP_ICON: Record<CheckStep["outcome"], { Icon: typeof CircleCheck; cls: string; word: string }> = {
  pass: { Icon: CircleCheck, cls: "text-ok", word: "Passed" },
  fail: { Icon: CircleX, cls: "text-danger", word: "Failed" },
  warn: { Icon: TriangleExclamationPoint, cls: "text-warn", word: "Warning" },
  skip: { Icon: CircleSlash, cls: "text-ink-3", word: "Skipped" },
  error: { Icon: TriangleExclamationPoint, cls: "text-warn", word: "Could not run" },
};

export function CheckTimeline({ steps }: { steps: CheckStep[] }) {
  return (
    <ol className="relative space-y-3 pl-1">
      {steps.map((s, i) => {
        const o = STEP_ICON[s.outcome];
        return (
          <li key={`${s.id}-${i}`} className="relative flex gap-3">
            {i < steps.length - 1 ? <span className="absolute left-[9px] top-6 h-[calc(100%-6px)] w-px bg-rule" aria-hidden /> : null}
            <o.Icon className={cn("relative mt-0.5 size-[19px] shrink-0 rounded-full bg-card", o.cls)} aria-label={o.word} />
            <div className="min-w-0">
              <p className="text-[0.9rem] font-semibold text-ink">
                {s.label}
                {s.source ? <span className="font-normal text-ink-3"> · {s.source}</span> : null}
                {typeof s.ms === "number" && s.ms > 0 ? <span className="tabular font-normal text-ink-3"> · {s.ms} ms</span> : null}
              </p>
              <p className="text-[0.86rem] text-ink-2">{s.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Evidence({ result, explanation }: { result: VerificationResult; explanation?: Explanation }) {
  return (
    <div className="space-y-5">
      {explanation ? <WhyThisStamp explanation={explanation} /> : null}
      {result.record && !(result.provenWrong && result.reasonCode === "doi-other-paper") ? (
        <RecordSummary record={result.record} source={result.recordSource} />
      ) : null}
      {result.reasonCode === "doi-other-paper" && result.record ? (
        <RecordSummary record={result.record} source={result.recordSource} label="This DOI actually belongs to" />
      ) : null}
      {result.fields.length ? (
        <div>
          <h3 className="text-[0.98rem] font-extrabold text-ink">
            What you typed, next to the real record
            {result.score !== null ? <span className="ml-2 rounded-full bg-paper-2 px-2.5 py-0.5 text-[0.82rem] font-bold text-ink-2 tabular">{result.score} out of 100</span> : null}
          </h3>
          <p className="mb-2 mt-1 text-[0.86rem] text-ink-3">
            The score only measures how closely your details match: title 40 points, authors 30, year 15, journal 15. A match needs 90 or more. It does not judge whether the paper can be trusted.
          </p>
          <FieldTable fields={result.fields} />
        </div>
      ) : null}
      <div>
        <h3 className="mb-2 text-[0.98rem] font-extrabold text-ink">Every check that ran, in order</h3>
        <CheckTimeline steps={result.checks} />
      </div>
    </div>
  );
}
