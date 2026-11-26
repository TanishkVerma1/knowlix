"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, CircleCheck, CircleX, Copy, Download, Info, LoaderCircle, Quote, Search, TriangleExclamationPoint } from "lucide-react";
import type { DraftDTO, DraftNote, RenderedDraft } from "@/server/services/drafts";
import { CITATION_STYLES, type CitationStyleId } from "@/shared/policy";
import { citeKeys } from "@/shared/citekeys";
import { api, errorMessage } from "@/lib/api";
import { cn, copyText, cslAuthors, download, plural } from "@/lib/utils";
import { useLibrary } from "@/features/library/hooks";
import { PageHeader } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Input, Kbd, Label, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { StatusChip } from "@/components/ui/status";

interface DraftResponse {
  draft: DraftDTO;
  rendered: RenderedDraft;
}

const NOTE: Record<DraftNote["tone"], { Icon: typeof Info; cls: string; box: string }> = {
  danger: { Icon: CircleX, cls: "text-danger", box: "bg-danger-tint" },
  warn: { Icon: TriangleExclamationPoint, cls: "text-warn", box: "bg-warn-tint" },
  ok: { Icon: CircleCheck, cls: "text-ok", box: "bg-ok-tint" },
  info: { Icon: Info, cls: "text-info", box: "bg-info-tint" },
};

