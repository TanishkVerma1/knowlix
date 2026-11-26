import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { WorkspaceCtx } from "../auth/workspace";
import { folders, libraryItems } from "../db/schema";
import { ApiError } from "../http/api";
import { tryLog } from "../audit/activity";
import { parseInput } from "../verify/structured";
import { verifyReference } from "../verify/verify";
import { recordColumns, recordForResult } from "./records";
import { openAlexByDoi, openAlexByIds, openAlexCitedBy, openAlexToCsl, type OpenAlexWork } from "../scholarly/openalex";
import { UpstreamError } from "../scholarly/http";
import { formatEach, formatInText } from "../cite/citeproc";
import { formatMarkedList } from "../cite/marked";
import { exportMark } from "@/shared/labels";
import type { CitationStyleId } from "@/shared/policy";
import type { CslItem, FlagInfo, RecordStatus, VerificationResult } from "@/shared/types";

export interface LibraryItemDTO {
  id: string;
  folderId: string | null;
  csl: CslItem;
  title: string;
  year: number | null;
  firstAuthor: string | null;
  venue: string | null;
  doi: string | null;
  status: RecordStatus;
  score: number | null;
  flags: FlagInfo[];
  override: { reason: string; at: string } | null;
  notes: string;
  tags: string[];
  origin: string;
  createdAt: string;
  updatedAt: string;
  verification: VerificationResult | null;
}

function toDTO(r: typeof libraryItems.$inferSelect): LibraryItemDTO {
  return {
    id: r.id,
    folderId: r.folderId,
    csl: r.csl,
    title: r.title,
    year: r.year,
    firstAuthor: r.firstAuthor,
    venue: r.venue,
    doi: r.doi,
    status: r.status as RecordStatus,
    score: r.score,
    flags: r.flags ?? [],
    override: r.override ?? null,
    notes: r.notes,
    tags: r.tags ?? [],
    origin: r.origin,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    verification: r.verification ?? null,
  };
}

export async function listLibrary(ctx: WorkspaceCtx) {
  const [items, fs] = await Promise.all([
    ctx.db.select().from(libraryItems).where(eq(libraryItems.workspaceId, ctx.workspaceId)).orderBy(desc(libraryItems.createdAt)).limit(1000),
    ctx.db.select().from(folders).where(eq(folders.workspaceId, ctx.workspaceId)).orderBy(folders.createdAt),
  ]);
  return {
    items: items.map(toDTO),
    folders: fs.map((f) => ({ id: f.id, name: f.name, color: f.color, count: items.filter((i) => i.folderId === f.id).length })),
  };
}

async function findDuplicate(ctx: WorkspaceCtx, csl: CslItem) {
  const cols = recordColumns(csl);
  const rows = await ctx.db
    .select({ id: libraryItems.id, doi: libraryItems.doi, title: libraryItems.title, year: libraryItems.year, firstAuthor: libraryItems.firstAuthor })
    .from(libraryItems)
    .where(eq(libraryItems.workspaceId, ctx.workspaceId));
  // Same DOI, or the same title AND year AND first author. A shared title alone is not a duplicate:
  // "Deep learning" is both a 2015 Nature paper and a 2016 MIT Press book.
  const same = (a: string | null, b: string | null) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
  return rows.find((r) => (cols.doi && r.doi === cols.doi) || (same(r.title, cols.title) && r.year === cols.year && same(r.firstAuthor, cols.firstAuthor))) ?? null;
}

/** A folder id is only ever accepted if the folder belongs to this workspace. */
async function assertFolder(ctx: WorkspaceCtx, folderId: string | null) {
  if (!folderId) return;
  const [own] = await ctx.db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, folderId), eq(folders.workspaceId, ctx.workspaceId))).limit(1);
  if (!own) throw new ApiError(404, "no-folder", "That folder does not exist in your workspace.");
}

