import "server-only";
import type { CslItem } from "@/shared/types";
import { env } from "../env";
import { getCached, isRateLimited, qs } from "./http";
import { cleanTitle, splitFullName, tidyCsl } from "./csl";

/*
 * Google Books API: https://developers.google.com/books/docs/v1/using
 * A second catalogue for books cited without a DOI (Open Library is the first).
 * Google's keyless quota is shared and is usually exhausted, so in practice
 * this needs GOOGLE_BOOKS_API_KEY; without one the first refusal rests the
 * host and book checks carry on with Open Library alone.
 */

export const GOOGLE_BOOKS_HOST = "www.googleapis.com";
const BASE = `https://${GOOGLE_BOOKS_HOST}/books/v1/volumes`;

export interface GoogleBooksVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    /** "2011", "2011-10" or "2011-10-25" */
    publishedDate?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    printType?: string;
    language?: string;
    infoLink?: string;
    canonicalVolumeLink?: string;
  };
}

const FIELDS = "totalItems,items(id,volumeInfo(title,subtitle,authors,publisher,publishedDate,industryIdentifiers,printType,language,infoLink,canonicalVolumeLink))";

function isbnOf(v: GoogleBooksVolume): string | undefined {
  const ids = v.volumeInfo?.industryIdentifiers ?? [];
  const pick = ids.find((i) => i.type === "ISBN_13") ?? ids.find((i) => i.type === "ISBN_10");
  return pick?.identifier?.replace(/[^0-9Xx]/g, "") || undefined;
}

export function googleBooksToCsl(v: GoogleBooksVolume): CslItem {
  return tidyCsl(googleBooksToCslRaw(v));
}

function googleBooksToCslRaw(v: GoogleBooksVolume): CslItem {
  const i = v.volumeInfo ?? {};
  const year = i.publishedDate?.match(/^(1[5-9]\d\d|20\d\d)/)?.[1];
  return {
    id: `gb:${v.id}`,
    type: "book",
    title: cleanTitle([i.title, i.subtitle].filter(Boolean).join(": ")),
    author: (i.authors ?? []).slice(0, 10).map(splitFullName),
    issued: year ? { "date-parts": [[Number(year)]] } : undefined,
    publisher: i.publisher || undefined,
    ISBN: isbnOf(v),
    URL: i.canonicalVolumeLink ?? i.infoLink ?? `https://books.google.com/books?id=${v.id}`,
    language: i.language || undefined,
  };
}

/** False while Google has refused us (quota), so callers can skip the request and say so. */
export function googleBooksAvailable(): boolean {
  return !isRateLimited(GOOGLE_BOOKS_HOST);
}

async function volumes(q: string, maxResults: number): Promise<GoogleBooksVolume[]> {
  const r = await getCached<{ totalItems?: number; items?: GoogleBooksVolume[] }>(
    `${BASE}?${qs({ q, maxResults, printType: "books", fields: FIELDS, key: env.googleBooksKey })}`,
    {
      timeoutMs: 9000,
      // A quota refusal does not go away in a second: do not retry, and rest the host
      // (an hour without a key: that quota is per day; ten minutes with one).
      retries: env.googleBooksKey ? 1 : 0,
      cooldownOn429Ms: env.googleBooksKey ? 10 * 60_000 : 60 * 60_000,
    },
  );
  return (r.data?.items ?? []).filter((v) => v.volumeInfo?.title);
}

/** Words of a title that are safe inside a Google Books query (its syntax gives : and " meaning). */
function words(s: string, max: number): string {
  return s
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function googleBooksQuery(title: string, author?: string): string {
  // Students often leave the subtitle off (or add one the catalogue lacks): search on the main title.
  const main = words(title.split(/[:?!]|\s[-–—]\s/)[0] || title, 150) || words(title, 150);
  const fam = author ? words(author, 60) : "";
  return [main ? `intitle:"${main}"` : "", fam ? `inauthor:${fam.split(" ").pop()}` : ""].filter(Boolean).join(" ");
}

export async function googleBooksSearch(title: string, author?: string, maxResults = 8): Promise<CslItem[]> {
  const q = googleBooksQuery(title, author);
  if (!q) return [];
  return (await volumes(q, maxResults)).map(googleBooksToCsl);
}

export async function googleBooksIsbn(isbn: string): Promise<CslItem | null> {
  const clean = isbn.replace(/[^0-9Xx]/g, "");
  if (!clean) return null;
  const hit = (await volumes(`isbn:${clean}`, 3))[0];
  if (!hit) return null;
  const csl = googleBooksToCsl(hit);
  return { ...csl, ISBN: csl.ISBN ?? clean };
}