/** A paragraph as it will read, with any citation that could not be resolved marked in red. */
function Paragraph({ text }: { text: string }) {
  const parts = text.split(/(\[NOT IN YOUR LIBRARY: [^\]]+\])/);
  return (
    <p className="text-[1.02rem] leading-[1.75] text-ink [overflow-wrap:anywhere]">
      {parts.map((p, i) =>
        p.startsWith("[NOT IN YOUR LIBRARY") ? (
          <mark key={i} className="rounded bg-danger-tint px-1 font-semibold text-danger">
            {p}
          </mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </p>
  );
}

export function DraftView() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["draft"], queryFn: () => api<DraftResponse>("/api/draft") });
  const library = useLibrary();
  const [local, setLocal] = React.useState<{ title: string; body: string; style: CitationStyleId } | null>(null);
  const [rendered, setRendered] = React.useState<RenderedDraft | null>(null);
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [find, setFind] = React.useState("");
  const areaRef = React.useRef<HTMLTextAreaElement>(null);
  const caret = React.useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = React.useRef(0);

  const draft = local ?? (q.data ? { title: q.data.draft.title, body: q.data.draft.body, style: q.data.draft.style } : null);
  const view = rendered ?? q.data?.rendered ?? null;

  const save = React.useCallback(
    (next: { title: string; body: string; style: CitationStyleId }, delay = 600) => {
      setLocal(next);
      setSaving("saving");
      clearTimeout(timer.current);
      const mine = ++seq.current;
      timer.current = setTimeout(async () => {
        try {
          const res = await api<DraftResponse>("/api/draft", { method: "PUT", body: next });
          if (mine !== seq.current) return; // a newer edit is already on its way
          setRendered(res.rendered);
          qc.setQueryData(["draft"], res);
          setSaving("saved");
        } catch (e) {
          if (mine !== seq.current) return;
          setSaving("error");
          toast.error(errorMessage(e));
        }
      }, delay);
    },
    [qc],
  );
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const items = React.useMemo(() => library.data?.items ?? [], [library.data]);
  const keys = React.useMemo(() => citeKeys(items.map((i) => ({ id: i.id, firstAuthor: i.firstAuthor, year: i.year, title: i.title, createdAt: i.createdAt }))), [items]);
  const shown = React.useMemo(() => {
    const f = find.trim().toLowerCase();
    return items.filter((i) => !f || `${i.title} ${cslAuthors(i.csl, 6)} ${i.year ?? ""} ${keys.get(i.id) ?? ""}`.toLowerCase().includes(f)).slice(0, 40);
  }, [items, find, keys]);

  const openPicker = () => {
    const el = areaRef.current;
    if (el) caret.current = { start: el.selectionStart, end: el.selectionEnd };
    setFind("");
    setPickerOpen(true);
  };

  const insert = (key: string) => {
    if (!draft) return;
    const { start, end } = caret.current;
    const before = draft.body.slice(0, start);
    const marker = `${before && !/\s$/.test(before) ? " " : ""}[@${key}]`;
    const body = before + marker + draft.body.slice(end);
    save({ ...draft, body }, 150);
    setPickerOpen(false);
    const pos = start + marker.length;
    requestAnimationFrame(() => {
      areaRef.current?.focus();
      areaRef.current?.setSelectionRange(pos, pos);
    });
  };

  if (q.isLoading || !draft) {
    return (
      <div>
        <PageHeader title="Draft" description="You write. Knowlix cites, and only from your checked library." />
        {q.error ? <p className="text-danger">{errorMessage(q.error)}</p> : <Skeleton className="h-96" />}
      </div>
    );
  }

  const problems = view?.notes.filter((n) => n.tone === "danger" || n.tone === "warn") ?? [];
  const good = view?.notes.filter((n) => n.tone === "ok" || n.tone === "info") ?? [];
  const exportText = `${draft.title ? `${draft.title}\n\n` : ""}${view?.text ?? ""}`;
  const canExport = Boolean(view && view.stats.words > 0);

  return (
    <div>
      <PageHeader
        title="Draft"
        description="You write. Knowlix puts in the citations and builds the reference list, and it can only cite sources that passed the check into your library. No AI writes here."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!canExport}
              onClick={async () => {
                if (await copyText(exportText)) {
                  toast.success("Draft and reference list copied");
                  void api("/api/draft/export", { body: {} }).catch(() => {});
                } else toast.error("Copy did not work. Select the text and copy it yourself.");
              }}
            >
              <Copy className="size-4" aria-hidden /> Copy with references
            </Button>
            <Button
              variant="secondary"
              disabled={!canExport}
              onClick={() => {
                download(`${(draft.title || "draft").replace(/[^\w-]+/g, "-").slice(0, 60)}.txt`, exportText);
                void api("/api/draft/export", { body: {} }).catch(() => {});
              }}
            >
              <Download className="size-4" aria-hidden /> Download
            </Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ───── The student's own writing ───── */}
        <section className="min-w-0 rounded-2xl border border-rule bg-card shadow-card" aria-labelledby="write-h">
          <div className="flex flex-wrap items-end gap-3 border-b border-rule px-5 py-4">
            <div className="min-w-0 flex-1">
              <Label htmlFor="draft-title" id="write-h">
                Your draft
              </Label>
              <Input id="draft-title" className="mt-1.5 font-bold" placeholder="Title (optional)" value={draft.title} onChange={(e) => save({ ...draft, title: e.target.value })} maxLength={200} />
            </div>
            <div>
              <Label htmlFor="draft-style">Citation style</Label>
              <Select id="draft-style" className="mt-1.5 block" value={draft.style} onChange={(e) => save({ ...draft, style: e.target.value as CitationStyleId }, 0)}>
                {(Object.entries(CITATION_STYLES) as [CitationStyleId, string][]).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-card-2 px-5 py-2.5">
            <Button variant="primary" size="sm" onClick={openPicker}>
              <Quote className="size-4" aria-hidden /> Insert a citation
            </Button>
            <p className="text-[0.85rem] text-ink-3">
              or press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> while writing. A citation looks like <span className="font-record text-ink-2">[@Hattie2007]</span>.
            </p>
          </div>

          <Textarea
            ref={areaRef}
            aria-label="Draft text"
            className="min-h-[26rem] resize-y rounded-none border-0 px-5 py-4 text-[1.02rem] leading-[1.75] focus-visible:outline-0"
            placeholder={"Write in your own words.\n\nWhen a sentence rests on a source, put the cursor after it and press Ctrl + K to pick the source from your library. Knowlix writes the citation in your chosen style and builds the reference list on the right.\n\nLeave an empty line between paragraphs."}
            value={draft.body}
            maxLength={60000}
            onChange={(e) => save({ ...draft, body: e.target.value })}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                openPicker();
              }
            }}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule px-5 py-2.5 text-[0.82rem] text-ink-3 tabular" aria-live="polite">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              {saving === "saving" ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Saving…
                </>
              ) : saving === "error" ? (
                <span className="text-danger">Not saved. Keep typing to try again.</span>
              ) : (
                <>
                  <CircleCheck className="size-3.5 text-ok" aria-hidden /> Saved in your workspace
                </>
              )}
            </span>
            {view ? (
              <span>
                {plural(view.stats.words, "word")} · {plural(view.stats.citations, "citation")} · {plural(view.stats.sourcesCited, "source")} cited
              </span>
            ) : null}
          </div>
        </section>

        {/* ───── As it will read, plus the checks ───── */}
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-rule bg-card shadow-card" aria-labelledby="read-h">
            <h2 id="read-h" className="border-b border-rule px-5 py-3.5 text-[1.05rem] font-bold text-ink">
              As it will read
              <span className="ml-2 text-[0.85rem] font-semibold text-ink-3">{CITATION_STYLES[draft.style]}</span>
            </h2>
            <div className="space-y-4 px-5 py-4">
              {draft.title ? <p className="text-[1.25rem] font-extrabold leading-snug text-ink">{draft.title}</p> : null}
              {view?.paragraphs.length ? (
                view.paragraphs.map((p, i) => <Paragraph key={i} text={p} />)
              ) : (
                <p className="text-[0.95rem] text-ink-3">Your text appears here with every citation formatted, as you type.</p>
              )}
              {view?.references.length ? (
                <div className="border-t border-rule pt-4">
                  <h3 className="text-[1rem] font-extrabold text-ink">References</h3>
                  <ul className="mt-2 space-y-2">
                    {view.references.map((r, i) => (
                      <li key={i} className={cn("text-[0.95rem] leading-relaxed text-ink-2 [overflow-wrap:anywhere]", draft.style !== "ieee" && draft.style !== "vancouver" && "pl-8 -indent-8")}>
                        {r}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[0.82rem] text-ink-3">Only sources you cite appear here, and each one was checked before it entered your library.</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-rule bg-card p-5 shadow-card" aria-labelledby="checks-h">
            <h2 id="checks-h" className="text-[1.05rem] font-bold text-ink">
              Checks on your draft
            </h2>
            <p className="mt-0.5 text-[0.85rem] text-ink-3">Run by code as you type: does every citation point to a checked source, and is anything copied without quotation marks?</p>
            {view && !view.notes.length ? (
              <p className="mt-3 flex items-center gap-2 rounded-xl bg-ok-tint px-3.5 py-2.5 text-[0.92rem] font-semibold text-ok">
                <CircleCheck className="size-4.5 shrink-0" aria-hidden />
                {view.stats.citations ? "Nothing to flag. Every citation points to a verified source." : "Nothing to flag yet. Add a citation to see it checked."}
              </p>
            ) : null}
            <ul className="mt-3 space-y-2">
              {[...problems, ...good].map((n, i) => {
                const t = NOTE[n.tone];
                return (
                  <li key={i} className={cn("flex gap-2.5 rounded-xl px-3.5 py-2.5", t.box)}>
                    <t.Icon className={cn("mt-0.5 size-4.5 shrink-0", t.cls)} aria-hidden />
                    <div className="min-w-0 text-[0.9rem]">
                      <p className="text-ink">{n.message}</p>
                      {n.excerpt && n.kind !== "unknown-key" && n.kind !== "needs-check" && n.kind !== "retracted" && n.kind !== "preprint" ? <p className="mt-1 border-l-2 border-rule-strong pl-2.5 text-[0.85rem] italic text-ink-2 [overflow-wrap:anywhere]">{n.excerpt}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen} width="max-w-2xl" title="Cite a source from your library" description="Only sources that passed the reference check can be cited.">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input autoFocus className="pl-9" placeholder="Search by author, title or year" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Search your library" />
        </div>
        {items.length ? (
          <ul className="mt-3 max-h-[22rem] space-y-1.5 overflow-y-auto pr-1">
            {shown.map((it) => (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => insert(keys.get(it.id) ?? "")}
                  className="flex w-full items-start gap-3 rounded-xl border border-rule bg-card px-3.5 py-2.5 text-left transition-colors hover:border-accent hover:bg-accent-tint/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug text-ink">{it.title}</span>
                    <span className="mt-0.5 block text-[0.85rem] text-ink-2">
                      {cslAuthors(it.csl)}
                      {it.year ? ` · ${it.year}` : ""}
                      <span className="ml-2 font-record text-[0.8rem] text-ink-3">@{keys.get(it.id)}</span>
                    </span>
                  </span>
                  <StatusChip status={it.status} className="mt-0.5 shrink-0" />
                </button>
              </li>
            ))}
            {!shown.length ? <li className="px-1 py-6 text-center text-[0.92rem] text-ink-2">Nothing in your library matches “{find}”.</li> : null}
          </ul>
        ) : (
          <div className="mt-4 rounded-xl bg-paper px-4 py-6 text-center">
            <BookOpen className="mx-auto mb-2 size-6 text-ink-3" aria-hidden />
            <p className="font-semibold text-ink">Your library is empty</p>
            <p className="mt-1 text-[0.9rem] text-ink-2">Add sources first: each one is checked on the way in, so everything you cite here is real.</p>
            <Button asChild variant="secondary" className="mt-3">
              <Link href="/library">Go to the library</Link>
            </Button>
          </div>
        )}
      </Dialog>
    </div>
  );
}
