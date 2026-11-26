/**
 * Label config — the single place where Knowlix's trust vocabulary lives.
 * Seam: day-of requirements that rename, add or re-describe a label change
 * this file only; every badge, stamp, receipt and export reads from here.
 */
import type { ClaimLabel, JudgeVerdict, RecordStatus } from "./types";

export type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "pending";

export interface RecordStatusInfo {
  name: string;
  /** Word printed inside the rubber stamp. */
  stamp: string;
  tone: Tone;
  description: string;
  /** What the student can do about it. */
  action: string;
}

export const RECORD_STATUS: Record<RecordStatus, RecordStatusInfo> = {
  verified: {
    name: "Verified",
    stamp: "Verified",
    tone: "ok",
    description: "Matches a real record in a scholarly database, field by field.",
    action: "Nothing to do. Open the card to see the matching record.",
  },
  check: {
    name: "Please check",
    stamp: "Please check",
    tone: "warn",
    description: "Could not be fully confirmed. It may be real (a book, report or typo) or invented.",
    action: "Fix the details, use the suggested record, or keep it with a reason.",
  },
  mismatch: {
    name: "Mismatch",
    stamp: "Mismatch",
    tone: "danger",
    description: "Proven wrong: the DOI does not exist, or it belongs to a different paper.",
    action: "Replace it with the real record or remove it. Export stays locked until you do.",
  },
  pending: {
    name: "Checking",
    stamp: "Checking",
    tone: "pending",
    description: "Being compared with doi.org, Crossref and OpenAlex.",
    action: "Wait a moment.",
  },
};

export interface ClaimLabelInfo {
  name: string;
  short: string;
  tone: Tone;
  description: string;
}

export const CLAIM_LABELS: Record<ClaimLabel, ClaimLabelInfo> = {
  verified: {
    name: "Verified",
    short: "Verified",
    tone: "ok",
    description: "The cited passage says this. Code checked the quote, numbers and names, and the Judge confirmed it.",
  },
  reported: {
    name: "Reported, not checked",
    short: "Reported",
    tone: "info",
    description: "Comes from a real source, but Knowlix could not confirm the passage fully supports it. Read the source before relying on it.",
  },
  reasoning: {
    name: "AI reasoning",
    short: "AI reasoning",
    tone: "neutral",
    description: "Knowlix's own connecting reasoning. No source says this; treat it as a suggestion, not evidence.",
  },
  not_found: {
    name: "Not found",
    short: "Not found",
    tone: "warn",
    description: "The sources found do not answer this part of the question. Knowlix will not guess.",
  },
};

export const JUDGE_VERDICTS: Record<JudgeVerdict, { name: string; tone: Tone }> = {
  supports: { name: "Supports", tone: "ok" },
  partly: { name: "Partly supports", tone: "info" },
  says_nothing: { name: "Says nothing about this", tone: "warn" },
  opposite: { name: "Says the opposite", tone: "danger" },
};

export const CHECKPOINTS = [
  { id: 1, name: "Approve the plan", short: "Plan" },
  { id: 2, name: "Choose the sources", short: "Sources" },
  { id: 3, name: "Review the summary", short: "Summary" },
] as const;

export const AGENTS = {
  planner: { name: "Planner", role: "Turns your question into a search plan", kind: "ai" },
  finder: { name: "Finder", role: "Searches scholarly databases and screens results", kind: "ai" },
  verifier: { name: "Verifier", role: "Checks every reference against doi.org, Crossref and OpenAlex", kind: "code" },
  writer: { name: "Writer", role: "Writes a summary that cites passage IDs only", kind: "ai" },
  judge: { name: "Judge", role: "Gives one of four fixed answers per claim", kind: "ai" },
  critic: { name: "Critic", role: "Raises flags about bias and gaps. Cannot edit", kind: "ai" },
  orchestrator: { name: "Orchestrator", role: "Runs the steps in order and enforces checkpoints", kind: "code" },
} as const;

/**
 * The word a reference carries on screen: its status, made exact by why it got
 * that status. "Could not be confirmed" is three different things to a student:
 * the databases have no such reference, the databases did not answer, or a
 * detail is off. Each gets its own word.
 */
export function trustLabel(status: RecordStatus, reasonCode?: string | null): { name: string; stamp: string } {
  if (status === "check" && reasonCode === "not-found") return { name: "Not found", stamp: "Not found" };
  if (status === "check" && (reasonCode === "service-unavailable" || reasonCode === "link-unreachable" || reasonCode === "too-little-info")) return { name: "Not yet verified", stamp: "Not yet verified" };
  if (status === "pending") return { name: "Not yet checked", stamp: "Checking" };
  return { name: RECORD_STATUS[status].name, stamp: RECORD_STATUS[status].stamp };
}

export interface LegendEntry {
  name: string;
  tone: Tone;
  meaning: string;
}

/** What each label on a reference means, in the words shown on screen. */
export const REFERENCE_LEGEND: LegendEntry[] = [
  { name: "Verified", tone: "ok", meaning: "Found in doi.org, Crossref or OpenAlex, and the title, authors and year match. Safe to cite." },
  { name: "Please check", tone: "warn", meaning: "A real record was found, but a detail differs or it carries a warning such as a retraction. Read the reason first." },
  { name: "Not found", tone: "warn", meaning: "No scholarly database has this reference. It may be invented. It is never shown as Verified." },
  { name: "Not yet verified", tone: "warn", meaning: "Not checked: the databases did not answer, or there was too little detail to search with. Nothing has been confirmed." },
  { name: "Mismatch", tone: "danger", meaning: "Proven wrong: the DOI does not exist or belongs to a different paper. It cannot be saved or exported." },
];

/** A source the AI recommends but the student has not approved. */
export const AI_SUGGESTION: LegendEntry = { name: "AI suggestion", tone: "neutral", meaning: "A source the AI recommends. It is not in your reference list until you approve it." };

/** What each label on a sentence means. */
export const CLAIM_LEGEND: LegendEntry[] = (Object.keys(CLAIM_LABELS) as ClaimLabel[]).map((l) => ({ name: CLAIM_LABELS[l].name, tone: CLAIM_LABELS[l].tone, meaning: CLAIM_LABELS[l].description }));
