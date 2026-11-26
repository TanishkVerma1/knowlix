# Knowlix: references you can trust

**A reference manager and AI research assistant that never invents a reference.** Built by Team Knowlix for the SP Jain AI Club Hackathon 2026.

Students paste references from anywhere (ChatGPT answers, Google Scholar, a friend's list). Knowlix stamps each one **Verified**, **Please check** or **Mismatch** against real scholarly records, field by field, and says why in three plain answers: does it exist, do your details match, is it safe to cite. Students can also research a question with five AI roles that may only cite what they can trace, and watch each role work live. Every sentence carries one of four labels, and the student approves at three checkpoints. Then they write their own draft, and Knowlix inserts the citations from their checked library.

| | |
|---|---|
| **Lock 1: reference check** | Plain code, no AI. doi.org (all registries), Crossref, DataCite, OpenAlex, Open Library and Google Books. Title 40, authors 30, year 15 (±1), venue 15. Retraction and preprint flags. "Did you mean this real paper?" for wrong DOIs. |
| **Why this stamp?** | Every card answers three questions in plain words: *Does it exist? Do your details match? Is it safe to cite?* A retracted paper can match 100/100 and still be amber, and the card says exactly that. |
| **Lock 2: claim check** | Code checks quotes, numbers, years and names, and a similarity guard rejects copied wording without quotation marks. A Judge gives one of four fixed answers, and its evidence is re-checked by code. Failures get one rewrite, then are removed in plain sight. |
| **Live agent room** | Each AI call is streamed: who is working, on which model, what it was sent, and its answer as it is typed. Code steps and your own approvals sit in the same timeline. |
| **Find** | Up to four databases per search: OpenAlex, Semantic Scholar, Europe PMC, Crossref and (if the policy allows preprints) arXiv. A source-mix panel shows years, journals, open access and preprints before anything is written. |
| **Full text where it is free** | For papers in PubMed Central, Europe PMC or arXiv, sentences are checked against passages of the paper itself, not only its abstract. |
| **Draft** | The student writes; `[@Hattie2007]` becomes a formatted citation in any of six styles, with the reference list. A key that is not in the checked library is refused, and wording copied from a cited abstract without quotation marks is flagged. No AI writes on this page. |
| **Bring anything** | A DOI, an ISBN, an arXiv ID, a full reference in any style, BibTeX or RIS, **a link** (a publisher page is recognised by the DOI it declares and checked as a paper; any other page is saved as a clearly labelled web source with the date it was read), or **a PDF** (its DOI or title is read on the device and checked; an essay PDF has its reference list lifted out for auditing). |
| **Your own PDFs** | Read in the browser with pdf.js. The student sees exactly which passages will be sent; the file never leaves the device. Any DOI inside is verified like every other source. |
| **Four labels** | Verified · Reported (not checked) · AI reasoning · Not found |
| **Three checkpoints** | Approve the plan → choose the sources → review the summary. Enforced by the server. |
| **Governance** | Honesty receipt (with how many sentences' evidence the student opened), read-only supervisor link, AI-use statement, a hash-chained activity log that Postgres refuses to edit, course policy presets, "Sent to the AI" for every call, and delete-my-data. |

## Phase 2 requirements, and where to see each one

| Requirement | Where in the app |
|---|---|
| 1. The fake reference test | **Citation Audit** or **Library → Add a reference**. Every reference is checked live, by code, against doi.org, Crossref and OpenAlex. A made-up DOI is stamped **Mismatch** and refused; a made-up title or author is stamped **Not found**; if the databases do not answer it is **Not yet verified**. Nothing unconfirmed is ever shown as Verified. |
| 2. Trust labels on everything | Every reference carries a stamp and every AI sentence a label (Verified, Reported, AI reasoning, Not found). Sources the AI recommends carry **AI suggestion**. A "What the labels mean" guide sits on the audit, library, sources and summary screens. |
| 3. The user approves | Library: a reference is checked first and saved only after **Approve and add to my references**. Research: no source starts approved; each is approved with one click. Audit: **Save to library** is a button, never automatic. |
| 4. Export in APA 7 | Audit → Export, Library → Cite, and the research export all default to **APA 7th edition**, with Copy and Download. |
| 5. AI use statement | Generated with every export (audit, library and research) from what actually happened, with its own copy button. |
| Works on a phone | Checked at 390 px wide in a real browser: no sideways scrolling on the home, library, audit, sources or summary screens. |

## Measured accuracy (Lock 1)

Nothing in the reference check is trained. It is rules plus live look-ups, so there is no training data, only **test data**: reference lists where we know which entries are real and which are invented. Every number below is produced by a script and published to the app, never typed by hand.

| Test set | References | Invented ones stamped Verified | Real ones stamped Mismatch | Exactly the right stamp |
|---|---|---|---|---|
| **Fresh random sample** (drawn after the last rule change, never looked at first) | 300 (150 real, 50 real with a slip, 100 invented) | **0 / 100** | **0 / 200** | **98.7%** |
| Hand-written held-out set | 40 (20 real, 20 invented) | 0 / 20 | 0 / 20 | 100.0% |
| Hand-written development set (used to adjust the rules) | 60 (30 real, 30 invented) | 0 / 30 | 0 / 30 | 100.0% |

All 4 misses on the fresh sample are real references that got "Please check" instead of "Verified": the safe direction. An earlier random sample of 300 scored 94.7% and exposed parser bugs that were then fixed, which is why a second, unseen sample was drawn for the number above.

**Lock 2 (the sentence check), 20 claim/passage pairs:** code caught 3 of 3 planted errors (a misquote, a changed number, a changed year) with 0 false alarms on the other 17. The AI Judge, run on a small local model (qwen2.5:7b (ollama)), gave the expected answer for 15 of 20, and 12/14 unsupported claims were kept from "Verified". A small Judge is imperfect, which is why its evidence is re-checked by code and the student approves the summary. Larger cloud models have not been measured yet.

- **Where the data comes from.** The large sets are built by `bench/build-generated.ts` from real records drawn at random from the Crossref `sample` endpoint and the DataCite `random` listing, written in six citation styles, BibTeX or as bare DOIs. Invented references are made by altering them (a DOI that was never issued, a real DOI on an invented paper, a real title with wrong authors, two papers spliced together, an invented book).
- **See every case.** In the app: *How it works → See every test reference*. In the repo: [`bench/data/`](bench/data/README.md).
- **What we do not claim.** The AI steps (Writer, Judge) have no accuracy number here: their output is checked by code at run time instead.

## Run it

**Fastest (no setup).** This uses an embedded Postgres (PGlite) and no-AI mode:

```bash
npm install
npm run dev     # http://localhost:3000
```

**With AI (fast, recommended for a demo).** Copy `.env.example` to `.env.local`, add a free `GROQ_API_KEY` (console.groq.com/keys) and, as a back-up, `GEMINI_API_KEY` (aistudio.google.com/apikey), then restart. Answers arrive in seconds.

**With AI, no sign-up (slow).** Install [Ollama](https://ollama.com), run `ollama pull qwen2.5:7b`, and set `OLLAMA_BASE_URL=http://localhost:11434` in `.env.local`. Everything stays on the laptop, but one research run takes 8 to 15 minutes on a CPU. `OLLAMA_MODEL=llama3.2:3b` is about twice as fast and writes weaker summaries.

**Sign-ups, in order of importance.** *Settings → Connections* shows the live status of each.

| Service | Needed? | Why | Where |
|---|---|---|---|
| Groq | For a live demo | Fast AI agents | console.groq.com/keys → `GROQ_API_KEY` |
| A team contact email | Strongly advised | Puts you in Crossref's steadier "polite" pool; without it a busy network is told to slow down | `CONTACT_EMAIL` |
| OpenAlex | Advised | Free key, ten times the keyless daily budget | openalex.org/settings/api-key → `OPENALEX_API_KEY` |
| Google Gemini | Optional | Automatic back-up if Groq is busy | aistudio.google.com/apikey → `GEMINI_API_KEY` |
| Semantic Scholar | Optional | Keyless search is often busy | key request form → `SEMANTIC_SCHOLAR_API_KEY` |
| Google Books | Optional | Second book catalogue | Google Cloud console → `GOOGLE_BOOKS_API_KEY` |
| doi.org, Crossref, Europe PMC, PubMed Central, arXiv, Open Library | No sign-up | | |

**Docker (production build and real Postgres):**

```bash
docker compose up --build -d     # http://localhost:3000
docker compose --profile offline up -d ollama   # optional: offline AI (see docker-compose.yml)
```

**Deploy (live link).** Use Vercel for the app and Supabase for Postgres:
1. Push the repo to GitHub and import it in Vercel.
2. In Supabase: Project settings → Database → copy the *transaction pooler* URI.
3. Vercel → Environment variables: `DATABASE_URL`, `SESSION_SECRET` (a random 32+ character string), `GROQ_API_KEY`, `GEMINI_API_KEY`, and optionally `CONTACT_EMAIL` and `OPENALEX_API_KEY`.
4. Deploy. Migrations run automatically on first request. Check `/api/health`.

## Check everything works

```bash
npm run typecheck
npm test                       # 163 unit tests: parser, scoring, guardrails, claim checks, source clients, append-only log, full agent pipeline (mock AI)
npm run smoke -- http://localhost:3000   # end-to-end checks against a running app (any URL)
npm run bench -- holdout       # Lock 1 accuracy on the hand-written held-out set
npm run bench:generated        # Lock 1 accuracy on the large generated set (about 15 minutes)
```

> **Windows note:** run `npm test` from a normal terminal. Vitest breaks if the working directory's drive letter is lowercase (`c:\…`), which some embedded terminals report.

## A 2-minute demo

1. **Home → Try a sample list.** Ten real and invented references are checked live, and the stamps land one by one. Two are proven fakes: one DOI was never issued, and one belongs to another paper. Export locks.
2. **Open the retracted card → Why this stamp?** Exists: yes. Details match: 100/100. Safe to cite: no, retracted. Then open a red card: *"We also searched for a paper with this title… none exists."*
3. **Remove the fakes → Export unlocks.** Save to library.
4. **Research → ask a question.** The agent room opens: watch the Planner type its plan. Approve it (checkpoint 1), watch the Finder and Verifier, and choose the sources (checkpoint 2). Watch the Writer, Checker, Judge and Critic, then read the labelled summary (checkpoint 3) and click a sentence to see the Judge's verdict and the highlighted evidence.
5. **Draft → Insert a citation.** Type a sentence, press Ctrl+K, pick a source. Then type `[@Nobody2099]`: refused. Paste a sentence from an abstract: flagged.
6. **Activity log → Try to edit the log.** Postgres refuses.
7. **Receipt → Create supervisor link.**

## Architecture

```
Browser (Next.js pages, src/app + src/features)
   │  JSON / streamed NDJSON
   ▼
API route handlers (src/app/api) ── zod validation, rate limits, workspace cookie (src/proxy.ts)
   │
   ├─ services/            business logic (audits, library, research orchestrator, receipts)
   ├─ verify/              LOCK 1 (code): parser → doi.org → Crossref/DataCite → OpenAlex → score
   ├─ research/            LOCK 2 (code): passages, claim checks, labels, source adapters, free full text, no-AI fallbacks
   ├─ agents/              AI roles: constitution + personas, runtime (schema, retry, logging, live stream),
   │                        guardrails, providers (Groq → Gemini → Ollama, automatic failover)
   ├─ scholarly/           cached, rate-limited clients: doi.org, Crossref, OpenAlex, Europe PMC,
   │                        Semantic Scholar, arXiv, Open Library, Google Books
   └─ db/                  Drizzle + Postgres (Supabase / Docker) or embedded PGlite
```

- AI roles and their personas: [`docs/AGENT_PERSONAS.md`](docs/AGENT_PERSONAS.md) (generated from code).
- Project rules and day-of seams: [`AGENTS.md`](AGENTS.md).
- Product brief: [`PRODUCT.md`](PRODUCT.md).
- Prompt log for the submission: [`PROMPTS.md`](PROMPTS.md).

## Limitations (stated honestly in the app too)

- Sentences are checked against the full text only when it is free to read (PubMed Central, Europe PMC, arXiv) or the student adds their own PDF. For paywalled papers only the abstract can be read.
- Books, reports and web pages without a DOI often get "Please check": a prompt to confirm the source, not an accusation.
- The Judge is an AI and can err, so the evidence it quotes is re-checked by code and students can report a wrong check.
- Coverage depends on the databases; very new, local or non-English work may be missing from all of them.
- The free database tiers have daily limits. When one runs out Knowlix says "not checked"; it never guesses.
- A small model on a laptop writes weaker summaries than a large cloud model, so more of its sentences are removed by the checks.
- The live AI path has been run end to end on a local model (Ollama). Groq and Gemini use the same code path but had not been run with real keys when this was written.

## Credits

Citation styles come from the [Citation Style Language](https://citationstyles.org/) project (CC BY-SA 3.0), formatted with [citation.js](https://citation.js.org/). Metadata comes from doi.org, Crossref, DataCite, OpenAlex (CC0), Europe PMC, PubMed Central, Semantic Scholar, arXiv, Open Library and Google Books. Fonts: Atkinson Hyperlegible (Braille Institute) and Courier Prime.
