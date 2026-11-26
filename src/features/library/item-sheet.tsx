"use client";

import { trustLabel } from "@/shared/labels";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Trash, Plus, ExternalLink, Unlock, Check, X } from "lucide-react";
import type { LibraryItemDTO, RelatedPaper } from "@/server/services/library";
import { CITATION_STYLES, type CitationStyleId } from "@/shared/policy";
import { RECORD_STATUS } from "@/shared/labels";
import { api, errorMessage } from "@/lib/api";
import { cn, copyText, cslAuthors, cslVenue, cslYear, relativeTime } from "@/lib/utils";
import { Sheet, Tabs, TabsContent, TabsList, TabsTrigger, Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/misc";
import { Stamp, StatusIcon, toneText } from "@/components/ui/status";
import { Evidence } from "@/features/audit/evidence";
import type { FolderDTO } from "./hooks";

function CitePanel({ item, defaultStyle }: { item: LibraryItemDTO; defaultStyle: CitationStyleId }) {
  const [style, setStyle] = React.useState<CitationStyleId>(defaultStyle);
  const q = useQuery({ queryKey: ["cite", item.id, style], queryFn: () => api<{ entries: { id: string; text: string }[]; inText: string }>("/api/cite", { body: { ids: [item.id], style } }) });
  const entry = q.data?.entries[0]?.text ?? "";
  return (
    <section aria-labelledby="cite-h" className="rounded-xl border border-rule bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="cite-h" className="font-bold text-ink">Cite</h3>
        <Select aria-label="Citation style" value={style} onChange={(e) => setStyle(e.target.value as CitationStyleId)} className="h-9">
          {Object.entries(CITATION_STYLES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
      </div>
      {q.isLoading ? (
        <Skeleton className="mt-3 h-16" />
      ) : (
        <>
          <p className="mt-3 rounded-lg bg-paper px-3 py-2.5 font-record text-[0.88rem] leading-relaxed text-ink [overflow-wrap:anywhere]">{entry}</p>
          {q.data?.inText ? <p className="mt-2 text-[0.85rem] text-ink-2">In text: <span className="font-record">{q.data.inText}</span></p> : null}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="secondary" onClick={async () => (await copyText(entry)) && toast.success("Reference copied")}>
              <Copy className="size-4" aria-hidden /> Copy reference
            </Button>
            {q.data?.inText ? (
              <Button size="sm" variant="ghost" onClick={async () => (await copyText(q.data!.inText)) && toast.success("In-text citation copied")}>
                Copy in-text
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function RelatedList({ item, kind }: { item: LibraryItemDTO; kind: "references" | "cited-by" | "similar" }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["related", item.id, kind], queryFn: () => api<{ papers: RelatedPaper[]; note: string | null }>(`/api/library/${item.id}/related?kind=${kind}`), staleTime: 5 * 60_000 });
  const add = useMutation({
    mutationFn: (p: RelatedPaper) => api<{ added: boolean }>("/api/library/records", { body: { csl: p.csl, origin: "related", folderId: item.folderId } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["related", item.id] });
      toast.success(r.added ? "Verified and added to your library" : "Already in your library");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (q.isLoading) return <div className="space-y-2 py-3"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>;
  const papers = q.data?.papers ?? [];
  if (!papers.length) return <p className="py-4 text-[0.9rem] text-ink-2">{q.data?.note ?? "Nothing found."}</p>;
  return (
    <ul className="divide-y divide-rule">
      {papers.map((p) => (
        <li key={p.csl.id} className="flex gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug text-ink">{p.csl.title}</p>
            <p className="mt-0.5 text-[0.85rem] text-ink-2">
              {cslAuthors(p.csl, 2)} · {cslYear(p.csl) ?? "n.d."}
              {cslVenue(p.csl) ? ` · ${cslVenue(p.csl)}` : ""}
              {typeof p.citedByCount === "number" ? <span className="tabular"> · cited {p.citedByCount.toLocaleString()}×</span> : null}
            </p>
            <div className="mt-1 flex flex-wrap gap-3 text-[0.8rem]">
              {p.isRetracted ? <span className="font-bold text-danger">Retracted</span> : null}
              {p.oaUrl ? (
                <a href={p.oaUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ok hover:underline">
                  <Unlock className="size-3.5" aria-hidden /> Free to read
                </a>
              ) : null}
              {p.csl.DOI ? (
                <a href={`https://doi.org/${p.csl.DOI}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-record text-ink-3 hover:text-accent">
                  doi:{p.csl.DOI} <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
          </div>
          {p.inLibraryId ? (
            <span className="inline-flex shrink-0 items-center gap-1 self-start text-[0.82rem] font-semibold text-ok">
              <Check className="size-4" aria-hidden /> In library
            </span>
          ) : (
            <Button size="sm" variant="secondary" className="shrink-0 self-start" onClick={() => add.mutate(p)} loading={add.isPending && add.variables === p} disabled={!p.csl.DOI}>
              <Plus className="size-4" aria-hidden /> Add
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = React.useState("");
  const add = () => {
    const t = v.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setV("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-md bg-paper-2 py-1 pl-2 pr-1 text-[0.85rem] font-semibold text-ink-2">
            {t}
            <button type="button" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className="rounded p-0.5 hover:bg-rule">
              <X className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <Input
        className="mt-2 h-9"
        placeholder="Add a tag and press Enter"
        value={v}
        maxLength={40}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        aria-label="Add a tag"
      />
    </div>
  );
}

export function ItemSheet({ item, folders, defaultStyle, open, onOpenChange, allowRelated }: { item: LibraryItemDTO | null; folders: FolderDTO[]; defaultStyle: CitationStyleId; open: boolean; onOpenChange: (o: boolean) => void; allowRelated: boolean }) {
  const qc = useQueryClient();
  const [draftNotes, setDraftNotes] = React.useState<{ id: string; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const notes = item && draftNotes?.id === item.id ? draftNotes.value : (item?.notes ?? "");
  const setNotes = (value: string) => item && setDraftNotes({ id: item.id, value });

  const patch = useMutation({
    mutationFn: (body: { notes?: string; tags?: string[]; folderId?: string | null }) => api<LibraryItemDTO>(`/api/library/${item!.id}`, { method: "PATCH", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/library/${item!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library"] });
      setConfirmDelete(false);
      onOpenChange(false);
      toast.success("Deleted from your library");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!item) return null;
  const v = item.verification;
  const info = RECORD_STATUS[item.status];
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Reference" label="Reference details">
      <div className="space-y-5 p-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[1.15rem] font-bold leading-snug text-ink">{item.title}</p>
            <p className="mt-1 text-[0.92rem] text-ink-2">
              {cslAuthors(item.csl, 6)} · {item.year ?? "n.d."}
              {item.venue ? ` · ${item.venue}` : ""}
            </p>
            {item.doi ? (
              <a href={`https://doi.org/${item.doi}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-record text-[0.85rem] text-accent hover:underline">
                doi:{item.doi} <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
          <Stamp status={item.status} date={v?.checkedAt} word={trustLabel(item.status, v?.reasonCode).stamp} />
        </div>

        <p className={cn("flex items-start gap-2 text-[0.92rem] font-semibold", toneText[info.tone])}>
          <StatusIcon status={item.status} className="mt-0.5" />
          {v?.reason ?? info.description}
        </p>
        {item.override ? <p className="rounded-lg bg-warn-tint px-3 py-2 text-[0.88rem] text-ink-2"><strong className="text-warn">Kept unconfirmed.</strong> Reason: “{item.override.reason}”</p> : null}
        {item.flags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {item.flags.map((f) => (
              <span key={f.code} title={f.detail} className={cn("rounded-md px-2 py-0.5 text-[0.78rem] font-bold", f.severity === "danger" ? "bg-danger-tint text-danger" : f.severity === "warn" ? "bg-warn-tint text-warn" : "bg-paper-2 text-ink-2")}>
                {f.label}
              </span>
            ))}
          </div>
        ) : null}

        <CitePanel item={item} defaultStyle={defaultStyle} />

        <Tabs defaultValue="notes">
          <TabsList label="Reference sections">
            <TabsTrigger value="notes">Notes & tags</TabsTrigger>
            {allowRelated ? <TabsTrigger value="related">Related papers</TabsTrigger> : null}
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            {item.csl.abstract ? <TabsTrigger value="abstract">Abstract</TabsTrigger> : null}
          </TabsList>
          <TabsContent value="notes" className="space-y-4 pt-4">
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                className="mt-1.5"
                rows={5}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => notes !== item.notes && patch.mutate({ notes })}
                placeholder="Your thoughts, page numbers, quotes to come back to… Saved when you click away."
              />
            </div>
            <div>
              <Label>Tags</Label>
              <div className="mt-1.5">
                <TagEditor tags={item.tags} onChange={(tags) => patch.mutate({ tags })} />
              </div>
            </div>
            <div>
              <Label htmlFor="folder">Folder</Label>
              <Select id="folder" className="mt-1.5 w-full" value={item.folderId ?? ""} onChange={(e) => patch.mutate({ folderId: e.target.value || null })}>
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
            </div>
            <p className="text-[0.8rem] text-ink-3">Added {relativeTime(item.createdAt)} from {item.origin === "audit" ? "a Citation Audit" : item.origin === "research" ? "a research run" : item.origin === "related" ? "related papers" : "the add box"}.</p>
          </TabsContent>
          {allowRelated ? (
            <TabsContent value="related" className="pt-3">
              <p className="text-[0.85rem] text-ink-3">From OpenAlex. Everything you add is verified first, like any other reference.</p>
              <Tabs defaultValue="references" className="mt-2">
                <TabsList label="Related paper lists">
                  <TabsTrigger value="references">Earlier work</TabsTrigger>
                  <TabsTrigger value="cited-by">Later work</TabsTrigger>
                  <TabsTrigger value="similar">Similar</TabsTrigger>
                </TabsList>
                <TabsContent value="references"><RelatedList item={item} kind="references" /></TabsContent>
                <TabsContent value="cited-by"><RelatedList item={item} kind="cited-by" /></TabsContent>
                <TabsContent value="similar"><RelatedList item={item} kind="similar" /></TabsContent>
              </Tabs>
            </TabsContent>
          ) : null}
          <TabsContent value="evidence" className="pt-4">
            {v ? <Evidence result={v} /> : <p className="text-[0.9rem] text-ink-2">This record has no verification evidence (no DOI to check).</p>}
          </TabsContent>
          {item.csl.abstract ? (
            <TabsContent value="abstract" className="pt-4">
              <p className="text-[0.95rem] leading-relaxed text-ink-2">{item.csl.abstract}</p>
            </TabsContent>
          ) : null}
        </Tabs>

        <div className="border-t border-rule pt-5">
          <Button variant="quiet-danger" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash className="size-4" aria-hidden /> Delete from library
          </Button>
        </div>
      </div>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this reference?"
        description="It is removed from your library. The activity log keeps a record that you deleted it."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>Delete</Button>
          </>
        }
      />
    </Sheet>
  );
}
