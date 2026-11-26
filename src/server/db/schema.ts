import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Policy } from "@/shared/policy";
import type {
  AgentEvent,
  CslItem,
  FlagInfo,
  ParsedReference,
  ResearchPlan,
  SearchReport,
  SourceCandidate,
  SummaryDraft,
  VerificationResult,
} from "@/shared/types";

const created = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

/** A private workspace. One per browser (cookie), movable with a workspace key. */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  createdAt: created(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  keyHash: text("key_hash"),
  policy: jsonb("policy").$type<Policy>(),
});

export const folders = pgTable(
  "folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("sky"),
    createdAt: created(),
  },
  (t) => [index("folders_ws_idx").on(t.workspaceId)],
);

/** The library: every saved reference, always with its verification evidence. */
export const libraryItems = pgTable(
  "library_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    csl: jsonb("csl").$type<CslItem>().notNull(),
    raw: text("raw"),
    origin: text("origin").notNull(),
    doi: text("doi"),
    isbn: text("isbn"),
    title: text("title").notNull(),
    year: integer("year"),
    firstAuthor: text("first_author"),
    venue: text("venue"),
    status: text("status").notNull(),
    score: integer("score"),
    flags: jsonb("flags").$type<FlagInfo[]>().notNull().default(sql`'[]'::jsonb`),
    verification: jsonb("verification").$type<VerificationResult>(),
    override: jsonb("override").$type<{ reason: string; at: string } | null>(),
    notes: text("notes").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("library_ws_idx").on(t.workspaceId), index("library_ws_doi_idx").on(t.workspaceId, t.doi)],
);

/** A Citation Audit: a pasted list and its per-item results. */
export const audits = pgTable(
  "audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    input: text("input").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    createdAt: created(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [index("audits_ws_idx").on(t.workspaceId)],
);

export const auditItems = pgTable(
  "audit_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    auditId: uuid("audit_id").notNull().references(() => audits.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    raw: text("raw").notNull(),
    parsed: jsonb("parsed").$type<ParsedReference>().notNull(),
    status: text("status").notNull().default("pending"),
    result: jsonb("result").$type<VerificationResult>(),
    /** What the student did: replaced with the real record, removed, or kept with a reason. */
    resolution: text("resolution"),
    resolutionReason: text("resolution_reason"),
    libraryItemId: uuid("library_item_id"),
    updatedAt: updated(),
  },
  (t) => [index("audit_items_audit_idx").on(t.auditId)],
);

/** A research run: the orchestrator's persisted state machine. */
export const researchRuns = pgTable(
  "research_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    state: text("state").notNull(),
    mode: text("mode").notNull(),
    plan: jsonb("plan").$type<ResearchPlan>(),
    planApprovedAt: timestamp("plan_approved_at", { withTimezone: true, mode: "date" }),
    searchReport: jsonb("search_report").$type<SearchReport>(),
    sources: jsonb("sources").$type<SourceCandidate[]>(),
    sourcesApprovedAt: timestamp("sources_approved_at", { withTimezone: true, mode: "date" }),
    draft: jsonb("draft").$type<SummaryDraft>(),
    summaryApprovedAt: timestamp("summary_approved_at", { withTimezone: true, mode: "date" }),
    events: jsonb("events").$type<AgentEvent[]>().notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    isSample: boolean("is_sample").notNull().default(false),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("runs_ws_idx").on(t.workspaceId)],
);

/** Every AI call, with exactly what was sent ("Sent to the AI" panel). */
export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    runId: uuid("run_id"),
    agent: text("agent").notNull(),
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    temperature: integer("temperature_x100").notNull(),
    sent: jsonb("sent").$type<{ system: string; user: string }>().notNull(),
    received: text("received"),
    latencyMs: integer("latency_ms").notNull(),
    ok: boolean("ok").notNull(),
    error: text("error"),
    createdAt: created(),
  },
  (t) => [index("ai_calls_ws_idx").on(t.workspaceId), index("ai_calls_run_idx").on(t.runId)],
);

/**
 * Append-only, hash-chained activity log. A database trigger rejects every
 * UPDATE and DELETE (except the student's own "delete my data").
 */
export const activityLog = pgTable(
  "activity_log",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** ISO-8601 text so the hash chain can be re-verified byte for byte. */
    at: text("at").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("activity_ws_idx").on(t.workspaceId, t.seq)],
);

/** "Report a wrong check" submissions. */
export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  note: text("note").notNull(),
  createdAt: created(),
});

/** Read-only supervisor links to a receipt. */
export const shareLinks = pgTable("share_links", {
  token: text("token").primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  subjectId: uuid("subject_id").notNull(),
  createdAt: created(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
});

/** The student's own writing. Citations are markers ([@Key]) that resolve only to library items. */
export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    style: text("style").notNull().default("apa"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("drafts_ws_idx").on(t.workspaceId)],
);
