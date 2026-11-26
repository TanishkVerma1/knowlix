"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, LockOpen, Download, Copy, LibraryBig, RefreshCw, ScrollText, FlaskConical, ArrowLeft, Check } from "lucide-react";
import type { AuditDTO, AuditItemDTO, AuditSummary } from "@/server/services/audits";
import { CITATION_STYLES, type CitationStyleId } from "@/shared/policy";
import { api, errorMessage, stream } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn, copyText, download, plural } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { RegisterRule } from "@/components/shell/app-shell";
import { Select, Textarea, Label } from "@/components/ui/field";
import { Dialog, Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/overlay";
import { Skeleton, Notice, EmptyState } from "@/components/ui/misc";
import { StatusChip } from "@/components/ui/status";
import { TrustLegend } from "@/components/ui/trust-legend";
import { ReferenceList, copyReferences, downloadForWord } from "@/components/ui/references";
import { referenceListStatement } from "@/shared/statement";
import { RecordCard, type Decision } from "./record-card";
import { ReportDialog } from "@/features/shared/report-dialog";

type StreamEvent =
  | { type: "start"; total: number; todo: number }
  | { type: "checking"; itemId: string }
  | { type: "result"; item: AuditItemDTO }
  | { type: "done"; summary: AuditSummary }
  | { type: "error"; message: string };

function summarise(items: AuditItemDTO[]): AuditSummary {
  const s: AuditSummary = { total: items.length, pending: 0, verified: 0, check: 0, mismatch: 0, removed: 0, kept: 0, replaced: 0, blocking: 0, undecided: 0, exportLocked: false };
  for (const it of items) {
    if (it.resolution === "replaced") s.replaced++;
    if (it.resolution === "kept") s.kept++;
    if (it.resolution === "removed") s.removed++;
    else if (it.resolution === "replaced") s.verified++;
    else if (it.status === "pending") s.pending++;
    else if (it.status === "verified") s.verified++;
    else if (it.status === "check") {
      s.check++;
      if (!it.resolution) s.undecided++;
    } else if (it.status === "mismatch") {
      s.mismatch++;
      if (!it.resolution) s.blocking++;
    }
  }
  s.exportLocked = s.blocking > 0 || s.undecided > 0 || s.pending > 0;
  return s;
}

const FORMATS = [
  { id: "text", label: "Formatted list", ext: "txt" },
  { id: "bibtex", label: "BibTeX (.bib)", ext: "bib" },
  { id: "ris", label: "RIS (.ris)", ext: "ris" },
  { id: "csl", label: "CSL-JSON", ext: "json" },
] as const;

export function AuditView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const key = React.useMemo(() => ["audit", id], [id]);
  const query = useQuery({ queryKey: key, queryFn: () => api<AuditDTO>(`/api/audits/${id}`) });
  const audit = query.data;

  const [running, setRunning] = React.useState(false);
  const [landed, setLanded] = React.useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [keepItem, setKeepItem] = React.useState<AuditItemDTO | null>(null);
  const [reason, setReason] = React.useState("");
  const [reportItem, setReportItem] = React.useState<AuditItemDTO | null>(null);
  const [styleChoice, setStyle] = React.useState<CitationStyleId | null>(null);
  const [format, setFormat] = React.useState<(typeof FORMATS)[number]["id"]>("text");
  const [exported, setExported] = React.useState<{ content: string; count: number; html?: string } | null>(null);
  const [tab, setTab] = React.useState("all");
  const started = React.useRef(false);

  const style: CitationStyleId = styleChoice ?? session.data?.policy.defaultStyle ?? "apa";

  const patchItem = React.useCallback(
    (item: AuditItemDTO) => {
      qc.setQueryData<AuditDTO>(key, (old) => {
        if (!old) return old;
        const items = old.items.map((i) => (i.id === item.id ? { ...i, ...item } : i));
        return { ...old, items, summary: summarise(items) };
      });
    },
    [qc, key],
  );

  const run = React.useCallback(
    async (recheck = false) => {
      setRunning(true);
      if (recheck) {
        qc.setQueryData<AuditDTO>(key, (old) => (old ? { ...old, items: old.items.map((i) => (i.resolution ? i : { ...i, status: "pending", result: null })) } : old));
      }
      try {
        await stream<StreamEvent>(`/api/audits/${id}/run${recheck ? "?recheck=1" : ""}`, (e) => {
          if (e.type === "result") {
            patchItem(e.item);
            setLanded((s) => new Set(s).add(e.item.id));
          } else if (e.type === "error") toast.error(e.message);
        });
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setRunning(false);
        qc.invalidateQueries({ queryKey: key });
        qc.invalidateQueries({ queryKey: ["audits"] });
        qc.invalidateQueries({ queryKey: ["activity"] });
      }
    },
    [id, key, patchItem, qc],
  );

  React.useEffect(() => {
    if (!audit || started.current) return;
    if (audit.summary.pending > 0) {
      started.current = true;
      const t = setTimeout(() => void run(false), 0);
      return () => clearTimeout(t);
    }
  }, [audit, run]);

  const decide = useMutation({
    mutationFn: ({ itemId, action, reason }: { itemId: string; action: Decision; reason?: string; merged?: boolean }) =>
      api<AuditDTO>(`/api/audits/${id}/items/${itemId}`, { method: "PATCH", body: { action, reason } }),
    onSuccess: (data, v) => {
      qc.setQueryData(key, data);
      qc.invalidateQueries({ queryKey: ["activity"] });
      const msg = { replace: "Replaced with the real record", remove: "Removed from the list", keep: "Kept, with your reason recorded", undo: "Decision undone" }[v.action];
      toast.success(v.merged ? "Merged: one entry kept" : msg);
      setKeepItem(null);
      setReason("");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const save = useMutation({
    mutationFn: () => api<{ added: number; skipped: number; undecided: number }>(`/api/audits/${id}/library`, { body: {} }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["audit", id] });
      toast.success(`${plural(r.added, "reference")} saved to your library`, {
        description: [
          r.skipped ? `${r.skipped} already there.` : "",
          r.undecided ? `${plural(r.undecided, "unconfirmed reference")} left out: replace, keep with a reason, or remove ${r.undecided === 1 ? "it" : "them"} first.` : "",
          "Proven-wrong and removed items are never saved.",
        ].filter(Boolean).join(" "),
        action: { label: "Open library", onClick: () => router.push("/library") },
      });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const doExport = useMutation({
    mutationFn: () => api<{ content: string; html?: string; count: number; duplicates?: number; asWritten?: number }>(`/api/audits/${id}/export?style=${style}&format=${format}`),
    onSuccess: (r) => {
      setExported(r);
      // Say plainly what the export did that the student might not expect.
      if (r.duplicates) toast.message(`${r.duplicates} duplicate ${r.duplicates === 1 ? "reference was" : "references were"} left out`, { description: "The same source appeared more than once in your list." });
      if (r.asWritten && format === "text") toast.message(`${r.asWritten} unconfirmed ${r.asWritten === 1 ? "reference is" : "references are"} printed exactly as you wrote ${r.asWritten === 1 ? "it" : "them"}`, { description: "Knowlix only re-formats references it could confirm." });
      qc.invalidateQueries({ queryKey: ["activity"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-28" />
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    );
  }
  if (query.isError || !audit) {
    return (
      <EmptyState title="This audit could not be opened" action={<Button asChild variant="secondary"><Link href="/audit">Back to Citation Audit</Link></Button>}>
        {errorMessage(query.error)}
      </EmptyState>
    );
  }

  const s = audit.summary;
  const done = s.total - s.pending;
  const attention = audit.items.filter((i) => !i.resolution && (i.status === "check" || i.status === "mismatch"));
  const lists: Record<string, AuditItemDTO[]> = {
    all: audit.items,
    attention,
    verified: audit.items.filter((i) => (i.status === "verified" && i.resolution !== "removed") || i.resolution === "replaced"),
    decided: audit.items.filter((i) => i.resolution),
  };
  const allowOverrides = session.data?.policy.allowOverrides ?? true;
  const fmt = FORMATS.find((f) => f.id === format)!;
  // The same paper pasted twice in different formats: the later one is offered for merging. The student decides.
  const duplicateOf = new Map<string, number>();
  {
    const firstSeen = new Map<string, number>();
    for (const it of audit.items) {
      const r = it.result;
      if (!r || it.status === "pending" || it.status === "mismatch") continue;
      const rec = r.record;
      const doi = (rec?.DOI ?? r.entered?.doi ?? "").toLowerCase();
      const title = (rec?.title ?? r.entered?.title ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      const key = doi ? `doi:${doi}` : title.length >= 12 ? `t:${title.slice(0, 90)}|${rec?.issued?.["date-parts"]?.[0]?.[0] ?? r.entered?.year ?? ""}` : "";
      if (!key) continue;
      const original = firstSeen.get(key);
      if (original !== undefined) duplicateOf.set(it.id, original);
      else if (it.resolution !== "removed") firstSeen.set(key, it.position + 1);
    }
  }
  const openDuplicates = audit.items.filter((it) => duplicateOf.has(it.id) && it.resolution !== "removed");
  const auditStatement = !exported ? "" : referenceListStatement({ total: exported?.count ?? 0, verified: Math.min(exported?.count ?? 0, s.verified), retracted: audit.items.filter((it) => it.resolution !== "removed" && it.result?.flags.some((f) => f.code === "retracted")).length, style: CITATION_STYLES[style] });

  const tryExport = () => {
    if (!s.exportLocked) doExport.mutate();
  };

  return (
    <div>
      <Link href="/audit" className="no-print mb-4 inline-flex items-center gap-1.5 text-[0.9rem] font-semibold text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All audits
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.6rem] font-extrabold leading-[1.12] text-ink sm:text-[1.95rem]">{audit.title}</h1>
          {audit.isSample ? (
            <p className="mt-2 inline-flex items-center gap-2 rounded-lg bg-neutral-tint px-3 py-1.5 text-[0.88rem] font-semibold text-neutral">
              <FlaskConical className="size-4" aria-hidden />
              Sample list: real references mixed with invented ones. Every check below ran against the live registries; nothing is pre-recorded.
            </p>
          ) : null}
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => run(true)} disabled={running}>
            <RefreshCw className={cn("size-4", running && "animate-spin")} aria-hidden />
            Re-check
          </Button>
          <Button variant="secondary" asChild>
            <Link href={`/receipts/audit/${audit.id}`}>
              <ScrollText className="size-4" aria-hidden />
              Honesty receipt
            </Link>
          </Button>
        </div>
      </div>
      <RegisterRule className="no-print mt-4" />
      <TrustLegend show={["references"]} className="mt-4" />

      {/* Summary + export: the control panel of the audit */}
      <section className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_25rem]" aria-label="Audit summary">
        <div className="rounded-2xl border border-rule bg-card p-5 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[0.95rem] font-semibold text-ink-2" aria-live="polite">
              {running || s.pending ? `Checking ${done} of ${s.total}…` : `${plural(s.total, "reference")} checked`}
            </p>
            {s.kept || s.replaced || s.removed ? (
              <p className="text-[0.85rem] text-ink-3">
                Your decisions: {[s.replaced && `${s.replaced} replaced`, s.kept && `${s.kept} kept with reason`, s.removed && `${s.removed} removed`].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuemin={0} aria-valuemax={s.total} aria-valuenow={done} aria-label="Checking progress">
            <div className="flex h-full">
              <div className="bg-[var(--ok-stamp)] transition-[width] duration-500" style={{ width: `${(s.verified / Math.max(1, s.total)) * 100}%` }} />
              <div className="bg-[var(--warn-stamp)] transition-[width] duration-500" style={{ width: `${(s.check / Math.max(1, s.total)) * 100}%` }} />
              <div className="bg-[var(--danger-stamp)] transition-[width] duration-500" style={{ width: `${(s.mismatch / Math.max(1, s.total)) * 100}%` }} />
              <div className="bg-rule-strong transition-[width] duration-500" style={{ width: `${(s.removed / Math.max(1, s.total)) * 100}%` }} />
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["verified", s.verified, "Verified"],
                ["check", s.check, "Please check"],
                ["mismatch", s.mismatch, "Mismatch"],
                ["pending", s.pending, "Checking"],
              ] as const
            ).map(([st, n, label]) => (
              <div key={st} className="rounded-xl bg-paper px-3 py-2.5">
                <dt className="flex items-center gap-1.5">
                  <StatusChip status={st} label={label} className="bg-transparent px-0 py-0" />
                </dt>
                <dd className="mt-1 text-[1.8rem] font-extrabold leading-none text-ink tabular">{n}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className={cn("rounded-2xl border p-5 shadow-card", s.exportLocked ? "border-[color-mix(in_oklab,var(--danger)_30%,var(--rule))] bg-card" : "border-rule bg-card")}>
          <div className="flex items-center gap-2">
            {s.exportLocked ? <Lock className="size-5 text-danger" aria-hidden /> : <LockOpen className="size-5 text-ok" aria-hidden />}
            <h2 className="text-[1.05rem] font-bold text-ink">{s.exportLocked ? "Export locked" : "Export"}</h2>
          </div>
          <p className="mt-1 text-[0.88rem] text-ink-2">
            {s.pending
              ? "Wait until every reference is checked."
              : s.blocking
                ? `${plural(s.blocking, "reference")} ${s.blocking === 1 ? "is" : "are"} proven wrong. Replace or remove ${s.blocking === 1 ? "it" : "them"} to unlock.`
                : s.undecided
                  ? `${plural(s.undecided, "reference")} still ${s.undecided === 1 ? "needs" : "need"} a decision: use the official record, keep it with a reason, or remove it.`
                  : "Every reference is verified or decided. Ready to cite."}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="exp-style" className="text-[0.78rem]">Style</Label>
              <Select id="exp-style" value={style} onChange={(e) => setStyle(e.target.value as CitationStyleId)} className="mt-1 w-full" disabled={format !== "text"}>
                {Object.entries(CITATION_STYLES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="exp-format" className="text-[0.78rem]">Format</Label>
              <Select id="exp-format" value={format} onChange={(e) => setFormat(e.target.value as typeof format)} className="mt-1 w-full">
                {FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" onClick={tryExport} disabled={s.exportLocked} loading={doExport.isPending}>
              {s.exportLocked ? <Lock className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
              Export
            </Button>
            <Button variant="secondary" onClick={() => save.mutate()} disabled={s.pending > 0} loading={save.isPending}>
              <LibraryBig className="size-4" aria-hidden />
              Save to library
            </Button>
          </div>
        </div>
      </section>

      {s.mismatch > 0 && !s.pending ? (
        <Notice tone="danger" className="mt-4" title={`${plural(s.mismatch, "reference")} ${s.mismatch === 1 ? "is" : "are"} proven wrong`}>
          A DOI that does not exist, or that belongs to a different paper, is not a typo Knowlix can guess around. These cannot be kept: use the real paper if Knowlix found it, or remove them.
        </Notice>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="mt-7">
        <TabsList label="Filter references">
          <TabsTrigger value="all" count={lists.all.length}>All</TabsTrigger>
          <TabsTrigger value="attention" count={lists.attention.length}>Needs a decision</TabsTrigger>
          <TabsTrigger value="verified" count={lists.verified.length}>Verified</TabsTrigger>
          <TabsTrigger value="decided" count={lists.decided.length}>Decided</TabsTrigger>
        </TabsList>
        {openDuplicates.length ? (
          <Notice tone="warn" title={openDuplicates.length === 1 ? "Duplicate found" : `${openDuplicates.length} duplicates found`} className="mt-4">
            <ul className="space-y-2">
              {openDuplicates.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="min-w-0 flex-1">
                    No. {String(it.position + 1).padStart(2, "0")} is the same paper as No. {String(duplicateOf.get(it.id)).padStart(2, "0")}, written in a different format. Nothing is merged until you say so.
                  </span>
                  <Button variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate({ itemId: it.id, action: "remove", merged: true })}>
                    Merge into No. {String(duplicateOf.get(it.id)).padStart(2, "0")}
                  </Button>
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {Object.entries(lists).map(([k, items]) => (
          <TabsContent key={k} value={k} className="mt-4 space-y-4 focus-visible:outline-none">
            {items.length ? (
              items.map((item) => (
                <RecordCard
                  key={item.id}
                  item={item}
                  landed={landed.has(item.id)}
                  expanded={expanded === item.id}
                  dimmed={expanded !== null && expanded !== item.id}
                  busy={decide.isPending}
                  allowOverrides={allowOverrides}
                  onToggle={() => setExpanded((e) => (e === item.id ? null : item.id))}
                  onDecide={(action) => decide.mutate({ itemId: item.id, action })}
                  onKeep={() => {
                    setReason("");
                    setKeepItem(item);
                  }}
                  onReport={() => setReportItem(item)}
                  onRecheck={running ? undefined : () => run(true)}
                  duplicateOf={duplicateOf.get(item.id) ?? null}
                  onMerge={() => decide.mutate({ itemId: item.id, action: "remove", merged: true })}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-rule-strong px-6 py-10 text-center text-ink-2">
                {k === "attention" ? (
                  <span className="inline-flex items-center gap-2 font-semibold text-ok">
                    <Check className="size-5" aria-hidden /> Nothing needs a decision.
                  </span>
                ) : (
                  "Nothing here yet."
                )}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Keep with a reason */}
      <Dialog
        open={keepItem !== null}
        onOpenChange={(o) => !o && setKeepItem(null)}
        title="Keep this reference unconfirmed?"
        description="Knowlix could not confirm it. If you know it is real (for example, a book chapter or a report), say why. Your reason is printed on your honesty receipt."
        footer={
          <>
            <Button variant="ghost" onClick={() => setKeepItem(null)}>Cancel</Button>
            <Button variant="primary" disabled={reason.trim().length < 10} loading={decide.isPending} onClick={() => keepItem && decide.mutate({ itemId: keepItem.id, action: "keep", reason })}>
              Keep with this reason
            </Button>
          </>
        }
      >
        <p className="rounded-lg bg-paper px-3 py-2 font-record text-[0.85rem] text-ink-2 [overflow-wrap:anywhere]">{keepItem?.raw}</p>
        <Label htmlFor="keep-reason" className="mt-4 block">Your reason</Label>
        <Textarea
          id="keep-reason"
          className="mt-1.5"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Course reader chapter provided by my lecturer; I have the printed copy."
          maxLength={500}
        />
        <p className={cn("mt-1 text-[0.8rem]", reason.trim().length < 10 ? "text-ink-3" : "text-ok")}>
          {reason.trim().length < 10 ? `At least 10 characters (${reason.trim().length}/10)` : "Thanks, that will appear on your receipt."}
        </p>
      </Dialog>

      {/* Export result */}
      <Dialog
        open={exported !== null}
        onOpenChange={(o) => !o && setExported(null)}
        width="max-w-3xl"
        title={`Exported ${plural(exported?.count ?? 0, "reference")}`}
        description={format === "text" ? `${CITATION_STYLES[style]}. Removed and proven-wrong references are left out.` : `${fmt.label}. Removed and proven-wrong references are left out.`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={async () => {
                if (exported && (await copyReferences(format === "text" ? exported.html : "", exported.content))) toast.success(format === "text" && exported.html ? "Copied with italics" : "Copied to clipboard");
              }}
            >
              <Copy className="size-4" aria-hidden /> Copy
            </Button>
            <Button variant={format === "text" && exported?.html ? "secondary" : "primary"} onClick={() => exported && download(`knowlix-references.${fmt.ext}`, exported.content)}>
              <Download className="size-4" aria-hidden /> Download .{fmt.ext}
            </Button>
            {format === "text" && exported?.html ? (
              <Button variant="primary" onClick={() => downloadForWord(exported.html!, "knowlix-references")}>
                <Download className="size-4" aria-hidden /> Word (.rtf)
              </Button>
            ) : null}
          </>
        }
      >
        <ReferenceList html={format === "text" ? exported?.html : ""} text={exported?.content ?? ""} />
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[0.92rem] font-bold text-ink">AI-use statement</h3>
            <Button variant="secondary" onClick={async () => (await copyText(auditStatement)) && toast.success("Statement copied")}>
              <Copy className="size-4" aria-hidden /> Copy statement
            </Button>
          </div>
          <p className="mt-2 rounded-xl border border-rule bg-paper p-3 text-[0.9rem] leading-relaxed text-ink-2">{auditStatement}</p>
        </div>
      </Dialog>

      <ReportDialog
        open={reportItem !== null}
        onOpenChange={(o) => !o && setReportItem(null)}
        subjectType="audit-item"
        subjectId={reportItem?.id ?? ""}
        context={reportItem?.raw}
      />
    </div>
  );
}
