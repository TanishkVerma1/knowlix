/**
 * Guardrails around every AI call. Pure functions (unit tested).
 *
 * INPUT guards: what we send is cleaned, capped, de-identified, and wrapped
 * as data; passages that look like instructions are flagged and neutralised.
 * OUTPUT guards: only known IDs survive, no DOIs/URLs/reference lists leak
 * into prose, and quotes must exist verbatim in their source passage.
 */

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanText(s: string, max = 4000): string {
  return s.replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/* ───────── Prompt-injection detection (text from sources is DATA) ───────── */

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all|any)\b[^.]{0,30}\b(instruction|prompt|rule|direction)s?/i,
  /\byou are now\b/i,
  /\b(system|developer)\s*(prompt|message|instruction)s?\b/i,
  /\breveal\b[^.]{0,30}\b(prompt|instruction|key|secret)s?/i,
  /\b(act|behave|respond)\s+as\s+(an?|the)\s+\w+/i,
  /<\/?\s*(system|assistant|user|input_json|instructions?)\s*>/i,
  /\b(output|return|reply|respond)\b[^.]{0,30}\b(verified|supports)\b[^.]{0,30}\b(for|to) (all|every)\b/i,
  /\bcite this (paper|source|article) as\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

/** Neutralises markup that could be confused with our prompt structure. */
export function neutralise(text: string): string {
  return text.replace(/</g, "‹").replace(/>/g, "›");
}

/* ───────── De-identification of the student's own text ───────── */

export function redactPersonal(text: string): { text: string; redactions: number } {
  let n = 0;
  const sub = (re: RegExp, label: string) => (s: string) =>
    s.replace(re, () => {
      n++;
      return `[${label} removed]`;
    });
  let out = text;
  out = sub(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "email")(out);
  // A phone number has at least nine digits. "2015-2020" is a range of years, not a phone number.
  out = out.replace(/(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{3,4}\b/g, (m) => {
    if (m.replace(/\D/g, "").length < 9) return m;
    n++;
    return "[phone number removed]";
  });
  out = sub(/\b(?:student\s*(?:id|no\.?|number)\s*[:#]?\s*)\w{5,}\b/gi, "student ID")(out);
  out = sub(/\b\d{7,}\b/g, "number")(out);
  return { text: out, redactions: n };
}

/* ───────── Output guards ───────── */

// Lazy, so a sentence's own closing punctuation survives: "…see https://x.org/a." keeps its full stop.
const DOI_OR_URL = /\b(?:https?:\/\/\S+?|doi:\s*\S+?|10\.\d{4,9}\/\S+?)(?=[.,;:!?)\]]*(?:\s|$))/gi;
const INLINE_IDS = /\s*[[(]\s*(?:P|S)\d{1,3}(?:\s*[,;]\s*(?:P|S)?\d{1,3})*\s*[\])]/g;

/** Writer prose must not carry DOIs, links or "(P3)" markers; code adds citations. */
export function scrubProse(text: string): string {
  return text.replace(DOI_OR_URL, "").replace(INLINE_IDS, "").replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

export function keepKnownIds(ids: unknown, allowed: Set<string>): { kept: string[]; dropped: string[] } {
  const list = Array.isArray(ids) ? ids.map((x) => String(x).trim().toUpperCase()) : [];
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of list) {
    if (allowed.has(id)) {
      if (!kept.includes(id)) kept.push(id);
    } else dropped.push(id);
  }
  return { kept, dropped };
}

/** Pulls the first JSON object out of a model reply (tolerates ```json fences or chatter). */
export function extractJson(raw: string): unknown {
  const t = raw.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(t.slice(start, end + 1));
  }
  throw new Error("No JSON object in the reply");
}
