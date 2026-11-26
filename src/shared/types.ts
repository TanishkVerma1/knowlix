/**
 * Domain types shared by the frontend (src/app, src/features) and the
 * backend (src/server). Nothing in here may import server-only code.
 */

/* ───────────────────────── Citation records (CSL-JSON) ───────────────────────── */

export type CslName = {
  family?: string;
  given?: string;
  literal?: string;
  "non-dropping-particle"?: string;
  "dropping-particle"?: string;
  suffix?: string;
};

export type CslDate = {
  "date-parts"?: Array<Array<number | string>>;
  raw?: string;
  literal?: string;
};

/** Knowlix stores every reference internally as CSL-JSON (the format citation styles consume). */
export interface CslItem {
  id: string;
  type: string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: CslDate;
  "container-title"?: string;
  "container-title-short"?: string;
  publisher?: string;
  "publisher-place"?: string;
  volume?: string;
  issue?: string;
  page?: string;
  edition?: string;
  DOI?: string;
  ISBN?: string;
  URL?: string;
  abstract?: string;
  language?: string;
  [key: string]: unknown;
}

/* ───────────────────────── Lock 1: reference check ───────────────────────── */

/** The three verdicts a reference can get, plus "pending" while it is being checked. */
export type RecordStatus = "pending" | "verified" | "check" | "mismatch";

export type InputFormat = "apa" | "mla" | "ieee" | "harvard" | "bibtex" | "ris" | "doi" | "isbn" | "arxiv" | "url" | "text";

export interface ParsedAuthor {
  family: string;
  given?: string;
}

/** What the student typed, broken into fields (best effort). */
export interface ParsedReference {
  raw: string;
  format: InputFormat;
  title?: string;
  authors: ParsedAuthor[];
  etAl?: boolean;
  year?: number;
  venue?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  doi?: string;
  isbn?: string;
  arxivId?: string;
  url?: string;
  /** CSL item when the input was structured (BibTeX / RIS). */
  csl?: CslItem;
}

export type FieldName = "title" | "authors" | "year" | "venue";

export interface FieldComparison {
  field: FieldName;
  entered: string | null;
  found: string | null;
  /** 0..1 similarity */
  similarity: number;
  weight: number;
  points: number;
  verdict: "match" | "close" | "differs" | "missing";
  note?: string;
}

export type FlagCode =
  | "retracted"
  | "correction"
  | "expression-of-concern"
  | "preprint"
  | "year-off-by-one"
  | "no-doi"
  | "doi-suggested"
  | "book"
  | "old-source"
  | "second-opinion-disagrees"
  | "service-degraded"
  | "web-page";

export interface FlagInfo {
  code: FlagCode;
  label: string;
  detail: string;
  severity: "info" | "warn" | "danger";
  href?: string;
}

export type CheckOutcome = "pass" | "fail" | "warn" | "skip" | "error";

/** One step on the verification timeline shown to the student ("show your working"). */
export interface CheckStep {
  id: string;
  label: string;
  outcome: CheckOutcome;
  detail: string;
  source?: string;
  ms?: number;
}

export type ReasonCode =
  | "match"
  | "close-match"
  | "partial-match"
  | "doi-not-registered"
  | "doi-other-paper"
  | "not-found"
  | "too-little-info"
  | "service-unavailable"
  | "web-page"
  | "link-unreachable";

export type RecordSource = "crossref" | "datacite" | "doi.org" | "openalex" | "openlibrary" | "googlebooks" | "arxiv";

export interface VerificationResult {
  status: Exclude<RecordStatus, "pending">;
  /** 0–100 match score, null when no candidate record was compared. */
  score: number | null;
  reasonCode: ReasonCode;
  /** One plain-language sentence a student understands. */
  reason: string;
  entered: ParsedReference;
  record: CslItem | null;
  recordSource: RecordSource | null;
  fields: FieldComparison[];
  flags: FlagInfo[];
  checks: CheckStep[];
  /** Is the item "proven wrong" (cannot be overridden, only fixed or removed)? */
  provenWrong: boolean;
  /** For proven-wrong DOIs: the real paper the student probably meant (found by title), or null if none exists. */
  suggestion?: { record: CslItem; source: RecordSource; score: number } | null;
  /** True when a search for the intended paper ran (so "no suggestion" means "nothing real matches"). */
  searchedForIntended?: boolean;
  checkedAt: string;
  durationMs: number;
}

/* ───────────────────────── Lock 2: claim check ───────────────────────── */

/** The four labels every sentence in a Knowlix summary carries. */
export type ClaimLabel = "verified" | "reported" | "reasoning" | "not_found";

/** The Judge can only ever answer one of these four. */
export type JudgeVerdict = "supports" | "partly" | "says_nothing" | "opposite";

export interface Passage {
  /** Stable short ID the AI must cite, e.g. "P7". */
  id: string;
  sourceId: string;
  text: string;
  /** Where in the source it came from. */
  location: "abstract" | "full-text" | "title";
  /** Set when the passage text looked like it was trying to instruct the AI. */
  suspicious?: boolean;
}

