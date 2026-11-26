import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { WorkspaceCtx } from "../auth/workspace";
import { getPolicy } from "../auth/workspace";
import { auditItems, audits, folders, libraryItems } from "../db/schema";
import { parseInput } from "../verify/structured";
import { verifyReference } from "../verify/verify";
import { tryLog } from "../audit/activity";
import { ApiError } from "../http/api";
import { isStudentVersion, recordColumns, recordForResult } from "./records";
import { formatBibliography, formatEach, toBibtex, toRis } from "../cite/citeproc";
import type { CitationStyleId } from "@/shared/policy";
import type { CslItem, RecordStatus, VerificationResult } from "@/shared/types";
import { SAMPLE_REFERENCE_LIST } from "./samples";

export type Resolution = "replaced" | "removed" | "kept" | null;

export interface AuditItemDTO {
  id: string;
  position: number;
  raw: string;
  status: RecordStatus;
  result: VerificationResult | null;
  resolution: Resolution;
  resolutionReason: string | null;
  libraryItemId: string | null;
  parsed: { title?: string; year?: number; authors: { family: string }[]; doi?: string; format: string };
}

export interface AuditDTO {
  id: string;
  title: string;
  isSample: boolean;
  createdAt: string;
  completedAt: string | null;
  items: AuditItemDTO[];
  summary: AuditSummary;
}

export interface AuditSummary {
  total: number;
  pending: number;
  verified: number;
  check: number;
  mismatch: number;
  removed: number;
  kept: number;
  replaced: number;
  /** Red items that still need a decision: export is locked while > 0. */
  blocking: number;
  /** Amber items with no decision yet. */
  undecided: number;
  exportLocked: boolean;
}

/** What an item counts as after the student's decision. */
export function effectiveStatus(status: RecordStatus, resolution: Resolution): RecordStatus | "removed" {
  if (resolution === "removed") return "removed";
  if (resolution === "replaced") return "verified";
  return status;
}

export function summarise(items: { status: string; resolution: string | null; result: VerificationResult | null }[]): AuditSummary {
  const s: AuditSummary = { total: items.length, pending: 0, verified: 0, check: 0, mismatch: 0, removed: 0, kept: 0, replaced: 0, blocking: 0, undecided: 0, exportLocked: false };
  for (const it of items) {
    const eff = effectiveStatus(it.status as RecordStatus, it.resolution as Resolution);
    if (it.resolution === "replaced") s.replaced++;
    if (it.resolution === "kept") s.kept++;
    if (eff === "removed") s.removed++;
    else if (eff === "pending") s.pending++;
    else if (eff === "verified") s.verified++;
    else if (eff === "check") {
      s.check++;
      if (!it.resolution) s.undecided++;
    } else if (eff === "mismatch") {
      s.mismatch++;
      if (!it.resolution) s.blocking++;
    }
  }
  s.exportLocked = s.blocking > 0 || s.undecided > 0 || s.pending > 0;
  return s;
}

function toDTO(row: typeof auditItems.$inferSelect): AuditItemDTO {
  return {
    id: row.id,
    position: row.position,
    raw: row.raw,
    status: row.status as RecordStatus,
    result: row.result ?? null,
    resolution: (row.resolution as Resolution) ?? null,
    resolutionReason: row.resolutionReason,
    libraryItemId: row.libraryItemId,
    parsed: {
      title: row.parsed.title,
      year: row.parsed.year,
      authors: row.parsed.authors.map((a) => ({ family: a.family })),
      doi: row.parsed.doi,
      format: row.parsed.format,
    },
  };
}

