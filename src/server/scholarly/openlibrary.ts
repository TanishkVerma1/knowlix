import "server-only";
import type { CslItem } from "@/shared/types";
import { getCached, qs } from "./http";

/* Open Library — free book metadata, used for books cited without a DOI. */

interface OlBookData {
  title?: string;
  subtitle?: string;
  authors?: { name: string }[];
  publish_date?: string;
  publishers?: { name: string }[];
  url?: string;
  identifiers?: { isbn_13?: string[]; isbn_10?: string[] };
}

interface OlSearchDoc {
  key: string;
  title?: string;
  subtitle?: string;
  author_name?: string[];
  first_publish_year?: number;
  publish_year?: number[];
  publisher?: string[];
  isbn?: string[];
}

function splitName(full: string) {
  if (full.includes(",")) {
    const [family, given] = full.split(",").map((s) => s.trim());
    return { family, given };
  }
  const parts = full.trim().split(/\s+/);
  return parts.length === 1 ? { family: parts[0] } : { family: parts[parts.length - 1], given: parts.slice(0, -1).join(" ") };
}

function yearOf(s?: string): number | undefined {
  const m = s?.match(/\b(1[5-9]\d\d|20\d\d)\b/);
  return m ? Number(m[1]) : undefined;
}

export async function openLibraryIsbn(isbn: string): Promise<CslItem | null> {
  const r = await getCached<Record<string, OlBookData>>(
    `https://openlibrary.org/api/books?${qs({ bibkeys: `ISBN:${isbn}`, format: "json", jscmd: "data" })}`,
    { timeoutMs: 9000 },
  );
  const b = r.data?.[`ISBN:${isbn}`];
  if (!b?.title) return null;
  const year = yearOf(b.publish_date);
  return {
    id: `isbn:${isbn}`,
    type: "book",
    title: [b.title, b.subtitle].filter(Boolean).join(": "),
    author: (b.authors ?? []).map((a) => splitName(a.name)),
    issued: year ? { "date-parts": [[year]] } : undefined,
    publisher: b.publishers?.[0]?.name,
    ISBN: isbn,
    URL: b.url,
  };
}

export async function openLibrarySearch(title: string, author?: string, hints: { year?: number; publisher?: string } = {}): Promise<CslItem[]> {
  const r = await getCached<{ docs: OlSearchDoc[] }>(
    `https://openlibrary.org/search.json?${qs({
      title: title.slice(0, 200),
      author: author?.slice(0, 80),
      limit: 5,
      fields: "key,title,subtitle,author_name,first_publish_year,publish_year,publisher,isbn",
    })}`,
    { timeoutMs: 10000 },
  );
  const wantPub = hints.publisher?.toLowerCase().replace(/[^a-z]/g, "");
  return (r.data?.docs ?? []).map((d) => {
    // A book has many editions: if the cited year/publisher matches one of them, describe that edition.
    const editionYear = hints.year && d.publish_year?.includes(hints.year) ? hints.year : d.first_publish_year;
    const publisher =
      (wantPub && d.publisher?.find((p) => {
        const q = p.toLowerCase().replace(/[^a-z]/g, "");
        return q.includes(wantPub) || wantPub.includes(q);
      })) ||
      d.publisher?.[0];
    return {
      id: `ol:${d.key}`,
      type: "book",
      title: [d.title, d.subtitle].filter(Boolean).join(": "),
      author: (d.author_name ?? []).slice(0, 10).map(splitName),
      issued: editionYear ? { "date-parts": [[editionYear]] } : undefined,
      publisher,
      ISBN: d.isbn?.find((i) => i.length === 13) ?? d.isbn?.[0],
      URL: `https://openlibrary.org${d.key}`,
    } satisfies CslItem;
  });
}
