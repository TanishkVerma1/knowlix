import "server-only";
import { desc, eq } from "drizzle-orm";
import type { WorkspaceCtx } from "../auth/workspace";
import { drafts, libraryItems } from "../db/schema";
import { tryLog } from "../audit/activity";
import { formatBibliography, formatEach, formatInText } from "../cite/citeproc";
import { longestSharedRun, quoteInPassage, SIMILARITY_RUN } from "../research/claims";
import { sentences } from "../research/text";
import { citeKeys, findMarkers } from "@/shared/citekeys";
import { CITATION_STYLES, type CitationStyleId } from "@/shared/policy";
import type { CslItem, FlagInfo, RecordStatus } from "@/shared/types";

/**
 * The Draft page: the student writes, Knowlix cites.
 *
 * No AI writes here. A citation is a marker ([@Key]) that can only resolve to
 * a reference already in the checked library ("no ID, no citation"), and the
 * student's own sentences are compared with the abstracts they cite so an
 * unquoted copy is flagged before it is handed in.
 */

export interface DraftDTO {
  id: string;
  title: string;
  body: string;
  style: CitationStyleId;
  updatedAt: string;
}

export interface DraftNote {
  kind: "unknown-key" | "needs-check" | "retracted" | "too-close" | "quote-ok" | "quote-unchecked" | "preprint";
  tone: "danger" | "warn" | "ok" | "info";
  message: string;
  /** The words in the draft this note is about. */
  excerpt?: string;
}

export interface RenderedDraft {
  /** One entry per paragraph, with markers replaced by formatted citations. */
  paragraphs: string[];
  references: string[];
  notes: DraftNote[];
  stats: { words: number; citations: number; sourcesCited: number; unknown: number };
  /** Plain text ready to paste into Word or Docs. */
  text: string;
}

const NUMERIC: CitationStyleId[] = ["ieee", "vancouver"];
const MAX_BODY = 60_000;

function toDTO(r: typeof drafts.$inferSelect): DraftDTO {
  const style = (r.style in CITATION_STYLES ? r.style : "apa") as CitationStyleId;
  return { id: r.id, title: r.title, body: r.body, style, updatedAt: r.updatedAt.toISOString() };
}

async function loadOrCreate(ctx: WorkspaceCtx) {
  const [row] = await ctx.db.select().from(drafts).where(eq(drafts.workspaceId, ctx.workspaceId)).orderBy(desc(drafts.updatedAt)).limit(1);
  if (row) return row;
  const [made] = await ctx.db.insert(drafts).values({ workspaceId: ctx.workspaceId }).returning();
  return made;
}

interface Ref {
  id: string;
  key: string;
  csl: CslItem;
  status: RecordStatus;
  flags: FlagInfo[];
  kept: boolean;
}

async function libraryRefs(ctx: WorkspaceCtx): Promise<Map<string, Ref>> {
  const rows = await ctx.db.select().from(libraryItems).where(eq(libraryItems.workspaceId, ctx.workspaceId));
  const keys = citeKeys(rows.map((r) => ({ id: r.id, firstAuthor: r.firstAuthor, year: r.year, title: r.title, createdAt: r.createdAt.toISOString() })));
  const map = new Map<string, Ref>();
  for (const r of rows) {
    const key = keys.get(r.id)!;
    map.set(key.toLowerCase(), { id: r.id, key, csl: { ...r.csl, id: r.id }, status: r.status as RecordStatus, flags: r.flags ?? [], kept: Boolean(r.override) });
  }
  return map;
}

/** Text with quoted spans removed, so a properly quoted passage is never counted as copying. */
function withoutQuotes(s: string): string {
  return s.replace(/“[^”]{0,600}”|"[^"]{0,600}"/g, " ");
}

function quotedSpans(s: string): string[] {
  return [...s.matchAll(/“([^”]{20,600})”|"([^"]{20,600})"/g)].map((m) => (m[1] ?? m[2]).trim());
}

