import type { Passage, SourceCandidate } from "@/shared/types";
import { cleanText, looksLikeInjection, neutralise } from "../agents/guardrails";
import { bm25Rank, sentences, tokens } from "./text";

export const MAX_PASSAGES = 48;
const MAX_WORDS_PER_PASSAGE = 55;

/** Default number of full-text passages one source may contribute. */
export const MAX_FULL_TEXT_PASSAGES = 12;
/** Full-text chunks outside these sizes are headings, list debris or flattened tables, not prose. */
const MIN_FULL_TEXT_CHARS = 60;
const MAX_FULL_TEXT_CHARS = 1200;
/** Only this many chunks of one paper are ranked (40,000 characters is ~150 chunks). */
const MAX_FULL_TEXT_CHUNKS = 400;

/**
 * Packs whole sentences into chunks of at most ~55 words. The one chunking
 * rule for every passage: abstracts, uploaded PDFs and open-access full text.
 */
export function chunkText(input: string, maxWords = MAX_WORDS_PER_PASSAGE): string[] {
  if (!input) return [];
  // Some registries store abstracts with the space after a full stop missing ("syndromes.Intermittent fasting").
  // Put it back, or the whole abstract would count as one sentence and one enormous passage.
  const text = input.replace(/([a-z)\]])\.([A-Z][a-z])/g, "$1. $2");
  const sents = sentences(text);
  const chunks: string[] = [];
  let cur = "";
  for (const sent of sents.length ? sents : [text]) {
    const words = (cur + " " + sent).trim().split(/\s+/).length;
    if (cur && words > maxWords) {
      chunks.push(cur);
      cur = sent;
    } else cur = (cur + " " + sent).trim();
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Splits each accepted source's abstract into short numbered passages
 * (P1, P2, …). Passages are the ONLY thing the Writer may cite, and the
 * ONLY source text that is ever sent to an AI model.
 */
export function buildPassages(sources: SourceCandidate[], maxTotal = MAX_PASSAGES): Passage[] {
  const perSource = Math.max(3, Math.floor(maxTotal / Math.max(1, sources.length)));
  const out: Passage[] = [];
  let n = 1;
  for (const s of sources) {
    const abstract = cleanText(s.csl.abstract ?? "", 6000);
    if (!abstract) continue;
    for (const text of chunkText(abstract).slice(0, perSource)) {
      const suspicious = looksLikeInjection(text);
      out.push({ id: `P${n++}`, sourceId: s.id, text: suspicious ? neutralise(text) : text, location: s.origin === "upload" ? "full-text" : "abstract", suspicious });
    }
  }
  return out.slice(0, maxTotal);
}

/** A full-text passage before it is numbered: give it its "P…" id where the other passages get theirs. */
export type FullTextPassage = Omit<Passage, "id"> & { location: "full-text"; suspicious: boolean };

/**
 * Turns a paper's open-access full text (see fetchFullText) into passages:
 * chunked exactly like abstracts and uploads (whole sentences, ~55 words,
 * never across a paragraph break), then the `max` chunks most relevant to
 * the research question are kept, in reading order.
 *
 * Only chunks that share a key term with the question are returned, so an
 * off-topic paper can yield fewer than `max` (or none). When the question
 * has no usable key terms, the first `max` chunks are returned instead.
 * Text that looks like an instruction to an AI is neutralised and flagged,
 * as in buildPassages.
 */
export function fullTextPassages(sourceId: string, text: string, question: string, max = MAX_FULL_TEXT_PASSAGES): FullTextPassage[] {
  if (!text || max <= 0) return [];
  const chunks: string[] = [];
  const seen = new Set<string>();
  for (const paragraph of text.split(/\n\s*\n/)) {
    const clean = cleanText(paragraph, 6000);
    if (clean.length < MIN_FULL_TEXT_CHARS) continue;
    for (const chunk of chunkText(clean)) {
      if (chunk.length < MIN_FULL_TEXT_CHARS || chunk.length > MAX_FULL_TEXT_CHARS || seen.has(chunk)) continue;
      seen.add(chunk);
      chunks.push(chunk);
      if (chunks.length >= MAX_FULL_TEXT_CHUNKS) break;
    }
    if (chunks.length >= MAX_FULL_TEXT_CHUNKS) break;
  }
  if (!chunks.length) return [];

  const ranked = bm25Rank(question, chunks.map((c, i) => ({ id: String(i), text: c })));
  const anyRelevant = ranked.some((r) => r.score > 0);
  const keep = anyRelevant
    ? ranked.filter((r) => r.score > 0).slice(0, max).map((r) => Number(r.id))
    : tokens(question).length
      ? [] // the question has key terms and this text shares none of them
      : chunks.slice(0, max).map((_c, i) => i);

  return keep
    .sort((a, b) => a - b)
    .map((i) => {
      const suspicious = looksLikeInjection(chunks[i]);
      return { sourceId, text: suspicious ? neutralise(chunks[i]) : chunks[i], location: "full-text" as const, suspicious };
    });
}
