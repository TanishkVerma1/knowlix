/**
 * Plain-language explanation of a reference check.
 *
 * A stamp answers three separate questions, and a student needs to see all
 * three to understand it:
 *   1. Does this paper exist?
 *   2. Do the details you typed match the real record?   (this is the 0–100 score)
 *   3. Is it safe to cite as evidence?                   (retractions, preprints, warnings)
 *
 * A retracted paper is the classic trap: it exists and every detail matches
 * (100/100), yet it must not be used as evidence. Keeping the questions apart
 * is what makes that understandable.
 *
 * Pure and shared: the audit cards, receipts and exports all read from here.
 */
import type { FieldName, FlagInfo, VerificationResult } from "./types";

export type Answer = "yes" | "no" | "caution" | "unknown";

export interface ExplainedQuestion {
  id: "exists" | "details" | "safe";
  question: string;
  answer: Answer;
  /** Two or three words for the compact strip on the card, e.g. "Retracted". */
  short: string;
  /** Full sentence(s) for the opened card. */
  text: string;
  href?: string;
  hrefLabel?: string;
}

export interface Explanation {
  /** The verdict in one sentence a first-year student understands. */
  headline: string;
  questions: [ExplainedQuestion, ExplainedQuestion, ExplainedQuestion];
  /** Why these three answers add up to this stamp. */
  why: string;
  /** What the student should do now. */
  next: string;
  /** Set when a high score and a cautious stamp could look contradictory. */
  scoreNote: string | null;
}

const SOURCE: Record<string, string> = {
  crossref: "Crossref",
  datacite: "DataCite",
  "doi.org": "doi.org",
  openalex: "OpenAlex",
  openlibrary: "Open Library",
  googlebooks: "Google Books",
  arxiv: "arXiv",
};

const FIELD: Record<FieldName, string> = { title: "title", authors: "authors", year: "year", venue: "journal or publisher" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2010-2-6" → "6 February 2010"; "2010" → "2010". */
export function plainDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const month = mo ? MONTHS[Number(mo) - 1] : null;
  if (month && d) return `${Number(d)} ${month} ${y}`;
  if (month) return `${month} ${y}`;
  return y;
}