/** Add by DOI / ISBN / arXiv / URL / a full reference. Checked first; proven-wrong items are refused. */
export async function addByInput(ctx: WorkspaceCtx, input: string, folderId: string | null, opts: { preview?: boolean } = {}) {
  await assertFolder(ctx, folderId);
  const { items } = await parseInput(input);
  const parsed = items[0];
  if (!parsed) throw new ApiError(422, "unreadable", "Paste a DOI, ISBN, arXiv ID or a full reference.");
  const result = await verifyReference(parsed);
  if (result.provenWrong) {
    await tryLog(ctx.db, ctx.workspaceId, { actor: "verifier", action: "library.refused", summary: `Refused to save a proven-wrong reference: ${result.reason}`, details: { input: input.slice(0, 300) } });
    return { added: false as const, reason: "proven-wrong" as const, result };
  }
  const csl = recordForResult(result, parsed, null, "pending");
  const dup = await findDuplicate(ctx, csl);
  if (dup) return { added: false as const, reason: "duplicate" as const, result, existingId: dup.id };
  // Checked, but nothing is saved until the student approves it.
  if (opts.preview) return { added: false as const, reason: "needs-approval" as const, result, csl };
  const [row] = await ctx.db
    .insert(libraryItems)
    .values({ workspaceId: ctx.workspaceId, folderId, csl, raw: parsed.raw, origin: "manual", ...recordColumns(csl), status: result.status, score: result.score, flags: result.flags, verification: result })
    .returning();
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "library.added", subjectType: "library-item", subjectId: row.id, summary: `Added “${row.title.slice(0, 80)}” (${result.status}).` });
  return { added: true as const, item: toDTO(row), result };
}

export async function addRecord(ctx: WorkspaceCtx, csl: CslItem, origin: "related" | "research", folderId: string | null = null) {
  await assertFolder(ctx, folderId);
  const dup = await findDuplicate(ctx, csl);
  if (dup) return { added: false as const, existingId: dup.id };
  const result = csl.DOI ? await verifyReference({ raw: csl.DOI, format: "doi", authors: [], doi: csl.DOI }) : null;
  if (result?.provenWrong) throw new ApiError(409, "proven-wrong", "That record could not be verified, so it was not saved.");
  const record = result?.record ? { ...result.record, abstract: result.record.abstract ?? csl.abstract } : csl;
  const [row] = await ctx.db
    .insert(libraryItems)
    .values({
      workspaceId: ctx.workspaceId,
      folderId,
      csl: record,
      origin,
      ...recordColumns(record),
      status: result?.status ?? "check",
      score: result?.score ?? null,
      flags: result?.flags ?? [{ code: "no-doi", label: "No DOI", detail: "This record has no DOI to verify.", severity: "info" }],
      verification: result,
    })
    .returning();
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "library.added", subjectType: "library-item", subjectId: row.id, summary: `Added “${row.title.slice(0, 80)}” from ${origin === "related" ? "related papers" : "a research run"}.` });
  return { added: true as const, item: toDTO(row) };
}

