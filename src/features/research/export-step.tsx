"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Download, ScrollText, CircleCheck } from "lucide-react";
import type { RunDTO } from "@/server/services/research";
import { CITATION_STYLES, type CitationStyleId } from "@/shared/policy";
import { api } from "@/lib/api";
import { download, stampDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { useAiCalls } from "./ai-calls";
import { ReferenceList, copyRich, downloadForWord, paragraphsForPaste, referencesForPaste } from "@/components/ui/references";

export function buildAiUseStatement(run: RunDTO, models: string[]): string {
  const st = run.draft?.stats;
  const sources = run.sources.filter((s) => s.accepted).length;
  const overrides = run.draft?.sentences.filter((s) => s.override).length ?? 0;
  const date = stampDate(run.summaryApprovedAt ?? new Date().toISOString()).toLowerCase();
  const ai =
    run.mode === "ai"
      ? `I used Knowlix, an AI research assistant (${models.join(", ") || "AI model"}), to plan literature searches, screen results and draft a short evidence summary`
      : "I used Knowlix, a research tool, in its no-AI mode to plan literature searches and quote passages from sources; no text was written by AI";
  return [
    `${ai} on ${date}.`,
    `All ${sources} sources were checked against doi.org, Crossref and OpenAlex as real, registered records before use.`,
    st
      ? `Of the summary's ${st.verified + st.reported + st.reasoning} sentences, ${st.verified} were verified against the cited passages, ${st.reported} were reported but not fully checked, and ${st.reasoning} were labelled as AI reasoning; ${st.removed} sentence${st.removed === 1 ? " was" : "s were"} removed by automatic checks${st.notFound ? `, and ${st.notFound} part${st.notFound === 1 ? "" : "s"} of the question had no answer in the sources` : ""}.`
      : "",
    run.draft ? `Before approving, I opened the evidence behind ${run.draft.sentences.filter((s) => run.draft!.viewed?.includes(s.id)).length} of the ${run.draft.sentences.length} sentences.` : "",
    overrides ? `I confirmed ${overrides} sentence${overrides === 1 ? "" : "s"} myself after reading the source.` : "",
    "I approved the search plan, chose the sources and reviewed the summary myself. The final work, its arguments and its wording are my own.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function ExportStep({ run, defaultStyle }: { run: RunDTO; defaultStyle: CitationStyleId }) {
  const [style, setStyle] = React.useState<CitationStyleId>(defaultStyle);
  const exp = useQuery({ queryKey: ["run-export", run.id, style], queryFn: () => api<{ summary: string; references: string; referencesHtml?: string }>(`/api/research/${run.id}/export?style=${style}`) });
  const calls = useAiCalls(run.id, run.mode === "ai");
  const models = [...new Set((calls.data?.calls ?? []).filter((c) => c.ok).map((c) => `${c.model} via ${c.provider}`))];
  const [statement, setStatement] = React.useState<string | null>(null);
  const text = statement ?? buildAiUseStatement(run, models);
  const full = exp.data ? `${exp.data.summary}\n\nReferences\n\n${exp.data.references}\n\nAI-use statement\n\n${text}` : "";

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-2xl bg-ok-tint px-5 py-4">
        <CircleCheck className="size-6 shrink-0 text-ok" aria-hidden />
        <div>
          <p className="font-bold text-ok">All three checkpoints approved</p>
          <p className="text-[0.9rem] text-ink-2">The sources you approved were saved to your library, tagged “research”.</p>
        </div>
      </div>

      <section className="rounded-2xl border border-rule bg-card p-5 shadow-card" aria-labelledby="exp-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="exp-h" className="text-[1.05rem] font-bold text-ink">Summary with citations</h2>
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="run-style" className="text-[0.78rem]">Citation style</Label>
              <Select id="run-style" className="mt-1" value={style} onChange={(e) => setStyle(e.target.value as CitationStyleId)}>
                {Object.entries(CITATION_STYLES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </div>
          </div>
        </div>
        {exp.isLoading ? (
          <Skeleton className="mt-4 h-48" />
        ) : exp.data ? (
          <div className="mt-4 space-y-4">
            <div className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-rule bg-paper p-4 font-sans text-[1rem] leading-relaxed text-ink">{exp.data.summary}</div>
            <div>
              <h3 className="text-[0.9rem] font-bold text-ink">References</h3>
              <ReferenceList html={exp.data.referencesHtml} text={exp.data.references} className="mt-2 max-h-none" />
            </div>
          </div>
        ) : (
          <p className="mt-4 text-danger">The export could not be built. Try another style.</p>
        )}
      </section>

      <section className="rounded-2xl border border-rule bg-card p-5 shadow-card" aria-labelledby="stmt-h">
        <h2 id="stmt-h" className="text-[1.05rem] font-bold text-ink">AI-use statement</h2>
        <p className="mt-0.5 text-[0.88rem] text-ink-2">Generated from what actually happened in this run. Edit it to match your course&rsquo;s wording.</p>
        <Textarea className="mt-3 text-[0.95rem] leading-relaxed" rows={6} value={text} onChange={(e) => setStatement(e.target.value)} aria-label="AI-use statement" />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!exp.data}
          onClick={async () => {
            const refs = exp.data?.referencesHtml;
            const rich = refs && exp.data ? `${paragraphsForPaste(exp.data.summary)}${paragraphsForPaste("References")}${referencesForPaste(refs)}${paragraphsForPaste(`AI-use statement\n\n${text}`)}` : "";
            if (await copyRich(rich, full)) toast.success("Summary, references and statement copied");
          }}
        >
          <Copy className="size-4" aria-hidden /> Copy everything
        </Button>
        <Button variant="secondary" disabled={!exp.data} onClick={() => download("knowlix-summary.txt", full)}>
          <Download className="size-4" aria-hidden /> Download .txt
        </Button>
        {exp.data?.referencesHtml ? (
          <Button variant="secondary" onClick={() => downloadForWord(exp.data!.referencesHtml!, "knowlix-references")}>
            <Download className="size-4" aria-hidden /> References for Word (.rtf)
          </Button>
        ) : null}
        <Button variant="secondary" asChild>
          <Link href={`/receipts/run/${run.id}`}>
            <ScrollText className="size-4" aria-hidden /> Honesty receipt
          </Link>
        </Button>
      </div>
    </div>
  );
}
