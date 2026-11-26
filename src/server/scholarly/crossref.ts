import "server-only";
import type { CslItem, CslName } from "@/shared/types";
import { env } from "../env";
import { getCached, qs } from "./http";
import { cleanTitle, stripTags, tidyCsl } from "./csl";

/* Crossref REST API: https://api.crossref.org (no key; mailto joins the polite pool). */

interface CrossrefDate {
  "date-parts"?: (number | null)[][];
}
export interface CrossrefWork {
  DOI: string;
  type?: string;
  title?: string[];
  subtitle?: string[];
  author?: { given?: string; family?: string; name?: string; ORCID?: string }[];
  editor?: { given?: string; family?: string; name?: string }[];
  "container-title"?: string[];
  "short-container-title"?: string[];
  publisher?: string;
  issued?: CrossrefDate;
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
  created?: CrossrefDate;
  volume?: string;
  issue?: string;
  page?: string;
  ISBN?: string[];
  URL?: string;
  abstract?: string;
  language?: string;
  score?: number;
  "is-referenced-by-count"?: number;
  "update-to"?: { DOI: string; type: string; label?: string; updated?: CrossrefDate; source?: string }[];
  relation?: Record<string, { "id-type": string; id: string; "asserted-by": string }[]>;
  subtype?: string;
}

const TYPE_MAP: Record<string, string> = {
  "journal-article": "article-journal",
  "proceedings-article": "paper-conference",
  "book-chapter": "chapter",
  book: "book",
  "edited-book": "book",
  monograph: "book",
  "reference-book": "book",
  "posted-content": "article",
  dataset: "dataset",
  report: "report",
  dissertation: "thesis",
  "reference-entry": "entry",
  standard: "standard",
  "peer-review": "review",
};

function mailto() {
  return env.contactEmail ? { mailto: env.contactEmail } : {};
}

function pickDate(w: CrossrefWork): (number | string)[][] | undefined {
  for (const d of [w.issued, w["published-print"], w["published-online"], w.created]) {
    const p = d?.["date-parts"]?.[0];
    if (p && p[0]) return [p.filter((x): x is number => typeof x === "number")];
  }
  return undefined;
}

function names(list: CrossrefWork["author"]): CslName[] | undefined {
  if (!list?.length) return undefined;
  return list.map((a) => (a.family ? { family: a.family, given: a.given } : { literal: a.name ?? "" }));
}

export function crossrefToCsl(w: CrossrefWork): CslItem {
  return tidyCsl(crossrefToCslRaw(w));
}

function crossrefToCslRaw(w: CrossrefWork): CslItem {
  const title = [w.title?.[0], w.subtitle?.[0]].filter(Boolean).join(": ");
  return {
    id: w.DOI.toLowerCase(),
    type: TYPE_MAP[w.type ?? ""] ?? "article-journal",
    title: cleanTitle(title),
    author: names(w.author),
    editor: names(w.editor),
    issued: { "date-parts": pickDate(w) },
    "container-title": w["container-title"]?.[0] ? stripTags(w["container-title"][0]) : undefined,
    "container-title-short": w["short-container-title"]?.[0],
    publisher: w.publisher,
    volume: w.volume,
    issue: w.issue,
    page: w.page,
    DOI: w.DOI.toLowerCase(),
    ISBN: w.ISBN?.[0],
    URL: w.URL ?? `https://doi.org/${w.DOI}`,
    abstract: w.abstract ? stripTags(w.abstract) : undefined,
    language: w.language,
    genre: w.type === "posted-content" ? "preprint" : undefined,
  };
}

export async function crossrefWork(doi: string): Promise<CrossrefWork | null> {
  const path = doi.split("/").map(encodeURIComponent).join("/");
  const r = await getCached<{ message: CrossrefWork }>(`https://api.crossref.org/works/${path}?${qs(mailto())}`, {
    okStatuses: [404],
    timeoutMs: 9000,
  });
  return r.data?.message ?? null;
}

/** Crossref's own reference parser: hand it the raw citation string. */
export async function crossrefBibliographic(raw: string, rows = 5): Promise<CrossrefWork[]> {
  const q = raw.replace(/\s+/g, " ").slice(0, 600);
  const r = await getCached<{ message: { items: CrossrefWork[] } }>(
    `https://api.crossref.org/works?${qs({ "query.bibliographic": q, rows, ...mailto() })}`,
    { timeoutMs: 12000 },
  );
  return r.data?.message?.items ?? [];
}

export async function crossrefSearch(
  query: string,
  opts: { rows?: number; fromYear?: number | null; toYear?: number | null } = {},
): Promise<CrossrefWork[]> {
  const filters = [
    opts.fromYear ? `from-pub-date:${opts.fromYear}` : null,
    opts.toYear ? `until-pub-date:${opts.toYear}` : null,
    "type:journal-article,type:proceedings-article,type:book-chapter,type:posted-content,type:book",
  ].filter(Boolean);
  const r = await getCached<{ message: { items: CrossrefWork[] } }>(
    `https://api.crossref.org/works?${qs({
      query: query.slice(0, 300),
      rows: opts.rows ?? 10,
      filter: filters.join(","),
      select: "DOI,type,title,subtitle,author,container-title,short-container-title,publisher,issued,published-print,published-online,volume,issue,page,ISBN,URL,abstract,is-referenced-by-count",
      ...mailto(),
    })}`,
    { timeoutMs: 12000 },
  );
  return r.data?.message?.items ?? [];
}

export interface UpdateNotice {
  type: string;
  noticeDoi: string;
  label: string;
  date: string | null;
  source: string | null;
}

/** Retraction / correction / expression-of-concern notices that point at this DOI (includes Retraction Watch data). */
export async function crossrefUpdates(doi: string): Promise<UpdateNotice[]> {
  const r = await getCached<{ message: { items: CrossrefWork[] } }>(
    `https://api.crossref.org/works?${qs({ filter: `updates:${doi}`, rows: 10, select: "DOI,update-to", ...mailto() })}`,
    { timeoutMs: 9000 },
  );
  const out: UpdateNotice[] = [];
  for (const item of r.data?.message?.items ?? []) {
    for (const u of item["update-to"] ?? []) {
      if (u.DOI?.toLowerCase() !== doi.toLowerCase()) continue;
      const p = u.updated?.["date-parts"]?.[0];
      out.push({
        type: u.type,
        noticeDoi: item.DOI,
        label: u.label ?? u.type,
        date: p?.[0] ? p.filter(Boolean).join("-") : null,
        source: u.source ?? null,
      });
    }
  }
  return out;
}