function list(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function flag(r: VerificationResult, code: FlagInfo["code"]): FlagInfo | undefined {
  return r.flags.find((f) => f.code === code);
}

export function explainVerification(r: VerificationResult): Explanation {
  const source = r.recordSource ? SOURCE[r.recordSource] ?? r.recordSource : "a scholarly database";
  const retracted = flag(r, "retracted");
  const concern = flag(r, "expression-of-concern");
  const preprint = flag(r, "preprint");
  const correction = flag(r, "correction");
  const disagree = flag(r, "second-opinion-disagrees");
  const degraded = flag(r, "service-degraded");
  const hasDoi = Boolean(r.entered.doi);
  const title = r.record?.title ? `“${r.record.title.slice(0, 110)}${r.record.title.length > 110 ? "…" : ""}”` : "another paper";
  const differing = r.fields.filter((f) => f.verdict === "differs").map((f) => FIELD[f.field]);
  const close = r.fields.filter((f) => f.verdict === "close").map((f) => FIELD[f.field]);
  const compared = r.fields.some((f) => f.verdict !== "missing");

  /* A link on its own is its own kind of source: answered separately, in the same three questions. */
  if (r.reasonCode === "web-page" || r.reasonCode === "link-unreachable") {
    const opened = r.reasonCode === "web-page";
    const page = r.record?.title ? `“${r.record.title.slice(0, 110)}”` : "the page";
    const site = (r.record?.["container-title"] as string | undefined) ?? null;
    return {
      headline: opened ? "A working web page, not a scholarly record." : "This link could not be opened.",
      questions: [
        opened
          ? { id: "exists", question: "Does this page exist?", answer: "yes", short: "Link works", text: `Yes. The link opens, and the page is titled ${page}${site ? `, published by ${site}` : ""}.`, href: r.record?.URL as string | undefined, hrefLabel: "Open the page" }
          : { id: "exists", question: "Does this page exist?", answer: "unknown", short: "Did not open", text: `${r.reason} A page that will not open cannot be confirmed.` },
        opened
          ? { id: "details", question: "Do your details match the real record?", answer: "yes", short: "Read from the page", text: "You gave only the link, so the title, publisher and date were read from the page itself." }
          : { id: "details", question: "Do your details match the real record?", answer: "unknown", short: "Nothing to compare", text: "Nothing could be read from the link." },
        { id: "safe", question: "Is it safe to cite?", answer: opened ? "caution" : "unknown", short: opened ? "Judge the source" : "Confirm it first", text: opened ? "With care. A web page is not peer reviewed, and it can be edited or removed. Ask who published it and why, and keep the date you read it (Knowlix records today’s date in the citation)." : "Not until the link works or you find the source another way." },
      ],
      why: opened
        ? "Please check here does not mean something is wrong. Verified is reserved for records in a scholarly registry, and a web page is not one, so the decision to rely on it is yours."
        : "Please check means Knowlix could not confirm this source: the address did not open.",
      next: opened ? "If the publisher is one you trust (a government body, a university, a recognised organisation), keep it with a reason. The reason is printed on your receipt." : "Fix the address, or remove it.",
      scoreNote: null,
    };
  }

  /* 1 ─ Does it exist? */
  let exists: ExplainedQuestion;
  if (r.reasonCode === "doi-not-registered") {
    exists = {
      id: "exists",
      question: "Does this paper exist?",
      answer: "no",
      short: "DOI does not exist",
      text: `No. Every real DOI is listed at doi.org, the worldwide DOI register, and it has no entry for ${r.entered.doi}. ${
        r.suggestion ? "A real paper with a similar title does exist; it is shown below." : r.searchedForIntended ? "Knowlix also searched by title and authors and found no real paper like it, which is typical of an invented reference." : ""
      }`.trim(),
    };
  } else if (r.reasonCode === "doi-other-paper") {
    exists = {
      id: "exists",
      question: "Does this paper exist?",
      answer: "no",
      short: "DOI is another paper",
      text: `Not as you cited it. The DOI is real, but it belongs to a different paper: ${title}. ${
        r.suggestion ? "A real paper matching your title does exist; it is shown below." : r.searchedForIntended ? "No real paper matches the title and authors you gave." : ""
      }`.trim(),
      href: r.record?.DOI ? `https://doi.org/${r.record.DOI}` : undefined,
      hrefLabel: "Open what this DOI really points to",
    };
  } else if (r.reasonCode === "service-unavailable") {
    exists = { id: "exists", question: "Does this paper exist?", answer: "unknown", short: "Not checked", text: "Not checked yet. The scholarly databases did not answer in time. This says nothing about your reference: run the check again in a minute." };
  } else if (r.reasonCode === "too-little-info") {
    exists = { id: "exists", question: "Does this paper exist?", answer: "unknown", short: "Too little to search", text: "Unknown. There is too little here to search with. Add the title, the authors and the year." };
  } else if (r.reasonCode === "not-found" || !r.record) {
    exists = {
      id: "exists",
      question: "Does this paper exist?",
      answer: "unknown",
      short: "No record found",
      text: "Not found. Crossref, OpenAlex and Open Library hold no record that matches. That does not prove it is invented: books, reports and web pages are often missing from these databases. It does mean you have to confirm it yourself.",
    };
  } else {
    exists = {
      id: "exists",
      question: "Does this paper exist?",
      answer: "yes",
      short: "Real record",
      text: hasDoi ? `Yes. Its DOI is registered at doi.org, and ${source} holds the official record.` : `Yes. A matching record was found in ${source}.`,
      href: r.record.DOI ? `https://doi.org/${r.record.DOI}` : (r.record.URL as string | undefined),
      hrefLabel: "Open the official record",
    };
  }

  /* 2 ─ Do the details match? (the score) */
  let details: ExplainedQuestion;
  const score = r.score;
  if (exists.answer !== "yes" && r.reasonCode !== "doi-other-paper") {
    details = { id: "details", question: "Do your details match the real record?", answer: "unknown", short: "Nothing to compare", text: "There is no real record to compare your details with." };
  } else if (!compared || score === null) {
    details = {
      id: "details",
      question: "Do your details match the real record?",
      answer: "yes",
      short: "Filled in for you",
      text: "You gave only an identifier, so there was nothing to compare. Knowlix filled in the title, authors, year and journal from the official record.",
    };
  } else if (r.reasonCode === "doi-other-paper") {
    details = {
      id: "details",
      question: "Do your details match the real record?",
      answer: "no",
      short: `${score}/100`,
      text: `No: ${score} out of 100. The ${list(differing.length ? differing : ["title", "authors"])} you typed ${differing.length === 1 ? "does" : "do"} not belong to the paper this DOI points to.`,
    };
  } else if (score >= 100) {
    details = {
      id: "details",
      question: "Do your details match the real record?",
      answer: "yes",
      short: "100/100",
      text: close.length
        ? `Yes: 100 out of 100. One small difference is allowed and does not cost points: the ${list(close)} ${close.length === 1 ? "is" : "are"} close but not identical (for example a year that is one off, because papers often appear online a year before print). Check it against the official record below.`
        : "Yes: 100 out of 100. The title, authors, year and journal you typed all match the official record.",
    };
  } else if (score >= 90) {
    details = {
      id: "details",
      question: "Do your details match the real record?",
      answer: "yes",
      short: `${score}/100`,
      text: `Yes: ${score} out of 100, which counts as a match (90 or more). ${close.length || differing.length ? `Small difference in the ${list([...differing, ...close])}; compare it with the official record below.` : "Only trivial differences."}`,
    };
  } else {
    details = {
      id: "details",
      question: "Do your details match the real record?",
      answer: "caution",
      short: `${score}/100`,
      text: `Only partly: ${score} out of 100 (90 or more counts as a match). ${differing.length ? `The ${list(differing)} you typed ${differing.length === 1 ? "differs" : "differ"} from the official record.` : ""} ${close.length ? `The ${list(close)} ${close.length === 1 ? "is" : "are"} close but not the same.` : ""}`.replace(/\s+/g, " ").trim(),
    };
  }

  /* 3 ─ Is it safe to cite as evidence? */
  let safe: ExplainedQuestion;
  if (exists.answer === "no") {
    safe = { id: "safe", question: "Is it safe to cite?", answer: "no", short: "Do not cite", text: "No. A reference that cannot be traced to a real paper must not be handed in." };
  } else if (retracted) {
    const when = plainDate(retracted.detail.match(/on (\d{4}(?:-\d{1,2}){0,2})/)?.[1]);
    safe = {
      id: "safe",
      question: "Is it safe to cite?",
      answer: "no",
      short: "Retracted",
      text: `No, not as evidence. The journal retracted this paper${when ? ` on ${when}` : ""}. A retraction means the publisher has formally withdrawn the paper because its findings can no longer be relied on (for example after errors or misconduct were found). The paper still exists and still has its DOI, which is why your details match, but its conclusions no longer count. Cite it only if you are writing about the retraction itself.`,
      href: retracted.href,
      hrefLabel: "Read the retraction notice",
    };
  } else if (exists.answer === "unknown") {
    safe = {
      id: "safe",
      question: "Is it safe to cite?",
      answer: "unknown",
      short: "Confirm it first",
      text: degraded ? "Not yet known. Check again once the databases answer." : "Not until you have confirmed it yourself: find the source (library catalogue, publisher page or the book in your hand) and check every detail.",
    };
  } else if (concern) {
    safe = { id: "safe", question: "Is it safe to cite?", answer: "caution", short: "Publisher warning", text: "With care. The publisher has issued an expression of concern: it is investigating whether this paper can be relied on. Read the notice before you use it.", href: concern.href, hrefLabel: "Read the notice" };
  } else if (disagree) {
    safe = { id: "safe", question: "Is it safe to cite?", answer: "caution", short: "Databases disagree", text: "Check first. Crossref and OpenAlex describe this DOI differently, so one of the records is wrong. Open the DOI link and confirm which paper it really is." };
  } else if (preprint) {
    safe = { id: "safe", question: "Is it safe to cite?", answer: "caution", short: "Preprint", text: `With care. This is a preprint: it has not been peer reviewed, so other researchers have not yet checked it. Say so when you cite it, and look for a published version.${correction ? " A correction was also published; use the corrected version." : ""}` };
  } else if (details.answer === "caution") {
    safe = { id: "safe", question: "Is it safe to cite?", answer: "caution", short: "Fix details first", text: "Once you have fixed the details. No retraction or warning notice was found, but a reference with wrong details sends your reader to the wrong place." };
  } else if (correction) {
    safe = { id: "safe", question: "Is it safe to cite?", answer: "yes", short: "No warnings", text: "Yes. It has not been retracted. A correction was published, so make sure you read and cite the corrected version.", href: correction.href, hrefLabel: "Read the correction" };
  } else {
    safe = { id: "safe", question: "Is it safe to cite?", answer: "yes", short: "No warnings", text: "Yes. No retraction, correction or warning notice was found for it." };
  }

  /* Headline, why, next */
  let headline: string;
  let why: string;
  let next: string;
  let scoreNote: string | null = null;

  if (r.status === "verified") {
    headline = hasDoi && compared ? "Real paper, and your details match it." : hasDoi ? "Real paper. Its details were filled in from the official record." : !compared ? `Real ${flag(r, "book") ? "book" : "record"}. Its details were filled in from ${source}.` : `Real ${flag(r, "book") ? "book" : "paper"}: it matches a record in ${source}.`;
    why = "Verified means all three answers are good: the paper exists, your details match the real record, and no warning notice was found.";
    next = flag(r, "doi-suggested") ? "Nothing you must do. Adding its DOI would make it easier for a reader to find." : preprint ? "You can cite it. Mention that it is a preprint." : "Nothing to do. It is ready to cite.";
  } else if (r.status === "mismatch") {
    headline = r.reasonCode === "doi-not-registered" ? (r.suggestion ? "This DOI does not exist. A real paper with this title was found." : "Not found: no registry has this DOI, and no database has this paper.") : `This DOI is real, but it belongs to a different paper or to other authors.`;
    why = "Mismatch means the reference is proven wrong, not just unconfirmed. A DOI is a paper's permanent ID: if it does not exist, or points to another paper, no reader can ever find what you cited. AI tools often produce exactly this kind of reference.";
    next = r.suggestion ? "Use the real paper Knowlix found, or remove this reference. It cannot be kept as it is, and export stays locked until you decide." : "Remove it, or replace it with a source you have actually read. It cannot be kept as it is, and export stays locked until you decide.";
  } else if (retracted) {
    headline = "Real paper and your details are right, but the journal has retracted it.";
    why = "Please check here has nothing to do with your typing. The paper exists and your details match; the stamp is amber because of what happened to the paper after it was published.";
    next = "Remove it, or keep it with a reason if your assignment discusses the retraction. Your reason is printed on your honesty receipt.";
    if (score !== null && score >= 90) scoreNote = `The ${score}/100 score only measures whether what you typed matches the real record. It does. It does not measure whether the paper can be trusted, which is the third question.`;
  } else if (r.reasonCode === "service-unavailable") {
    headline = "Not checked: the databases did not answer.";
    why = "Please check here means the check could not run, not that anything is wrong with your reference.";
    next = "Press Re-check in a minute.";
  } else if (r.reasonCode === "too-little-info") {
    headline = "There is too little here to check.";
    why = "Please check means Knowlix could not confirm this reference either way.";
    next = "Add the title, authors and year, then check again.";
  } else if (exists.answer === "unknown") {
    headline = "No matching record was found. It may be a book, report or web page, or it may be invented.";
    why = "Please check means Knowlix could neither confirm nor disprove this reference. It never guesses: an honest “not found” is safer than a wrong “verified”.";
    next = "Find the source yourself and confirm it. Then keep it with a reason (printed on your receipt), fix its details, or remove it.";
  } else if (disagree) {
    headline = "Real DOI, but two databases describe it differently.";
    why = "Please check means something needs a human look. Here the paper exists, but Crossref and OpenAlex do not agree about it, so Knowlix will not vouch for it.";
    next = "Open the DOI link, confirm the paper, then keep it with a reason or use the official record.";
    if (score !== null && score >= 90) scoreNote = `The ${score}/100 score compares what you typed with one record. The second database disagreeing is a separate warning.`;
  } else if (concern) {
    headline = "Real paper, but the publisher has raised concerns about it.";
    why = "Please check here is about the paper, not your typing: the publisher is investigating whether it can be relied on.";
    next = "Read the notice, then decide whether to keep it with a reason or remove it.";
    if (score !== null && score >= 90) scoreNote = `The ${score}/100 score only measures whether what you typed matches the real record.`;
  } else {
    headline = `A real record was found, but your ${list(differing.length ? differing : close.length ? close : ["details"])} ${differing.length + close.length === 1 ? "does" : "do"} not match it.`;
    why = `Please check means the paper looks real but what you typed is not the same as the official record (${score ?? 0} out of 100; 90 or more counts as a match). It may be a typing slip, or the details may have been made up around a real title.`;
    next = "Compare the two columns below. Use the official record to fix it in one click, or keep yours with a reason.";
  }

  return { headline, questions: [exists, details, safe], why, next, scoreNote };
}
