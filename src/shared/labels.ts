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
 * The status a reference carries on screen and in every export. One of:
 * Verified, Needs fix, Mismatch, Retracted, Not found, Not checked, Web source
 * (or "Please check" for a real record with another kind of warning).
 * Nothing is Verified by default: the word comes from what the check found.
 */
export function trustLabel(status: RecordStatus, reasonCode?: string | null, flags?: { code: string }[] | null): { name: string; stamp: string; tone: Tone } {
  if (status === "verified") return { name: "Verified", stamp: "Verified", tone: "ok" };
  if (status === "pending") return { name: "Not checked", stamp: "Checking", tone: "pending" };
  if (status === "mismatch") return reasonCode === "doi-not-registered" ? { name: "Not found", stamp: "Not found", tone: "danger" } : { name: "Mismatch", stamp: "Mismatch", tone: "danger" };
  if (flags?.some((f) => f.code === "retracted")) return { name: "Retracted", stamp: "Retracted", tone: "danger" };
  if (reasonCode === "not-found") return { name: "Not found", stamp: "Not found", tone: "warn" };
  if (reasonCode === "service-unavailable" || reasonCode === "link-unreachable" || reasonCode === "too-little-info") return { name: "Not checked", stamp: "Not checked", tone: "warn" };
  if (reasonCode === "web-page") return { name: "Web source", stamp: "Web source", tone: "warn" };
  if (reasonCode === "partial-match" || reasonCode === "close-match") return { name: "Needs fix", stamp: "Needs fix", tone: "warn" };
  return { name: RECORD_STATUS.check.name, stamp: RECORD_STATUS.check.stamp, tone: "warn" };
}

/** The words printed after a reference in an exported list, or null when it is Verified. Warnings travel with the reference. */
export function exportMark(status: RecordStatus, reasonCode?: string | null, flags?: { code: string }[] | null): string | null {
  const name = trustLabel(status, reasonCode, flags).name;
  if (name === "Verified") return null;
  if (name === "Retracted") return "Retracted: this paper has been withdrawn";
  if (name === "Not found") return "Not found in any database: not verified";
  if (name === "Needs fix") return "Needs fix: a detail differs from the official record";
  if (name === "Web source") return "Web source: not checked in a scholarly database";
  if (name === "Not checked") return "Not checked";
  if (name === "Mismatch") return "Mismatch: not verified";
  return "Not verified: check before citing";
}

export interface LegendEntry {
  name: string;
  tone: Tone;
  meaning: string;
}

/** What each label on a reference means, in the words shown on screen. */
export const REFERENCE_LEGEND: LegendEntry[] = [
  { name: "Verified", tone: "ok", meaning: "Found in doi.org, Crossref or OpenAlex, and the title, authors and year match. Safe to cite." },
  { name: "Needs fix", tone: "warn", meaning: "The paper is real, but a detail such as the year is wrong. The official detail is shown: accept the fix or reject it." },
  { name: "Mismatch", tone: "danger", meaning: "The DOI is real but belongs to a different paper or to other authors. What it really points to is shown next to what you pasted." },
  { name: "Retracted", tone: "danger", meaning: "A real paper that the journal has withdrawn. It is never shown as a normal verified source." },
  { name: "Not found", tone: "warn", meaning: "No registry has this DOI and no database has this title and authors. It may be invented. Never shown as Verified." },
  { name: "Not checked", tone: "warn", meaning: "The databases did not answer, or there was too little detail to search with. Nothing has been confirmed: try again." },
  { name: "Web source", tone: "warn", meaning: "A working web page. It was not checked in a scholarly database, so judge its reliability yourself." },
];

/** A source the AI recommends but the student has not approved. */
export const AI_SUGGESTION: LegendEntry = { name: "AI suggestion", tone: "neutral", meaning: "A source the AI recommends. It is not in your reference list until you approve it." };

/** What each label on a sentence means. */
export const CLAIM_LEGEND: LegendEntry[] = (Object.keys(CLAIM_LABELS) as ClaimLabel[]).map((l) => ({ name: CLAIM_LABELS[l].name, tone: CLAIM_LABELS[l].tone, meaning: CLAIM_LABELS[l].description }));
