/**
 * APA 7th edition sets the titles of articles, chapters and books in sentence
 * case: only the first word, the first word after a colon, and proper nouns
 * are capitalised. Registries often hold titles in Title Case or ALL CAPS, so
 * the APA formatter lowers them here.
 *
 * A program cannot know every proper noun. Acronyms and mixed-case words
 * (DNA, COVID-19, mRNA, ChatGPT) are always kept, and so are the common names
 * of places, peoples, languages, months and well-known eponyms listed below.
 * A title that is already in sentence case is left exactly as it is.
 */

const KEEP = new Set(
  `january february march april june july august september october november december
monday tuesday wednesday thursday friday saturday sunday
africa african asia asian europe european america american americas australia australian antarctica arctic pacific atlantic mediterranean
india indian china chinese japan japanese korea korean pakistan pakistani bangladesh bangladeshi nepal nepali singapore singaporean malaysia malaysian indonesia indonesian thailand thai vietnam vietnamese philippines filipino taiwan taiwanese
uae emirates emirati dubai sharjah qatar qatari kuwait kuwaiti oman omani bahrain iran iranian iraq iraqi israel israeli palestine palestinian turkey turkish egypt egyptian nigeria nigerian kenya kenyan ghana ghanaian ethiopia ethiopian morocco moroccan arab arabic arabia arabian saudi
britain british england english scotland scottish wales welsh ireland irish france french germany german italy italian spain spanish portugal portuguese netherlands dutch belgium belgian sweden swedish norway norwegian denmark danish finland finnish russia russian ukraine ukrainian poland polish greece greek switzerland swiss austria austrian
usa canada canadian mexico mexican brazil brazilian argentina chile chilean colombia colombian peru peruvian
london paris berlin tokyo beijing shanghai mumbai delhi bangalore bengaluru chennai kolkata hyderabad pune sydney melbourne toronto boston chicago california texas florida
hindi urdu bengali tamil telugu marathi mandarin cantonese latin sanskrit
islam islamic muslim muslims christian christians christianity hindu hindus hinduism buddhist buddhists buddhism jewish judaism sikh
alzheimer alzheimer's parkinson parkinson's bayes bayesian markov darwin darwinian newton newtonian einstein freud freudian piaget piagetian vygotsky vygotskian gaussian boolean turing nobel down's
google facebook twitter instagram youtube wikipedia microsoft linkedin whatsapp tiktok zoom moodle coursera`
    .split(/\s+/)
    .filter(Boolean),
);

/** Names of more than one word, kept as written. */
const PHRASES = [
  "united states",
  "united kingdom",
  "united nations",
  "united arab emirates",
  "new york",
  "new zealand",
  "new delhi",
  "hong kong",
  "sri lanka",
  "abu dhabi",
  "saudi arabia",
  "south africa",
  "south korea",
  "north korea",
  "north america",
  "south america",
  "latin america",
  "middle east",
  "world health organization",
  "european union",
  "world war",
].map((p) => p.split(" "));

const core = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const capitalise = (w: string) => w.replace(/\p{L}/u, (c) => c.toUpperCase());

/** DNA, COVID-19, mRNA, iPhone, ChatGPT, H1N1, IV: written with capitals on purpose. */
function writtenWithCapitals(w: string): boolean {
  const c = core(w);
  return /\p{N}/u.test(c) || /\p{L}\p{Lu}/u.test(c) || (c.length === 1 && /\p{Lu}/u.test(c) && c !== "A");
}

export function apaSentenceCase(title: string): string {
  const words = title.trim().split(/\s+/);
  if (words.length < 2) return title;
  const letters = title.replace(/[^\p{L}]/gu, "");
  const allCaps = letters.length > 3 && /\p{Lu}/u.test(letters) && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  const long = words.slice(1).filter((w) => core(w).replace(/[^\p{L}]/gu, "").length >= 4);
  const capped = long.filter((w) => /^\p{Lu}/u.test(core(w))).length;
  const titleCase = long.length >= 1 && capped / long.length >= 0.6;
  if (!allCaps && !titleCase) return title;

  const lower = words.map((w) => core(w).toLowerCase());
  const named = new Set<number>();
  for (const phrase of PHRASES) {
    for (let i = 0; i + phrase.length <= lower.length; i++) {
      if (phrase.every((p, k) => lower[i + k] === p)) phrase.forEach((_p, k) => named.add(i + k));
    }
  }

  let startOfSentence = true;
  const out = words.map((w, i) => {
    const first = startOfSentence;
    // The next word starts a subtitle after a colon, a question or exclamation mark, or a dash standing alone.
    startOfSentence = /[:?!]["'”’)\]]*$/.test(w) || /^[–—-]$/.test(w);
    if (/^[–—-]$/.test(w)) return w;
    const parts = w.split("-").map((part, k) => {
      if (!part) return part;
      const key = core(part).toLowerCase();
      if (named.has(i) || KEEP.has(key)) return allCaps ? capitalise(part.toLowerCase()) : part;
      if (!allCaps && writtenWithCapitals(part)) return part;
      const lowered = part.toLowerCase();
      return first && k === 0 ? capitalise(lowered) : lowered;
    });
    return parts.join("-");
  });
  return out.join(" ");
}
