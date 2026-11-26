# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

University students writing assignments, theses or literature reviews who need sources they can trust. They work in short sessions on a laptop, often under deadline, and paste references from many places (ChatGPT answers, Google Scholar, a friend's list, lecture slides). Secondary audiences:

- **Supervisors and markers**, who receive a read-only honesty receipt.
- **Hackathon judges** (SP Jain AI Club Hackathon, 26 Nov 2026), who first see the app on a projector in a hall and then try the live link on their own laptops, with no instructions.

## Product Purpose

Knowlix is a reference manager plus an AI research assistant that never invents a reference. A student can:

- audit a reference list;
- run a research question through checked steps;
- keep a library with folders, tags and notes;
- export citations along with an honesty receipt and an AI-use statement.

Success: every reference shown is traceable to a real record, every sentence the AI writes carries an honest label, and the student stays in control at every checkpoint.

## Positioning

Zotero, Mendeley, ResearchRabbit and SciSpace leave two jobs to the student: checking that a reference is real when it is saved, and checking whether a claim is supported. Knowlix does both with two locks:

- **Lock 1, reference check (code, not AI):**
  - doi.org existence, covering all registries;
  - field-by-field match against Crossref and OpenAlex;
  - retraction and preprint flags.
- **Lock 2, claim check:**
  - code checks quotes, numbers, years and names;
  - a Judge role can give only one of four fixed answers.

The labels are Verified, Reported (not checked), AI reasoning and Not found. Export stays locked while anything proven wrong remains.

## Operating Context

- Core journey: Ask → approve plan (checkpoint 1) → search report and sources with badges (checkpoint 2) → library → labelled summary (checkpoint 3) → export APA 7 plus the AI-use statement and receipt. Citation Audit is a second entry point.
- The demo runs live on a projector, then judges use the link at their desks. Campus Wi-Fi may be flaky.
- At 1:15 PM on the day, new requirements arrive and must be implemented within 90 minutes, so the code needs seams (adapters, registries, policy settings, feature flags).

## Capabilities and Constraints

- **Stack:** Next.js 16 (App Router, TypeScript, Tailwind 4) with clearly separated frontend, server and shared layers.
- **Storage:** Postgres via Drizzle. Docker locally, Supabase in production, and embedded PGlite when no database is configured.
- **Access:** no sign-in. Each browser gets a private workspace through a signed cookie, and a workspace key moves it to another device.
- **AI providers:** Groq first, Gemini as fallback, Ollama optional, and a mock for tests. No keys exist yet. Without a key the app runs a clearly labelled no-AI extractive mode. Sample output must always be labelled as a sample.
- **Scholarly sources:** doi.org, Crossref, OpenAlex, Unpaywall, arXiv and Open Library, all free.
- **AI roles:** Planner, Finder, Writer, Critic and Judge. Each has a versioned prompt, a JSON schema and a low temperature. The Verifier is plain code.
- **Phase 2 submission:** a GitHub repo, PROMPTS.md (the prompt log) and a live link.

## Brand Commitments

- Name: Knowlix (team "Team Knowlix").
- The four trust labels and the three checkpoints are fixed product vocabulary and must be named the same everywhere.
- The Phase 1 deck (Knowlix Phase 1 Deck.html) defines the agents, locks, checkpoints and governance features the website must follow.

## Evidence on Hand

- A benchmark dataset is being built in bench/data (30 real references, 30 fake references, 20 claim cases).
- Accuracy numbers must come from running it. Never invent them.
- There are no testimonials, users or institutional endorsements. Never fabricate any.

## Product Principles

1. Show the evidence, not just the verdict. Every badge opens the exact field comparison or passage behind it.
2. An honest "Not found" beats a confident guess.
3. The student decides. The AI proposes, the code checks, and the student approves at each checkpoint.
4. Anything proven wrong blocks export. Anything uncertain can be overridden, but only with a reason that goes on the receipt.
5. Usable without instructions. A first-time visitor understands what to do within seconds.

## Accessibility & Inclusion

WCAG 2.2 AA. Status is never conveyed by colour alone (icon plus word on every badge). Full keyboard paths. Respects reduced motion. Readable on a projector: large type and strong contrast.