export async function renderDraft(ctx: WorkspaceCtx, body: string, style: CitationStyleId): Promise<RenderedDraft> {
  const refs = await libraryRefs(ctx);
  const numeric = NUMERIC.includes(style);
  const notes: DraftNote[] = [];
  const order: Ref[] = []; // cited references, in order of first appearance
  const number = new Map<string, number>();
  const unknown = new Set<string>();
  let citations = 0;

  const cited = (key: string) => {
    const ref = refs.get(key.toLowerCase());
    if (!ref) {
      unknown.add(key);
      return null;
    }
    if (!number.has(ref.id)) {
      order.push(ref);
      number.set(ref.id, order.length);
    }
    return ref;
  };

  const rawParagraphs = body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // First pass fixes the numbering; in-text citations for author-date styles are formatted in one batch per marker.
  const paragraphs: string[] = [];
  for (const para of rawParagraphs) {
    let out = "";
    let at = 0;
    for (const m of findMarkers(para)) {
      out += para.slice(at, m.index);
      at = m.index + m.raw.length;
      citations++;
      const found = m.parts.map((p) => ({ part: p, ref: cited(p.key) }));
      const good = found.filter((f) => f.ref) as { part: (typeof m.parts)[number]; ref: Ref }[];
      const bad = found.filter((f) => !f.ref).map((f) => f.part.key);
      let text = "";
      if (good.length) {
        if (numeric) {
          const nums = good.map((g) => `${number.get(g.ref.id)}${g.part.locator ? `, ${g.part.locator}` : ""}`);
          text = style === "ieee" ? nums.map((n) => `[${n}]`).join(", ") : `(${nums.join(", ")})`;
        } else {
          text = (await formatInText(good.map((g) => g.ref.csl), style).catch(() => "")) || `(${good.map((g) => g.ref.key).join("; ")})`;
          const locators = good.map((g) => g.part.locator).filter(Boolean);
          // MLA writes the page bare, "(Hattie and Timperley 81)"; the other styles keep "p. 81" after a comma.
          if (locators.length === 1 && good.length === 1 && text.endsWith(")")) {
            const loc = locators[0]!;
            text = style === "mla" ? `${text.slice(0, -1)} ${loc.replace(/^pp?\.\s*/i, "")})` : `${text.slice(0, -1)}, ${loc})`;
          }
        }
      }
      if (bad.length) text += `${text ? " " : ""}[NOT IN YOUR LIBRARY: ${bad.map((k) => `@${k}`).join(", ")}]`;
      out += text;
    }
    out += para.slice(at);
    paragraphs.push(out);
  }

  for (const key of unknown) {
    notes.push({ kind: "unknown-key", tone: "danger", message: `@${key} is not in your library, so it cannot be cited. Add the source to your library first (it is checked on the way in), or fix the key.`, excerpt: `@${key}` });
  }
  for (const ref of order) {
    const retracted = ref.flags.some((f) => f.code === "retracted");
    if (retracted) notes.push({ kind: "retracted", tone: "danger", message: `@${ref.key} has been retracted by its journal. Cite it only if you are writing about the retraction.`, excerpt: `@${ref.key}` });
    else if (ref.status !== "verified") notes.push({ kind: "needs-check", tone: "warn", message: `@${ref.key} is marked “Please check” in your library${ref.kept ? " (you kept it with a reason)" : ""}. Confirm it before you hand this in.`, excerpt: `@${ref.key}` });
    else if (ref.flags.some((f) => f.code === "preprint")) notes.push({ kind: "preprint", tone: "info", message: `@${ref.key} is a preprint (not peer reviewed). Say so when you rely on it.`, excerpt: `@${ref.key}` });
  }

  // The student's own sentences against the abstracts they cite.
  const abstracts = order.filter((r) => typeof r.csl.abstract === "string" && r.csl.abstract.length > 80);
  for (const para of rawParagraphs) {
    const keysHere = new Set(findMarkers(para).flatMap((m) => m.parts.map((p) => p.key.toLowerCase())));
    const plain = para.replace(/\[\s*@[^\]\n]{1,300}\]/g, "");
    for (const s of sentences(plain)) {
      const bare = withoutQuotes(s);
      for (const ref of abstracts) {
        const run = longestSharedRun(bare, ref.csl.abstract as string);
        if (run >= SIMILARITY_RUN) {
          notes.push({
            kind: "too-close",
            tone: "warn",
            message: `${run} words in a row match the abstract of @${ref.key}. Put the copied words in quotation marks, or say it in your own words.`,
            excerpt: s.length > 160 ? `${s.slice(0, 160)}…` : s,
          });
          break;
        }
      }
      for (const q of quotedSpans(s)) {
        const src = abstracts.filter((r) => keysHere.has(r.key.toLowerCase())).find((r) => quoteInPassage(q, r.csl.abstract as string));
        if (src) notes.push({ kind: "quote-ok", tone: "ok", message: `Quote found word for word in the abstract of @${src.key}.`, excerpt: q.length > 120 ? `${q.slice(0, 120)}…` : q });
        else if (keysHere.size) notes.push({ kind: "quote-unchecked", tone: "info", message: "This quote is not in the abstract of the source you cite. It may be in the full text, which Knowlix cannot read: check the wording against the paper yourself.", excerpt: q.length > 120 ? `${q.slice(0, 120)}…` : q });
      }
    }
  }

  // Reference list: cited sources only. Numbered styles keep citation order; the others are sorted by the style.
  let references: string[] = [];
  if (order.length) {
    if (numeric) {
      const each = await formatEach(order.map((r) => r.csl), style);
      references = each.map((e, i) => {
        const clean = e.replace(/^\s*(\[\d+\]|\d+\.)\s*/, "");
        return style === "ieee" ? `[${i + 1}] ${clean}` : `${i + 1}. ${clean}`;
      });
    } else {
      const bib = await formatBibliography(order.map((r) => r.csl), style, "text");
      references = bib.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    }
  }

  const words = body.replace(/\[\s*@[^\]\n]{1,300}\]/g, " ").split(/\s+/).filter(Boolean).length;
  const text = `${paragraphs.join("\n\n")}${references.length ? `\n\nReferences\n\n${references.join("\n")}` : ""}`;
  return { paragraphs, references, notes, stats: { words, citations, sourcesCited: order.length, unknown: unknown.size }, text };
}