export async function createAudit(ctx: WorkspaceCtx, input: { text?: string; sample?: boolean }) {
  const text = input.sample ? SAMPLE_REFERENCE_LIST : (input.text ?? "");
  if (!text.trim()) throw new ApiError(400, "empty", "Paste at least one reference.");
  const { items, truncated, unreadable } = await parseInput(text);
  if (!items.length) throw new ApiError(422, "no-references", "No references were found in that text. Put each reference on its own line.");
  const firstTitle = items[0].title ?? items[0].raw;
  const title = input.sample
    ? "Sample list (contains invented references)"
    : `${truncated ? `First ${items.length} references of a longer list` : `${items.length} reference${items.length > 1 ? "s" : ""}`} · ${firstTitle.slice(0, 48)}${firstTitle.length > 48 ? "…" : ""}`;
  const [audit] = await ctx.db.insert(audits).values({ workspaceId: ctx.workspaceId, title, input: text.slice(0, 100_000), isSample: Boolean(input.sample) }).returning();
  await ctx.db.insert(auditItems).values(
    items.map((p, i) => ({ auditId: audit.id, workspaceId: ctx.workspaceId, position: i, raw: p.raw.slice(0, 4000), parsed: p, status: "pending" })),
  );
  await tryLog(ctx.db, ctx.workspaceId, {
    actor: "student",
    action: "audit.created",
    subjectType: "audit",
    subjectId: audit.id,
    summary: `Pasted ${items.length} reference${items.length > 1 ? "s" : ""} for checking${input.sample ? " (sample list)" : ""}.`,
    details: { count: items.length, truncated, unreadable },
  });
  return { auditId: audit.id, count: items.length, truncated, unreadable };
}

export async function getAudit(ctx: WorkspaceCtx, auditId: string): Promise<AuditDTO> {
  const [audit] = await ctx.db.select().from(audits).where(and(eq(audits.id, auditId), eq(audits.workspaceId, ctx.workspaceId))).limit(1);
  if (!audit) throw new ApiError(404, "not-found", "That audit does not exist in your workspace.");
  const rows = await ctx.db.select().from(auditItems).where(eq(auditItems.auditId, auditId)).orderBy(asc(auditItems.position));
  return {
    id: audit.id,
    title: audit.title,
    isSample: audit.isSample,
    createdAt: audit.createdAt.toISOString(),
    completedAt: audit.completedAt?.toISOString() ?? null,
    items: rows.map(toDTO),
    summary: summarise(rows),
  };
}

export async function listAudits(ctx: WorkspaceCtx) {
  const list = await ctx.db.select().from(audits).where(eq(audits.workspaceId, ctx.workspaceId)).orderBy(desc(audits.createdAt)).limit(30);
  if (!list.length) return [];
  const rows = await ctx.db
    .select({ auditId: auditItems.auditId, status: auditItems.status, resolution: auditItems.resolution, result: auditItems.result })
    .from(auditItems)
    .where(inArray(auditItems.auditId, list.map((a) => a.id)));
  return list.map((a) => ({
    id: a.id,
    title: a.title,
    isSample: a.isSample,
    createdAt: a.createdAt.toISOString(),
    completedAt: a.completedAt?.toISOString() ?? null,
    summary: summarise(rows.filter((r) => r.auditId === a.id)),
  }));
}

/** Verifies every pending item, streaming each result the moment it is ready. */
export async function runAudit(ctx: WorkspaceCtx, auditId: string, send: (e: unknown) => void, opts: { recheck?: boolean } = {}) {
  const audit = await getAudit(ctx, auditId);
  const todo = audit.items.filter((i) => opts.recheck || i.status === "pending");
  send({ type: "start", total: audit.items.length, todo: todo.length });
  const rows = await ctx.db.select().from(auditItems).where(and(eq(auditItems.auditId, auditId), inArray(auditItems.id, todo.map((t) => t.id).concat(["00000000-0000-0000-0000-000000000000"]))));
  const byId = new Map(rows.map((r) => [r.id, r]));
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const item = todo[cursor++];
      const row = byId.get(item.id);
      if (!row) continue;
      send({ type: "checking", itemId: item.id });
      const result = await verifyReference(row.parsed);
      await ctx.db.update(auditItems).set({ status: result.status, result, updatedAt: new Date() }).where(eq(auditItems.id, item.id));
      send({ type: "result", item: { ...item, status: result.status, result } });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await ctx.db.update(audits).set({ completedAt: new Date() }).where(eq(audits.id, auditId));
  const done = await getAudit(ctx, auditId);
  await tryLog(ctx.db, ctx.workspaceId, {
    actor: "verifier",
    action: "audit.checked",
    subjectType: "audit",
    subjectId: auditId,
    summary: `Checked ${todo.length} reference${todo.length === 1 ? "" : "s"}: Verified ${done.summary.verified} · Please check ${done.summary.check} · Mismatch ${done.summary.mismatch}.`,
    details: { verified: done.summary.verified, check: done.summary.check, mismatch: done.summary.mismatch },
  });
  send({ type: "done", summary: done.summary });
}

