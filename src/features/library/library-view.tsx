"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, FolderPlus, Quote, Download, Copy, LibraryBig, OctagonX, Upload, FolderOpen, Inbox, Check } from "lucide-react";
import type { LibraryItemDTO } from "@/server/services/library";
import type { VerificationResult, RecordStatus, CslItem } from "@/shared/types";
import { trustLabel } from "@/shared/labels";
import { referenceListStatement } from "@/shared/statement";
import { TrustLegend } from "@/components/ui/trust-legend";
import { CITATION_STYLES, type CitationStyleId } from "@/shared/policy";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn, copyText, cslAuthors, cslYear, download, plural, relativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RegisterRule } from "@/components/shell/app-shell";
import { PdfToLibrary } from "./pdf-to-library";
import { Input, Select, Label } from "@/components/ui/field";
import { Dialog } from "@/components/ui/overlay";
import { EmptyState, Notice, Skeleton } from "@/components/ui/misc";
import { StatusChip, Stamp } from "@/components/ui/status";
import { useLibrary, TAB_COLOR, type FolderDTO } from "./hooks";
import { ItemSheet } from "./item-sheet";

type AddResult =
  | { added: true; item: LibraryItemDTO; result: VerificationResult }
  | { added: false; reason: "needs-approval"; result: VerificationResult; csl: CslItem }
  | { added: false; reason: "proven-wrong" | "duplicate"; result: VerificationResult; existingId?: string };

const STATUS_FILTERS: { id: "all" | RecordStatus; label: string }[] = [
  { id: "all", label: "All" },
  { id: "verified", label: "Verified" },
  { id: "check", label: "Please check" },
];