export async function getDraft(ctx: WorkspaceCtx) {
  const row = await loadOrCreate(ctx);
  const draft = toDTO(row);
  return { draft, rendered: await renderDraft(ctx, draft.body, draft.style) };
}

export async function saveDraft(ctx: WorkspaceCtx, input: { title: string; body: string; style: CitationStyleId }) {
  const row = await loadOrCreate(ctx);
  const [saved] = await ctx.db
    .update(drafts)
    .set({ title: input.title.slice(0, 200), body: input.body.slice(0, MAX_BODY), style: input.style, updatedAt: new Date() })
    .where(eq(drafts.id, row.id))
    .returning();
  const draft = toDTO(saved);
  return { draft, rendered: await renderDraft(ctx, draft.body, draft.style) };
}

/** Called when the student copies or downloads the draft: one line in the activity log. */
export async function logDraftExport(ctx: WorkspaceCtx) {
  const { draft, rendered } = await getDraft(ctx);
  await tryLog(ctx.db, ctx.workspaceId, {
    actor: "student",
    action: "draft.exported",
    subjectType: "draft",
    subjectId: draft.id,
    summary: `Exported a draft in ${draft.style.toUpperCase()}: ${rendered.stats.words} words, ${rendered.stats.sourcesCited} sources cited, all from the checked library. No AI wrote the text.`,
    details: { ...rendered.stats, warnings: rendered.notes.filter((n) => n.tone === "warn" || n.tone === "danger").length },
  });
  return { ok: true };
}