export interface CodeCheck {
  kind: "citation-ids" | "quote" | "numbers" | "years" | "names" | "similarity" | "judge-evidence";
  outcome: "pass" | "fail" | "skip";
  detail: string;
}

export interface JudgeResult {
  passageId: string;
  verdict: JudgeVerdict;
  evidence: string;
  reason: string;
  evidenceVerified: boolean;
}

export interface SummarySentence {
  id: string;
  text: string;
  kind: "sourced" | "reasoning";
  citations: string[];
  quote?: { passageId: string; text: string } | null;
  label: ClaimLabel;
  /** Plain-language explanation of why this label was given. */
  why: string;
  checks: CodeCheck[];
  judge: JudgeResult[];
  /** True if this sentence was rewritten by the repair loop. */
  repaired?: boolean;
  originalText?: string;
  override?: { reason: string; at: string } | null;
}

export interface RemovedSentence {
  id: string;
  text: string;
  why: string;
  citations: string[];
}

export interface CriticFlag {
  type:
    | "one_sided"
    | "source_mix"
    | "outdated"
    | "preprint_heavy"
    | "overgeneralisation"
    | "missing_counterevidence"
    | "scope_drift"
    | "low_evidence";
  severity: "info" | "warn";
  message: string;
  sentenceIds?: string[];
}

/* ───────────────────────── Research run (orchestrator) ───────────────────────── */

export type RunState =
  | "planning"
  | "plan_review" // checkpoint 1
  | "searching"
  | "sources_review" // checkpoint 2
  | "writing"
  | "summary_review" // checkpoint 3
  | "approved"
  | "failed";

export interface PlanQuery {
  id: string;
  text: string;
  purpose: string;
  fromYear?: number | null;
  toYear?: number | null;
  enabled: boolean;
}

export interface ResearchPlan {
  restatedQuestion: string;
  subQuestions: string[];
  keyConcepts: string[];
  include: string[];
  exclude: string[];
  queries: PlanQuery[];
  assumptions: string[];
  integrityNote?: string | null;
  sources: string[];
}

export interface SourceCandidate {
  id: string;
  csl: CslItem;
  foundBy: { adapter: string; queryId: string }[];
  relevance: "high" | "medium" | "low" | null;
  relevanceReason?: string | null;
  verification: VerificationResult | null;
  accepted: boolean | null;
  openAccessUrl?: string | null;
  citedByCount?: number | null;
  abstractAvailable: boolean;
  /** "upload": text extracted from the student's own PDF in their browser. */
  origin?: "search" | "upload";
  uploadName?: string | null;
  /** Set when the open-access full text could be read, so claims are checked against the paper itself, not only its abstract. */
  fullTextAvailable?: boolean;
  fullTextSource?: string | null;
}

export interface SearchReport {
  queries: { queryId: string; adapter: string; text: string; results: number; ms: number; error?: string }[];
  totalFound: number;
  afterDedupe: number;
  verified: number;
  dropped: { reason: string; count: number }[];
}

export interface SummaryDraft {
  sentences: SummarySentence[];
  removed: RemovedSentence[];
  gaps: string[];
  critic: CriticFlag[];
  passages: Passage[];
  mode: "ai" | "extractive";
  stats: { verified: number; reported: number; reasoning: number; notFound: number; repaired: number; removed: number };
  /** Sentences whose evidence the student opened before approving (the "evidence opened" meter). */
  viewed?: string[];
}

export interface AgentEvent {
  at: string;
  agent: "planner" | "finder" | "writer" | "critic" | "judge" | "verifier" | "orchestrator";
  message: string;
  tone?: "info" | "ok" | "warn" | "error";
  /** Short result lines shown under the message, e.g. one line per verdict. */
  detail?: string[];
  /** Who really did this step: a live AI model, plain code, or the no-AI stand-in. */
  by?: "ai" | "code" | "rules" | "you";
}

/**
 * One live AI call as the student watches it: who is working, on which model,
 * what it was sent, and its answer as it is typed.
 */
export interface LiveAgentCall {
  callId: string;
  agent: AgentId;
  name: string;
  promptVersion: string;
  task: string;
  sentChars: number;
  attempt: number;
  provider: string | null;
  model: string | null;
  /** The model's answer so far (raw JSON as it streams). */
  text: string;
  status: "working" | "done" | "failed";
  latencyMs: number | null;
  error?: string | null;
  startedAt: string;
}

export type AgentStreamEvent =
  | { type: "agent-start"; call: LiveAgentCall }
  | { type: "agent-token"; callId: string; text: string; provider?: string; model?: string; reset?: boolean }
  | { type: "agent-end"; callId: string; ok: boolean; latencyMs: number; provider: string; model: string; error?: string | null; text?: string };

/* ───────────────────────── AI transparency ───────────────────────── */

export type AgentId = "planner" | "finder" | "writer" | "critic" | "judge" | "repair";

export interface AiCallRecord {
  id: string;
  agent: AgentId;
  promptVersion: string;
  provider: string;
  model: string;
  temperature: number;
  sentChars: number;
  latencyMs: number;
  ok: boolean;
  error?: string | null;
  createdAt: string;
}