export function LibraryView() {
  const qc = useQueryClient();
  const session = useSession();
  const lib = useLibrary();
  const [folder, setFolder] = React.useState<string | "all" | "none">("all");
  const [status, setStatus] = React.useState<"all" | RecordStatus>("all");
  const [tag, setTag] = React.useState<string | null>(null);
  const [q, setQ] = React.useState("");
  const [input, setInput] = React.useState("");
  const [refused, setRefused] = React.useState<VerificationResult | null>(null);
  /** Checked and waiting for the student to approve it: nothing is saved before that click. */
  const [pending, setPending] = React.useState<{ text: string; result: VerificationResult; csl: CslItem } | null>(null);
  const [lastAdded, setLastAdded] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [newFolder, setNewFolder] = React.useState<string | null>(null);
  const [citeOpen, setCiteOpen] = React.useState(false);
  const [citeChoice, setCiteStyle] = React.useState<CitationStyleId | null>(null);
  const [citeOut, setCiteOut] = React.useState<string | null>(null);
  const policy = session.data?.policy;

  const citeStyle: CitationStyleId = citeChoice ?? policy?.defaultStyle ?? "apa";

  const add = useMutation({
    mutationFn: (v: { text: string; approved?: boolean }) => api<AddResult>("/api/library", { body: { input: v.text, folderId: folder !== "all" && folder !== "none" ? folder : null, preview: !v.approved } }),
    onSuccess: (r, v) => {
      if (r.added) {
        setRefused(null);
        setPending(null);
        setInput("");
        setLastAdded(r.item.id);
        qc.invalidateQueries({ queryKey: ["library"] });
        qc.invalidateQueries({ queryKey: ["session"] });
        toast.success(r.result.status === "verified" ? "Verified and added" : "Added. Please check it", { description: r.item.title });
      } else if (r.reason === "needs-approval") {
        setRefused(null);
        setPending({ text: v.text, result: r.result, csl: r.csl });
      } else if (r.reason === "proven-wrong") {
        setPending(null);
        setRefused(r.result);
      } else {
        setPending(null);
        toast.message("Already in your library");
        if (r.existingId) setOpenId(r.existingId);
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const createFolder = useMutation({
    mutationFn: (name: string) => api<FolderDTO>("/api/folders", { body: { name } }),
    onSuccess: (f) => {
      qc.invalidateQueries({ queryKey: ["library"] });
      setNewFolder(null);
      setFolder(f.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const cite = useMutation({
    mutationFn: () => api<{ bibliography: string }>("/api/cite", { body: { ids: [...selected], style: citeStyle } }),
    onSuccess: (r) => setCiteOut(r.bibliography),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const items = lib.data?.items ?? [];
  const picked = items.filter((i) => selected.has(i.id));
  const libStatement = !citeOut ? "" : referenceListStatement({ total: picked.length, verified: picked.filter((i) => i.status === "verified").length, style: CITATION_STYLES[citeStyle] });
  const folders = lib.data?.folders ?? [];
  const allTags = [...new Set(items.flatMap((i) => i.tags))].sort();
  const needle = q.trim().toLowerCase();
  const shown = items.filter(
    (i) =>
      (folder === "all" || (folder === "none" ? !i.folderId : i.folderId === folder)) &&
      (status === "all" || i.status === status) &&
      (!tag || i.tags.includes(tag)) &&
      (!needle || `${i.title} ${i.firstAuthor ?? ""} ${i.venue ?? ""} ${i.year ?? ""} ${i.doi ?? ""} ${i.notes}`.toLowerCase().includes(needle)),
  );
  const openItem = items.find((i) => i.id === openId) ?? null;
  const allChecked = shown.length > 0 && shown.every((i) => selected.has(i.id));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.85rem] font-extrabold leading-[1.1] text-ink sm:text-[2.2rem]">Library</h1>
          <p className="mt-1.5 max-w-[46rem] text-[1.02rem] text-ink-2">Every reference here was checked first and approved by you. Nothing is added automatically, and proven-wrong references are refused at the door.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link href="/audit">
              <Upload className="size-4" aria-hidden /> Import a list
            </Link>
          </Button>
          <Button variant="primary" disabled={!selected.size} onClick={() => { setCiteOut(null); setCiteOpen(true); }}>
            <Quote className="size-4" aria-hidden /> Cite {selected.size ? plural(selected.size, "reference") : "selected"}
          </Button>
        </div>
      </div>
      <RegisterRule className="mb-5 mt-4" />
      <TrustLegend show={["references"]} className="mb-5" />

      {/* Add box: Lock 1 runs before anything is saved. */}
      <form
        className="rounded-2xl border border-rule bg-card p-4 shadow-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim().length >= 3) add.mutate({ text: input.trim() });
        }}
      >
        <Label htmlFor="add-ref">Add a reference</Label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <Input id="add-ref" value={input} onChange={(e) => setInput(e.target.value)} placeholder="A DOI, a link, an ISBN, an arXiv ID, or a full reference in any style" className="h-11" />
          <Button type="submit" variant="primary" size="lg" loading={add.isPending} disabled={input.trim().length < 3}>
            <Plus className="size-4" aria-hidden /> Check
          </Button>
          <PdfToLibrary busy={add.isPending} onReference={(text) => add.mutate({ text })} />
        </div>
        <p className="mt-2 text-[0.84rem] text-ink-3">Paste a link to an article or web page, or add a PDF from your computer. A PDF is read on your device: only its title and DOI are used, and the file is never uploaded.</p>
        {refused ? (
          <div className="mt-3 flex items-center gap-4 rounded-xl bg-danger-tint px-4 py-3">
            <Stamp status="mismatch" date={refused.checkedAt} land />
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-bold text-danger">
                <OctagonX className="size-4" aria-hidden /> Not saved: this reference is proven wrong
              </p>
              <p className="text-[0.9rem] text-ink-2">{refused.reason}</p>
              {refused.suggestion ? (
                <Button variant="link" className="mt-1 text-[0.9rem]" onClick={() => add.mutate({ text: refused.suggestion!.record.DOI ?? refused.suggestion!.record.title ?? "" })}>
                  Add the real paper instead: “{refused.suggestion.record.title?.slice(0, 80)}”
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {pending ? (
          <div className="mt-3 rounded-xl border border-rule-strong bg-paper px-4 py-3" role="status">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={pending.result.status} label={trustLabel(pending.result.status, pending.result.reasonCode).name} />
              <span className="text-[0.84rem] font-semibold text-ink-3">Checked just now. Not in your library until you approve it.</span>
            </div>
            <p className="mt-2 font-bold leading-snug text-ink [overflow-wrap:anywhere]">{pending.csl.title ?? pending.text}</p>
            <p className="text-[0.88rem] text-ink-2">
              {cslAuthors(pending.csl)}
              {cslYear(pending.csl) ? ` · ${cslYear(pending.csl)}` : ""}
            </p>
            <p className="mt-1.5 text-[0.9rem] text-ink-2">{pending.result.reason}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant={pending.result.status === "verified" ? "primary" : "secondary"} loading={add.isPending} onClick={() => add.mutate({ text: pending.text, approved: true })}>
                <Check className="size-4" aria-hidden />
                {pending.result.status === "verified" ? "Approve and add to my references" : `Add anyway, labelled “${trustLabel(pending.result.status, pending.result.reasonCode).name}”`}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPending(null)} disabled={add.isPending}>
                Don&rsquo;t add
              </Button>
            </div>
          </div>
        ) : null}
      </form>

      <div className="mt-6 grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Folders: pressboard tab colours */}
        <nav aria-label="Folders" className="space-y-1">
          {(
            [
              { id: "all", name: "All references", count: items.length, icon: LibraryBig },
              { id: "none", name: "Not in a folder", count: items.filter((i) => !i.folderId).length, icon: Inbox },
            ] as const
          ).map((f) => (
            <button key={f.id} type="button" onClick={() => setFolder(f.id)} aria-current={folder === f.id ? "true" : undefined} className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.92rem] font-semibold transition-colors", folder === f.id ? "bg-card text-ink shadow-card" : "text-ink-2 hover:bg-paper-2")}>
              <f.icon className="size-4 text-ink-3" aria-hidden />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="tabular text-[0.8rem] text-ink-3">{f.count}</span>
            </button>
          ))}
          <div className="pt-3">
            <p className="px-3 pb-1 text-[0.78rem] font-semibold text-ink-3">Folders</p>
            {folders.map((f) => (
              <button key={f.id} type="button" onClick={() => setFolder(f.id)} aria-current={folder === f.id ? "true" : undefined} className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[0.92rem] font-semibold transition-colors", folder === f.id ? "bg-card text-ink shadow-card" : "text-ink-2 hover:bg-paper-2")}>
                <span className={cn("h-3.5 w-5 shrink-0 rounded-t-[4px] rounded-b-[2px]", TAB_COLOR[f.color] ?? "bg-tab-sky")} aria-hidden />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="tabular text-[0.8rem] text-ink-3">{f.count}</span>
              </button>
            ))}
            {newFolder !== null ? (
              <form
                className="mt-1 px-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newFolder.trim()) createFolder.mutate(newFolder.trim());
                }}
              >
                <Input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Folder name" className="h-9" maxLength={60} onBlur={() => !newFolder.trim() && setNewFolder(null)} aria-label="New folder name" />
              </form>
            ) : (
              <button type="button" onClick={() => setNewFolder("")} className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[0.9rem] font-semibold text-accent hover:bg-paper-2">
                <FolderPlus className="size-4" aria-hidden /> New folder
              </button>
            )}
          </div>
        </nav>

        <section aria-label="References" className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[14rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search titles, authors, notes, DOIs…" className="pl-9" aria-label="Search the library" />
            </div>
            <div className="flex rounded-[10px] border border-rule-strong bg-card p-0.5" role="group" aria-label="Filter by status">
              {STATUS_FILTERS.map((s) => (
                <button key={s.id} type="button" onClick={() => setStatus(s.id)} aria-pressed={status === s.id} className={cn("rounded-lg px-3 py-1.5 text-[0.85rem] font-semibold", status === s.id ? "bg-accent text-accent-ink" : "text-ink-2 hover:text-ink")}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {allTags.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[0.8rem] font-semibold text-ink-3">Tags:</span>
              {allTags.map((t) => (
                <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)} aria-pressed={tag === t} className={cn("rounded-md px-2 py-0.5 text-[0.82rem] font-semibold", tag === t ? "bg-accent text-accent-ink" : "bg-paper-2 text-ink-2 hover:bg-rule")}>
                  {t}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mt-4 overflow-hidden rounded-2xl border border-rule bg-card shadow-card">
            {lib.isLoading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : !items.length ? (
              <EmptyState icon={<FolderOpen className="size-9" />} title="Your library is empty" action={<Button asChild variant="primary"><Link href="/audit">Check a reference list</Link></Button>}>
                Add a DOI above, save the results of a Citation Audit, or approve a research run. Everything is verified before it lands here.
              </EmptyState>
            ) : !shown.length ? (
              <EmptyState title="Nothing matches these filters">Try clearing the search, the status filter or the tag.</EmptyState>
            ) : (
              <table className="w-full text-left">
                <caption className="sr-only">References in your library</caption>
                <thead className="border-b border-rule bg-card-2 text-[0.78rem] text-ink-3">
                  <tr>
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(shown.map((i) => i.id)))} aria-label="Select all shown" />
                    </th>
                    <th scope="col" className="py-2.5 pr-3 font-semibold">Reference</th>
                    <th scope="col" className="hidden py-2.5 pr-3 font-semibold md:table-cell">Status</th>
                    <th scope="col" className="hidden py-2.5 pr-4 text-right font-semibold lg:table-cell">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.id} className={cn("border-b border-rule last:border-0 hover:bg-card-2", lastAdded === i.id && "fade-up bg-ok-tint/40")}>
                      <td className="px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          className="mt-1 size-4 accent-[var(--accent)]"
                          checked={selected.has(i.id)}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(i.id)) n.delete(i.id);
                              else n.add(i.id);
                              return n;
                            })
                          }
                          aria-label={`Select “${i.title}”`}
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <button type="button" onClick={() => setOpenId(i.id)} className="text-left">
                          <span className="block font-semibold leading-snug text-ink hover:text-accent">{i.title}</span>
                          <span className="mt-0.5 block text-[0.85rem] text-ink-2">
                            {cslAuthors(i.csl)} · {i.year ?? "n.d."}
                            {i.venue ? ` · ${i.venue}` : ""}
                          </span>
                        </button>
                        <span className="mt-1 flex flex-wrap gap-1.5 md:hidden">
                          <StatusChip status={i.status} label={trustLabel(i.status, i.verification?.reasonCode).name} />
                        </span>
                        {i.tags.length ? (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {i.tags.map((t) => (
                              <span key={t} className="rounded bg-paper-2 px-1.5 text-[0.75rem] font-semibold text-ink-3">{t}</span>
                            ))}
                          </span>
                        ) : null}
                      </td>
                      <td className="hidden py-3 pr-3 align-top md:table-cell">
                        <StatusChip status={i.status} label={trustLabel(i.status, i.verification?.reasonCode).name} />
                        {i.flags.some((f) => f.code === "retracted") ? <span className="ml-1.5 rounded-full bg-danger-tint px-2 py-1 text-[0.75rem] font-bold text-danger">Retracted</span> : null}
                      </td>
                      <td className="hidden whitespace-nowrap py-3 pr-4 text-right align-top text-[0.82rem] text-ink-3 lg:table-cell">{relativeTime(i.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      <ItemSheet item={openItem} folders={folders} defaultStyle={policy?.defaultStyle ?? "apa"} open={openItem !== null} onOpenChange={(o) => !o && setOpenId(null)} allowRelated={policy?.features.relatedPapers ?? true} />

      <Dialog
        open={citeOpen}
        onOpenChange={setCiteOpen}
        width="max-w-3xl"
        title={`Cite ${plural(selected.size, "reference")}`}
        description="Formatted by the official Citation Style Language styles."
        footer={
          citeOut ? (
            <>
              <Button variant="secondary" onClick={async () => (await copyText(citeOut)) && toast.success("Copied")}>
                <Copy className="size-4" aria-hidden /> Copy
              </Button>
              <Button variant="primary" onClick={() => download(`references-${citeStyle}.txt`, citeOut)}>
                <Download className="size-4" aria-hidden /> Download
              </Button>
            </>
          ) : null
        }
      >
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="cite-style" className="text-[0.78rem]">Style</Label>
            <Select id="cite-style" className="mt-1 w-full" value={citeStyle} onChange={(e) => { setCiteStyle(e.target.value as CitationStyleId); setCiteOut(null); }}>
              {Object.entries(CITATION_STYLES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>
          <Button variant="primary" onClick={() => cite.mutate()} loading={cite.isPending}>Format</Button>
        </div>
        {items.filter((i) => selected.has(i.id) && i.status !== "verified").length ? (
          <Notice tone="warn" className="mt-3">
            {plural(items.filter((i) => selected.has(i.id) && i.status !== "verified").length, "selected reference")} could not be fully confirmed. Check before submitting.
          </Notice>
        ) : null}
        {citeOut ? <pre className="mt-4 max-h-[45vh] overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl border border-rule bg-paper p-4 font-record text-[0.88rem] leading-relaxed text-ink">{citeOut}</pre> : null}
        {citeOut ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[0.92rem] font-bold text-ink">AI-use statement</h3>
              <Button variant="secondary" onClick={async () => (await copyText(libStatement)) && toast.success("Statement copied")}>
                <Copy className="size-4" aria-hidden /> Copy statement
              </Button>
            </div>
            <p className="mt-2 rounded-xl border border-rule bg-paper p-3 text-[0.9rem] leading-relaxed text-ink-2">{libStatement}</p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