export async function resolveItem(ctx: WorkspaceCtx, auditId: string, itemId: string, action: "replace" | "remove" | "keep" | "undo", reason?: string) {
  const [row] = await ctx.db
    .select()
    .from(auditItems)
    .where(and(eq(auditItems.id, itemId), eq(auditItems.auditId, auditId), eq(auditItems.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!row) throw new ApiError(404, "not-found", "That reference is not in this audit.");
  const result = row.result;
  if (action !== "undo" && !result) throw new ApiError(409, "not-checked", "Wait for this reference to be checked first.");
  const policy = await getPolicy(ctx.db, ctx.workspaceId);

  let resolution: Resolution = null;
  let resolutionReason: string | null = null;
  let summary = "";
  const label = (row.parsed.title ?? row.raw).slice(0, 80);
  if (action === "replace") {
    // Only a confident match can stand in for the student's reference: the real paper found for a wrong DOI,
    // or a record that matched well enough to be "close". A "not found" result has nothing to offer.
    const confident = result && !result.provenWrong && result.record && result.reasonCode !== "not-found" && result.reasonCode !== "too-little-info" && result.reasonCode !== "service-unavailable" && result.reasonCode !== "web-page" && result.reasonCode !== "link-unreachable" && (result.score === null || result.score >= 70);
    const record = result?.suggestion?.record ?? (confident ? result!.record : null);
    if (!record || !record.title) throw new ApiError(409, "no-record", "There is no confirmed record to replace this with. Fix the details yourself, keep it with a reason, or remove it.");
    // Swapping in the official record fixes wrong details. It cannot fix a problem with the paper itself.
    const paperProblem = !result?.suggestion && result?.flags.find((f) => f.code === "retracted" || f.code === "expression-of-concern" || f.code === "second-opinion-disagrees");
    if (paperProblem) {
      throw new ApiError(409, "replace-does-not-fix", `Using the official record cannot clear this: the warning is about the paper (${paperProblem.label.toLowerCase()}), not about your details. Remove it, or keep it with a reason.`);
    }
    resolution = "replaced";
    summary = `Replaced “${label}” with the real record${record.DOI ? ` (DOI ${record.DOI})` : ""}.`;
  } else if (action === "remove") {
    resolution = "removed";
    summary = `Removed “${label}” from the list.`;
  } else if (action === "keep") {
    if (result?.provenWrong) throw new ApiError(409, "proven-wrong", "This reference is proven wrong. It can only be fixed or removed, not kept.");
    if (!policy.allowOverrides) throw new ApiError(403, "overrides-off", "Your course policy does not allow keeping unconfirmed references.");
    const r = (reason ?? "").trim();
    if (r.length < 10) throw new ApiError(400, "reason-required", "Write a short reason (at least 10 characters). It will appear on your honesty receipt.");
    resolution = "kept";
    resolutionReason = r.slice(0, 500);
    summary = `Kept “${label}” unconfirmed. Reason: ${resolutionReason}`;
  } else {
    summary = `Undid the decision on “${label}”.`;
  }
  await ctx.db.update(auditItems).set({ resolution, resolutionReason, updatedAt: new Date() }).where(eq(auditItems.id, itemId));
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: `audit.item.${action}`, subjectType: "audit-item", subjectId: itemId, summary, details: resolutionReason ? { reason: resolutionReason } : undefined });
  return getAudit(ctx, auditId);
}

