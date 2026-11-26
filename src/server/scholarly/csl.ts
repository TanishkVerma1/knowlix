import type { CslItem, CslName } from "@/shared/types";

/** Small helpers for reading CSL records consistently. */

export function cslYear(item: CslItem | null | undefined): number | null {
  const parts = item?.issued?.["date-parts"]?.[0];
  const y = parts?.[0];
  const n = typeof y === "string" ? parseInt(y, 10) : y;
  if (typeof n === "number" && Number.isFinite(n) && n > 1000) return n;
  const raw = item?.issued?.raw ?? item?.issued?.literal;
  const m = raw?.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : null;
}

export function cslVenue(item: CslItem | null | undefined): string | null {
  if (!item) return null;
  const isBookish = ["book", "report", "thesis", "monograph"].includes(item.type);
  return (isBookish ? item.publisher : item["container-title"]) ?? item["container-title"] ?? item.publisher ?? null;
}

export function nameToString(n: CslName): string {
  if (n.literal) return n.literal;
  return [n.given, n["non-dropping-particle"], n.family].filter(Boolean).join(" ");
}

export function authorsShort(item: CslItem | null | undefined, max = 3): string {
  const a = item?.author ?? [];
  if (!a.length) return "";
  const fam = a.map((n) => n.family ?? n.literal ?? "").filter(Boolean);
  if (fam.length <= max) return fam.join(", ");
  return `${fam.slice(0, max).join(", ")} et al.`;
}

export function firstAuthorFamily(item: CslItem | null | undefined): string | null {
  const a = item?.author?.[0];
  return a ? (a.family ?? a.literal ?? null) : null;
}

export function stripTags(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<jats:title>[^<]*<\/jats:title>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTitle(s: string | null | undefined): string {
  return stripTags(s).replace(/\s*\.\s*$/, "");
}

/* ───────── Record hygiene: registries sometimes send "latimier, alice" or ALL-CAPS titles ───────── */

const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "da", "di", "du", "le", "la", "dos", "das", "bin", "al", "el", "ter", "ten"]);
const ACRONYMS = ["AI", "COVID-19", "COVID", "SARS-CoV-2", "HIV", "AIDS", "DNA", "RNA", "USA", "UK", "EU", "OECD", "WHO", "UN", "NLP", "ML", "ICT", "STEM", "ADHD", "MRI", "GDP", "PTSD", "IQ", "LLM", "LLMs", "GPT", "CEO", "SME", "SMEs", "ESG", "IoT"];

/** "Elise V. van Wijk" → { family: "van Wijk", given: "Elise V." }; "Wijk, Elise" → { family: "Wijk", given: "Elise" }. */
export function splitFullName(full: string): CslName {
  if (full.includes(",")) {
    const [family, given] = full.split(",").map((s) => s.trim());
    return { family, given: given || undefined };
  }
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  let start = parts.length - 1;
  // Lower-case particles belong to the family name ("de Jonge", "van der Berg"), but a name is never all family.
  while (start > 1 && PARTICLES.has(parts[start - 1])) start--;
  return { family: parts.slice(start).join(" "), given: parts.slice(0, start).join(" ") };
}

function squash(s: string | undefined): string | undefined {
  if (!s) return s;
  const t = s.replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  return t || undefined;
}

function capitaliseName(s: string | undefined): string | undefined {
  if (!s) return s;
  if (s !== s.toLowerCase()) return s; // already has capitals: trust it (McDonald, van Dijk)
  return s
    .split(/(\s+|-)/)
    .map((part, i) => (PARTICLES.has(part) && i > 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

export function tidyName(n: CslName): CslName {
  let family = squash(n.family);
  let given = squash(n.given);
  const literal = squash(n.literal);
  // "Last, First" arriving in one field.
  if (!family && literal && literal.includes(",") && literal.split(",").length === 2) {
    const [f, g] = literal.split(",").map((x) => x.trim());
    return { family: capitaliseName(f), given: capitaliseName(g) };
  }
  if (family?.endsWith(",")) family = family.slice(0, -1);
  if (given?.endsWith(",")) {
    // Split was the wrong way round: given "latimier," family "alice".
    const realFamily = given.slice(0, -1);
    given = family;
    family = realFamily;
  }
  return { ...n, family: capitaliseName(family), given: capitaliseName(given), literal: literal && !family ? literal : undefined };
}

export function tidyTitle(title: string | undefined): string | undefined {
  const t = squash(title);
  if (!t) return t;
  const letters = t.replace(/[^A-Za-z]/g, "");
  const upper = t.replace(/[^A-Z]/g, "");
  if (letters.length < 12 || upper.length / letters.length < 0.8) return t;
  let s = t.toLowerCase().replace(/(^|[:?!.]\s+)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
  for (const a of ACRONYMS) {
    const escaped = a.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
    s = s.replace(new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, "gi"), (_m, pre: string) => `${pre}${a}`);
  }
  return s;
}

/** Cleans names and titles on every record as it enters Knowlix. */
export function tidyCsl<T extends CslItem>(item: T): T {
  return {
    ...item,
    title: tidyTitle(item.title),
    author: item.author?.map(tidyName),
    editor: item.editor?.map(tidyName),
    "container-title": squash(item["container-title"] as string | undefined),
  };
}