export async function updateItem(ctx: WorkspaceCtx, id: string, patch: { notes?: string; tags?: string[]; folderId?: string | null }) {
  const set: Partial<typeof libraryItems.$inferInsert> = { updatedAt: new Date() };
  if (patch.notes !== undefined) set.notes = patch.notes.slice(0, 20_000);
  if (patch.tags !== undefined) set.tags = [...new Set(patch.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (patch.folderId !== undefined) {
    if (patch.folderId) {
      const [f] = await ctx.db.select({ id: folders.id }).from(folders).where(and(eq(folders.id, patch.folderId), eq(folders.workspaceId, ctx.workspaceId))).limit(1);
      if (!f) throw new ApiError(404, "no-folder", "That folder does not exist.");
    }
    set.folderId = patch.folderId;
  }
  const [row] = await ctx.db.update(libraryItems).set(set).where(and(eq(libraryItems.id, id), eq(libraryItems.workspaceId, ctx.workspaceId))).returning();
  if (!row) throw new ApiError(404, "not-found", "That reference is not in your library.");
  return toDTO(row);
}

export async function deleteItem(ctx: WorkspaceCtx, id: string) {
  const [row] = await ctx.db.delete(libraryItems).where(and(eq(libraryItems.id, id), eq(libraryItems.workspaceId, ctx.workspaceId))).returning({ title: libraryItems.title });
  if (!row) throw new ApiError(404, "not-found", "That reference is not in your library.");
  await tryLog(ctx.db, ctx.workspaceId, { actor: "student", action: "library.deleted", subjectType: "library-item", subjectId: id, summary: `Deleted “${row.title.slice(0, 80)}” from the library.` });
}

export async function getItems(ctx: WorkspaceCtx, ids: string[]) {
  if (!ids.length) return [];
  const rows = await ctx.db.select().from(libraryItems).where(and(eq(libraryItems.workspaceId, ctx.workspaceId), inArray(libraryItems.id, ids)));
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(toDTO);
}

export async function cite(ctx: WorkspaceCtx, ids: string[], style: CitationStyleId) {
  const items = await getItems(ctx, ids);
  const csl = items.map((i, n) => ({ ...i.csl, id: `item-${n + 1}` }));
  // Warnings travel with the reference: anything that is not Verified is marked in the list itself.
  const marks = items.map((i) => exportMark(i.status, i.verification?.reasonCode, i.flags));
  const [entries, list, inText] = await Promise.all([formatEach(csl, style), formatMarkedList(csl, style, { marks }), formatInText(csl, style).catch(() => "")]);
  return { entries: items.map((i, n) => ({ id: i.id, text: entries[n] })), bibliography: list.text, bibliographyHtml: list.html, inText };
}

/* ───────────── Folders ───────────── */

export const FOLDER_COLORS = ["salmon", "sage", "sky", "buff", "lilac"] as const;

export async function createFolder(ctx: WorkspaceCtx, name: string, color?: string) {
  const count = (await ctx.db.select({ id: folders.id }).from(folders).where(eq(folders.workspaceId, ctx.workspaceId))).length;
  if (count >= 50) throw new ApiError(409, "too-many", "You can have up to 50 folders.");
  const c = FOLDER_COLORS.includes(color as (typeof FOLDER_COLORS)[number]) ? color! : FOLDER_COLORS[count % FOLDER_COLORS.length];
  const [f] = await ctx.db.insert(folders).values({ workspaceId: ctx.workspaceId, name: name.trim().slice(0, 60), color: c }).returning();
  return { id: f.id, name: f.name, color: f.color, count: 0 };
}

export async function renameFolder(ctx: WorkspaceCtx, id: string, name: string) {
  const [f] = await ctx.db.update(folders).set({ name: name.trim().slice(0, 60) }).where(and(eq(folders.id, id), eq(folders.workspaceId, ctx.workspaceId))).returning();
  if (!f) throw new ApiError(404, "not-found", "That folder does not exist.");
  return f;
}

export async function deleteFolder(ctx: WorkspaceCtx, id: string) {
  await ctx.db.delete(folders).where(and(eq(folders.id, id), eq(folders.workspaceId, ctx.workspaceId)));
}

/* ───────────── Related papers (ResearchRabbit-style, from OpenAlex) ───────────── */

export type RelatedKind = "references" | "cited-by" | "similar";

export interface RelatedPaper {
  csl: CslItem;
  citedByCount: number | null;
  isOpenAccess: boolean;
  oaUrl: string | null;
  isRetracted: boolean;
  inLibraryId: string | null;
}

export async function relatedPapers(ctx: WorkspaceCtx, id: string, kind: RelatedKind) {
  const [item] = await getItems(ctx, [id]);
  if (!item) throw new ApiError(404, "not-found", "That reference is not in your library.");
  if (!item.doi) return { kind, papers: [] as RelatedPaper[], note: "Related papers need a DOI. This reference does not have one." };
  try {
    const seed = await openAlexByDoi(item.doi);
    if (!seed) return { kind, papers: [], note: "OpenAlex has no entry for this DOI yet." };
    let works: OpenAlexWork[] = [];
    if (kind === "references") works = await openAlexByIds((seed.referenced_works ?? []).slice(0, 40));
    else if (kind === "similar") works = await openAlexByIds((seed.related_works ?? []).slice(0, 20));
    else works = await openAlexCitedBy(seed.id, 15);
    works = works.filter((w) => w.title).sort((a, b) => (b.cited_by_count ?? 0) - (a.cited_by_count ?? 0)).slice(0, 25);
    const lib = await ctx.db.select({ id: libraryItems.id, doi: libraryItems.doi }).from(libraryItems).where(eq(libraryItems.workspaceId, ctx.workspaceId));
    const papers: RelatedPaper[] = works.map((w) => {
      const csl = openAlexToCsl(w);
      return {
        csl,
        citedByCount: w.cited_by_count ?? null,
        isOpenAccess: Boolean(w.open_access?.is_oa),
        oaUrl: w.open_access?.oa_url ?? null,
        isRetracted: Boolean(w.is_retracted),
        inLibraryId: lib.find((l) => l.doi && l.doi === csl.DOI)?.id ?? null,
      };
    });
    return { kind, papers, note: papers.length ? null : kind === "cited-by" ? "No citing papers found yet." : "None listed in OpenAlex." };
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 429) {
      return { kind, papers: [], note: "OpenAlex's free daily limit was reached. Add a free OpenAlex API key (OPENALEX_API_KEY) to lift it." };
    }
    return { kind, papers: [], note: "OpenAlex could not be reached. Try again in a minute." };
  }
}