/** Items that go into exports: everything except removed, with the right record for each decision. */
async function exportableRecords(ctx: WorkspaceCtx, auditId: string) {
  const audit = await getAudit(ctx, auditId);
  const rows = await ctx.db.select().from(auditItems).where(eq(auditItems.auditId, auditId)).orderBy(asc(auditItems.position));
  const kept = rows.filter((r) => r.result && r.resolution !== "removed" && !(r.status === "mismatch" && r.resolution !== "replaced"));
  // The same paper cited twice is listed once.
  const seen = new Set<string>();
  const records: CslItem[] = [];
  /** For each record: the student's own wording when that is what is being exported, else null. */
  const asWritten: (string | null)[] = [];
  let duplicates = 0;
  for (const r of kept) {
    const csl = recordForResult(r.result!, r.parsed, r.resolution, `ref-${r.position + 1}`);
    const key = csl.DOI ? `doi:${csl.DOI.toLowerCase()}` : `t:${(csl.title ?? r.raw).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 90)}|${csl.issued?.["date-parts"]?.[0]?.[0] ?? ""}|${(csl.author?.[0]?.family ?? "").toLowerCase()}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    records.push(csl);
    asWritten.push(isStudentVersion(r.result!, r.parsed, r.resolution) ? r.raw.replace(/^\s*(?:\[\d+\]|\(\d+\)|\d+[.)]|[-–•*])\s+/, "").trim() : null);
  }
  return { audit, records, rows, asWritten, duplicates };
}

const NUMBERED: CitationStyleId[] = ["ieee", "vancouver"];

/**
 * The formatted reference list. Confirmed records are formatted in the chosen
 * style. A reference the student kept unconfirmed is printed exactly as they
 * wrote it: re-formatting an unconfirmed reference from a best-guess parse
 * could change it.
 */
async function formattedList(records: CslItem[], asWritten: (string | null)[], style: CitationStyleId): Promise<string> {
  if (!records.length) return "";
  if (!asWritten.some(Boolean)) return formatBibliography(records, style, "text");
  const each = await formatEach(records, style);
  const lines = each.map((e, i) => asWritten[i] ?? e.replace(/^\s*(?:\[\d+\]|\d+\.)\s*/, ""));
  if (NUMBERED.includes(style)) return lines.map((l, i) => (style === "ieee" ? `[${i + 1}] ${l}` : `${i + 1}. ${l}`)).join("\n");
  return [...lines].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })).join("\n");
}

export async function exportAudit(ctx: WorkspaceCtx, auditId: string, style: CitationStyleId, format: "text" | "bibtex" | "ris" | "csl") {
  const { audit, records, asWritten, duplicates } = await exportableRecords(ctx, auditId);
  if (audit.summary.pending > 0) throw new ApiError(409, "pending", "Some references are still being checked.");
  if (audit.summary.undecided > 0 && audit.summary.blocking === 0) {
    throw new ApiError(423, "export-locked", `Export is locked: ${audit.summary.undecided} reference${audit.summary.undecided > 1 ? "s need" : " needs"} a decision. Use the official record, keep it with a reason, or remove it.`, { undecided: audit.summary.undecided });
  }
  if (audit.summary.blocking > 0) {
    throw new ApiError(423, "export-locked", `Export is locked: ${audit.summary.blocking} reference${audit.summary.blocking > 1 ? "s are" : " is"} proven wrong. Replace or remove ${audit.summary.blocking > 1 ? "them" : "it"} first.`, { blocking: audit.summary.blocking });
  }
  let content: string;
  if (format === "bibtex") content = await toBibtex(records);
  else if (format === "ris") content = await toRis(records);
  else if (format === "csl") content = JSON.stringify(records, null, 2);
  else content = await formattedList(records, asWritten, style);
  const asIs = asWritten.filter(Boolean).length;
  await tryLog(ctx.db, ctx.workspaceId, {
    actor: "student",
    action: "audit.exported",
    subjectType: "audit",
    subjectId: auditId,
    summary: `Exported ${records.length} references as ${format === "text" ? style.toUpperCase() : format.toUpperCase()}.${duplicates ? ` ${duplicates} duplicate${duplicates > 1 ? "s were" : " was"} left out.` : ""}${asIs && format === "text" ? ` ${asIs} unconfirmed reference${asIs > 1 ? "s are" : " is"} printed as written.` : ""}`,
  });
  return { content, count: records.length, summary: audit.summary, duplicates, asWritten: asIs };
}

export async function saveAuditToLibrary(ctx: WorkspaceCtx, auditId: string, folderId: string | null) {
  const { rows } = await exportableRecords(ctx, auditId);
  if (folderId) {
    const [own] = await ctx.db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, folderId), eq(folders.workspaceId, ctx.workspaceId))).limit(1);
    if (!own) throw new ApiError(404, "no-folder", "That folder does not exist in your workspace.");
  }
  const existing = await ctx.db.select({ doi: libraryItems.doi, title: libraryItems.title, year: libraryItems.year, firstAuthor: libraryItems.firstAuthor }).from(libraryItems).where(eq(libraryItems.workspaceId, ctx.workspaceId));
  const haveDoi = new Set(existing.map((e) => e.doi).filter(Boolean));
  // Two different works can share a title ("Deep learning"): the same work also shares year and first author.
  const sameWork = (c: { title: string; year: number | null; firstAuthor: string | null }) => `${c.title.toLowerCase()}|${c.year ?? ""}|${(c.firstAuthor ?? "").toLowerCase()}`;
  const haveTitle = new Set(existing.map(sameWork));
  let added = 0;
  let skipped = 0;
  let undecided = 0;
  for (const r of rows) {
    if (!r.result || r.resolution === "removed" || (r.status === "mismatch" && r.resolution !== "replaced") || r.libraryItemId) continue;
    // The library holds references you can trust or consciously kept: unconfirmed ones need a decision first.
    if (r.status === "check" && !r.resolution) {
      undecided++;
      continue;
    }
    const csl = recordForResult(r.result, r.parsed, r.resolution, "pending");
    const cols = recordColumns(csl);
    if ((cols.doi && haveDoi.has(cols.doi)) || haveTitle.has(sameWork(cols))) {
      skipped++;
      continue;
    }
    const status = r.resolution === "replaced" ? "verified" : r.status;
    const [item] = await ctx.db
      .insert(libraryItems)
      .values({
        workspaceId: ctx.workspaceId,
        folderId,
        csl,
        raw: r.raw,
        origin: "audit",
        ...cols,
        status,
        score: r.result.score,
        flags: r.result.flags,
        verification: r.result,
        override: r.resolution === "kept" ? { reason: r.resolutionReason ?? "", at: new Date().toISOString() } : null,
      })
      .returning({ id: libraryItems.id });
    await ctx.db.update(auditItems).set({ libraryItemId: item.id }).where(eq(auditItems.id, r.id));
    if (cols.doi) haveDoi.add(cols.doi);
    haveTitle.add(sameWork(cols));
    added++;
  }
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "library.added-from-audit", subjectType: "audit", subjectId: auditId, summary: `Saved ${added} checked reference${added === 1 ? "" : "s"} to the library${skipped ? ` (${skipped} already there)` : ""}${undecided ? `; ${undecided} unconfirmed left out until decided` : ""}.` });
  return { added, skipped, undecided };
}
