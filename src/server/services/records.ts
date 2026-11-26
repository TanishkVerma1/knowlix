import "server-only";
import type { CslItem, ParsedReference, VerificationResult } from "@/shared/types";
import { cslVenue, cslYear, firstAuthorFamily } from "../scholarly/csl";

/** The student's own version of a reference, as CSL (used when they keep an unconfirmed item). */
export function parsedToCsl(p: ParsedReference, id: string): CslItem {
  if (p.csl) return { ...p.csl, id };
  const bookish = !p.volume && !p.pages && Boolean(p.publisher) && !p.venue;
  return {
    id,
    type: bookish ? "book" : "article-journal",
    title: p.title ?? p.raw.slice(0, 200),
    author: p.authors.map((a) => ({ family: a.family, given: a.given })),
    issued: p.year ? { "date-parts": [[p.year]] } : undefined,
    "container-title": bookish ? undefined : p.venue,
    publisher: p.publisher ?? (bookish ? p.venue : undefined),
    volume: p.volume,
    issue: p.issue,
    page: p.pages,
    DOI: p.doi,
    ISBN: p.isbn,
    URL: p.url,
  };
}

/** Columns derived from a CSL record (denormalised for listing and search). */
export function recordColumns(csl: CslItem) {
  return {
    title: (csl.title ?? "Untitled").slice(0, 500),
    year: cslYear(csl),
    firstAuthor: firstAuthorFamily(csl),
    venue: cslVenue(csl),
    doi: csl.DOI?.toLowerCase() ?? null,
    isbn: csl.ISBN ?? null,
  };
}

/** True when the student gave only an identifier (a DOI, ISBN or arXiv ID), so there is no wording of theirs to keep. */
export function identifierOnly(parsed: ParsedReference): boolean {
  return !parsed.title && !parsed.authors.length && Boolean(parsed.doi || parsed.isbn || parsed.arxivId || parsed.url);
}

/**
 * True when the saved or exported version is the student's own wording (an
 * unconfirmed reference they chose to keep), not a registry record.
 */
export function isStudentVersion(result: VerificationResult, parsed: ParsedReference, resolution: string | null): boolean {
  if (resolution === "replaced" && (result.suggestion?.record ?? result.record)) return false;
  if (result.status === "verified" && result.record) return false;
  if (identifierOnly(parsed) && result.record && !result.provenWrong) return false;
  return true;
}

const BOOK_SOURCES = new Set(["openlibrary", "googlebooks"]);

/** Which record should be saved for a verification result + student decision. */
export function recordForResult(result: VerificationResult, parsed: ParsedReference, resolution: string | null, id: string): CslItem {
  if (resolution === "replaced") {
    const r = result.suggestion?.record ?? result.record;
    if (r) return { ...r, id };
  }
  // Only an identifier was given: the registry's record is the reference, whatever the stamp (for example retracted).
  if (identifierOnly(parsed) && result.record && !result.provenWrong) return { ...result.record, id, DOI: result.record.DOI ?? parsed.doi };
  if (result.status === "verified" && result.record && BOOK_SOURCES.has(result.recordSource ?? "") && parsed.authors.length && !parsed.etAl) {
    // Book catalogues list editors, translators and series editors as authors and vary by edition.
    // The book is confirmed real, so keep the authors, year and publisher the student cited.
    return {
      ...result.record,
      id,
      author: parsed.authors.map((a) => ({ family: a.family, given: a.given })),
      issued: parsed.year ? { "date-parts": [[parsed.year]] } : result.record.issued,
      publisher: parsed.publisher ?? parsed.venue ?? result.record.publisher,
    };
  }
  if (result.status === "verified" && result.record) {
    // Keep the verified registry record, but never drop the DOI the student gave,
    // and for a later edition of a book keep the edition the student actually cited.
    const laterEdition = result.record.type === "book" && parsed.year && result.fields.some((f) => f.field === "year" && f.note?.includes("edition"));
    return {
      ...result.record,
      id,
      DOI: result.record.DOI ?? parsed.doi,
      ...(laterEdition ? { issued: { "date-parts": [[parsed.year!]] } } : {}),
    };
  }
  return parsedToCsl(parsed, id);
}
