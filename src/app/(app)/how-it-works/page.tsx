import Link from "next/link";
import { ShieldCheck, Gavel, Lock, Eye, UserCheck, ScrollText, Fingerprint, EyeOff, Scale, TriangleExclamationPoint } from "lucide-react";
import { PageHeader } from "@/components/shell/app-shell";
import { Stamp, ClaimChip } from "@/components/ui/status";
import { CLAIM_LABELS, JUDGE_VERDICTS } from "@/shared/labels";
import type { ClaimLabel, JudgeVerdict } from "@/shared/types";
import { planner } from "@/server/agents/prompts/planner";
import { finder } from "@/server/agents/prompts/finder";
import { writer, repair } from "@/server/agents/prompts/writer";
import { judge } from "@/server/agents/prompts/judge";
import { critic } from "@/server/agents/prompts/critic";
import { CONSTITUTION } from "@/server/agents/prompts/constitution";
import bench from "@/shared/benchmark.json";
import cases from "@/shared/benchmark-cases.json";

export const metadata = { title: "How it works" };

const JOURNEY = [
  { who: "You", what: "Ask a question or paste references", detail: "Personal details are stripped before anything reaches an AI." },
  { who: "Planner · AI", what: "Drafts a neutral search plan", detail: "Includes at least one search for counter-evidence.", cp: 1 },
  { who: "Finder · AI + code", what: "Searches up to four scholarly databases, then screens", detail: "OpenAlex, Semantic Scholar, Europe PMC, Crossref and arXiv. It only rates candidates it was given; it cannot add papers." },
  { who: "Verifier · code", what: "Checks every source is a real record", detail: "doi.org, Crossref, OpenAlex, retraction notices. Then looks for free full text.", cp: 2 },
  { who: "Writer · AI", what: "Writes, citing passage IDs only", detail: "No ID, no citation. Passages come from abstracts, free full text and your own PDFs." },
  { who: "Code + Judge + Critic", what: "Checks every sentence", detail: "Failures get one rewrite, then are removed in plain sight.", cp: 3 },
  { who: "You", what: "Export, or write your own draft", detail: "Export is locked while anything proven wrong remains. On the Draft page you write and Knowlix cites, only from your checked library." },
];

const AGENT_DEFS = [planner, finder, writer, repair, judge, critic];

const CAN_CANNOT: Record<string, [string, string]> = {
  planner: ["Restate the question neutrally, propose searches", "Answer the question or state findings"],
  finder: ["Rate the relevance of given candidates", "Add, merge or rename papers"],
  writer: ["Paraphrase passages, cite passage IDs", "Write DOIs, URLs, authors or reference lists"],
  repair: ["Rewrite a failed sentence once, or give up", "Cite passages outside the given list"],
  judge: ["Answer supports / partly / says nothing / opposite", "Write, rewrite or suggest anything"],
  critic: ["Raise up to 5 flags from a fixed list", "Edit the summary"],
};

type BenchSummary = { items: number; real: number; fake: number; fakesCaught: number; realWronglyRed: number; exactCorrect: number; ranAt: string };

export default function HowItWorksPage() {
  const holdout = (bench as unknown as Record<string, BenchSummary>).holdout;
  const tuning = (bench as unknown as Record<string, BenchSummary>).tuning;
  const claims = (bench as unknown as { claims?: { items: number; plantedErrors: number; plantedCaught: number; cleanItems: number; falseAlarms: number; judge: null | { model: string; exact: number; of: number; unsupportedNotVerified: string; supportedVerified: string } } }).claims;
  const caseFile = cases as unknown as { totals: null | { cases: number; fakes: number; fakesNotVerified: number; real: number; imperfect: number; realWronglyMismatch: number; imperfectWronglyMismatch: number; exactPct: number; medianMs?: number }; categories: unknown[] };
  const big = caseFile.totals;
  return (
    <div className="max-w-[64rem]">
      <PageHeader
        title="How Knowlix keeps research honest"
        description="Two locks, five AI roles with narrow jobs, three checkpoints where you decide, and a log nobody can edit. This page explains each one. To watch the roles work, start a research question: the agent room shows every step live."
      />

      <section aria-labelledby="journey-h">
        <h2 id="journey-h" className="text-[1.3rem] font-extrabold text-ink">The journey</h2>
        <ol className="relative mt-4 space-y-3 border-l-2 border-rule pl-6">
          {JOURNEY.map((j, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[2.15rem] top-3 grid size-6 place-items-center rounded-full bg-card text-[0.75rem] font-extrabold text-ink ring-2 ring-rule tabular">{i + 1}</span>
              <div className="rounded-xl border border-rule bg-card px-4 py-3 shadow-card">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-bold text-ink">{j.what}</span>
                  <span className="text-[0.85rem] text-ink-3">{j.who}</span>
                  {j.cp ? <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[0.75rem] font-bold text-accent">Checkpoint {j.cp}: you approve</span> : null}
                </p>
                <p className="text-[0.9rem] text-ink-2">{j.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-2" aria-label="The two locks">
        <div className="rounded-2xl border border-rule bg-card p-6 shadow-card">
          <h2 className="flex items-center gap-2 text-[1.2rem] font-extrabold text-ink">
            <ShieldCheck className="size-6 text-ok" aria-hidden /> Lock 1 · the reference check
          </h2>
          <p className="mt-2 text-[0.95rem] text-ink-2">Plain code. No AI ever decides whether a paper exists.</p>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[0.92rem] text-ink-2">
            <li>Ask doi.org if the DOI exists in <em>any</em> registry (Crossref, DataCite, mEDRA, JaLC).</li>
            <li>Fetch the official record; ask OpenAlex for a second opinion.</li>
            <li>Compare field by field: title 40, authors 30, year 15 (±1 allowed), venue 15.</li>
            <li>Look up retraction notices (Crossref and Retraction Watch) and preprint status.</li>
            <li>No DOI? Search Crossref&rsquo;s citation matcher, OpenAlex, Open Library and Google Books.</li>
          </ol>
          <p className="mt-3 text-[0.9rem] text-ink-2">Every stamp then answers three questions you can open on the card: does it exist, do your details match, and is it safe to cite.</p>
          <div className="mt-5 grid gap-3">
            <div className="flex items-center gap-4"><Stamp status="verified" size="sm" /><p className="text-[0.88rem] text-ink-2">Score 90+. Ready to cite.</p></div>
            <div className="flex items-center gap-4"><Stamp status="check" size="sm" /><p className="text-[0.88rem] text-ink-2">70–89, not found, retracted, or databases disagree. Fix it, or keep it with a reason. A retracted paper can score 100 and still be amber: the score is about your details, not the paper.</p></div>
            <div className="flex items-center gap-4"><Stamp status="mismatch" size="sm" /><p className="text-[0.88rem] text-ink-2">Proven wrong: the DOI does not exist or belongs to another paper. Replace or remove; export stays locked.</p></div>
          </div>
        </div>

        <div className="rounded-2xl border border-rule bg-card p-6 shadow-card">
          <h2 className="flex items-center gap-2 text-[1.2rem] font-extrabold text-ink">
            <Gavel className="size-6 text-neutral" aria-hidden /> Lock 2 · the claim check
          </h2>
          <p className="mt-2 text-[0.95rem] text-ink-2">Code first, then a Judge with only four possible answers. A sentence takes its weakest result.</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[0.92rem] text-ink-2">
            <li>Every cited passage ID must exist; unknown IDs are dropped.</li>
            <li>Quotes must appear word for word in the passage.</li>
            <li>Numbers, years and author names must appear in what is cited.</li>
            <li>AI reasoning may not introduce any number or year.</li>
            <li>The Judge&rsquo;s evidence quote is itself checked against the passage.</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(Object.keys(JUDGE_VERDICTS) as JudgeVerdict[]).map((v) => (
              <span key={v} className="rounded-full bg-paper-2 px-2.5 py-1 text-[0.8rem] font-semibold text-ink-2">{JUDGE_VERDICTS[v].name}</span>
            ))}
          </div>
          <ul className="mt-4 space-y-2">
            {(Object.keys(CLAIM_LABELS) as ClaimLabel[]).map((l) => (
              <li key={l} className="flex items-start gap-2">
                <ClaimChip label={l} compact className="mt-0.5 shrink-0" />
                <span className="text-[0.86rem] text-ink-2">{CLAIM_LABELS[l].description}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mt-12" aria-labelledby="agents-h">
        <h2 id="agents-h" className="text-[1.3rem] font-extrabold text-ink">The AI roles and their personas</h2>
        <p className="mt-1 max-w-[46rem] text-[0.95rem] text-ink-2">
          Each role has a versioned persona prompt, a strict JSON schema validated by code, a low temperature and one guided retry. Every role first receives the same constitution, and nothing in the input can override it.
        </p>
        <details className="mt-4 rounded-xl border border-rule bg-card px-4 py-3">
          <summary className="cursor-pointer font-semibold text-ink">Read the constitution every agent receives</summary>
          <pre className="mt-3 whitespace-pre-wrap font-mono text-[0.8rem] leading-relaxed text-ink-2">{CONSTITUTION}</pre>
        </details>
        <div className="mt-4 overflow-x-auto rounded-2xl border border-rule bg-card shadow-card">
          <table className="w-full min-w-[46rem] text-left text-[0.88rem]">
            <thead className="bg-card-2 text-[0.78rem] text-ink-3">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Role</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Persona</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Can</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Cannot</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Temp.</th>
              </tr>
            </thead>
            <tbody>
              {AGENT_DEFS.map((a) => (
                <tr key={a.id} className="border-t border-rule align-top">
                  <th scope="row" className="px-4 py-3 font-bold text-ink">
                    {a.name}
                    <span className="block font-record text-[0.75rem] font-normal text-ink-3">{a.version}</span>
                  </th>
                  <td className="px-4 py-3 text-ink-2">
                    {a.persona.split("\n")[0].replace(/^ROLE:\s*/, "")}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[0.8rem] font-semibold text-accent">Full prompt</summary>
                      <pre className="mt-2 whitespace-pre-wrap font-mono text-[0.75rem] leading-relaxed text-ink-2">{a.persona}</pre>
                    </details>
                  </td>
                  <td className="px-4 py-3 text-ink-2">{CAN_CANNOT[a.id]?.[0]}</td>
                  <td className="px-4 py-3 text-ink-2">{CAN_CANNOT[a.id]?.[1]}</td>
                  <td className="px-4 py-3 text-ink-2 tabular">{a.temperature}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12 grid gap-6 lg:grid-cols-2" aria-label="Guardrails and governance">
        <div className="rounded-2xl border border-rule bg-card p-6 shadow-card">
          <h2 className="flex items-center gap-2 text-[1.2rem] font-extrabold text-ink"><Lock className="size-5 text-ink-3" aria-hidden /> Guardrails</h2>
          <ul className="mt-3 space-y-2 text-[0.92rem] text-ink-2">
            <li><strong className="text-ink">Data, not instructions.</strong> Source text sits inside a data block; passages that look like prompt injection are flagged and neutralised.</li>
            <li><strong className="text-ink">No ID, no citation.</strong> Citations outside the given passage list are deleted by code.</li>
            <li><strong className="text-ink">Schema or nothing.</strong> Every AI reply is validated; one retry, then a safe no-AI fallback that is labelled as such.</li>
            <li><strong className="text-ink">No leaks into prose.</strong> DOIs, URLs and citation markers are stripped from AI text; references are formatted by code.</li>
            <li><strong className="text-ink">Checkpoints on the server.</strong> The orchestrator refuses to search before the plan is approved, or write before sources are chosen.</li>
            <li><strong className="text-ink">Rate limits and fallbacks.</strong> Providers fail over automatically; scholarly APIs are cached and throttled.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-rule bg-card p-6 shadow-card">
          <h2 className="flex items-center gap-2 text-[1.2rem] font-extrabold text-ink"><Scale className="size-5 text-ink-3" aria-hidden /> Governance</h2>
          <ul className="mt-3 space-y-2 text-[0.92rem] text-ink-2">
            <li className="flex gap-2"><UserCheck className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><strong className="text-ink">The student is accountable.</strong> Three approvals; overrides need a written reason that appears on the receipt.</span></li>
            <li className="flex gap-2"><ScrollText className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><strong className="text-ink">Disclosure.</strong> An AI-use statement generated from what actually happened, plus a printable receipt and a read-only supervisor link.</span></li>
            <li className="flex gap-2"><Fingerprint className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><strong className="text-ink">A log nobody can edit.</strong> Hash-chained entries; a database trigger refuses updates and deletes.</span></li>
            <li className="flex gap-2"><Eye className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><strong className="text-ink">Transparency.</strong> Every AI call is stored with its persona version and exactly what was sent.</span></li>
            <li className="flex gap-2"><EyeOff className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><strong className="text-ink">Privacy.</strong> No sign-in, no email. Only short passages go to AI. Download or delete everything at any time.</span></li>
            <li className="flex gap-2"><Lock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden /><span><strong className="text-ink">Course policies.</strong> Strict, Standard and Exploratory presets, enforced server-side.</span></li>
          </ul>
        </div>
      </section>

      <section className="mt-12 rounded-2xl border border-rule bg-card p-6 shadow-card" aria-labelledby="bench-h">
        <h2 id="bench-h" className="text-[1.3rem] font-extrabold text-ink">Measured, not claimed</h2>
        <p className="mt-1 max-w-[52rem] text-[0.95rem] text-ink-2">
          Nothing in the reference check is trained: it is rules plus live look-ups. So there is no training data, only test data: reference lists where we know which entries are real and which are invented.
        </p>
        {big ? (
          <div className="mt-4 rounded-xl border border-rule bg-paper p-5">
            <p className="font-bold text-ink">Large test set · {big.cases} references in {caseFile.categories.length} kinds of case</p>
            <p className="text-[0.85rem] text-ink-3">Real records drawn at random from Crossref and DataCite, written in six citation styles, plus invented references made by altering them. Never used to adjust the rules.</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><dt className="text-[0.75rem] text-ink-3">Invented, stamped Verified</dt><dd className="text-[1.5rem] font-extrabold text-ink tabular">{big.fakes - big.fakesNotVerified}/{big.fakes}</dd></div>
              <div><dt className="text-[0.75rem] text-ink-3">Real, stamped Mismatch</dt><dd className="text-[1.5rem] font-extrabold text-ink tabular">{big.realWronglyMismatch + big.imperfectWronglyMismatch}/{big.real + big.imperfect}</dd></div>
              <div><dt className="text-[0.75rem] text-ink-3">Exactly the right stamp</dt><dd className="text-[1.5rem] font-extrabold text-ink tabular">{Math.round(big.exactPct)}%</dd></div>
              <div><dt className="text-[0.75rem] text-ink-3">Typical time per reference</dt><dd className="text-[1.5rem] font-extrabold text-ink tabular">{big.medianMs ? `${(big.medianMs / 1000).toFixed(1)} s` : "n/a"}</dd></div>
            </dl>
            <p className="mt-3">
              <Link href="/how-it-works/test-set" className="font-semibold text-accent hover:text-accent-hover">See every test reference and the stamp it got →</Link>
            </p>
          </div>
        ) : null}
        <p className="mt-5 text-[0.9rem] font-semibold text-ink-2">Two smaller, hand-written sets</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            { name: "Held-out set", note: "Built separately and never used for tuning. This is the honest number.", b: holdout },
            { name: "Development set", note: "The set we tuned the parser on, so it scores higher by construction.", b: tuning },
          ].map(({ name, note, b }) =>
            b ? (
              <div key={name} className="rounded-xl bg-paper p-4">
                <p className="font-bold text-ink">{name} · {b.items} references</p>
                <p className="text-[0.82rem] text-ink-3">{note}</p>
                <dl className="mt-3 grid grid-cols-3 gap-2">
                  <div><dt className="text-[0.75rem] text-ink-3">Fakes caught</dt><dd className="text-[1.4rem] font-extrabold text-ink tabular">{b.fakesCaught}/{b.fake}</dd></div>
                  <div><dt className="text-[0.75rem] text-ink-3">Real marked red</dt><dd className="text-[1.4rem] font-extrabold text-ink tabular">{b.realWronglyRed}/{b.real}</dd></div>
                  <div><dt className="text-[0.75rem] text-ink-3">Exact label</dt><dd className="text-[1.4rem] font-extrabold text-ink tabular">{Math.round((b.exactCorrect / b.items) * 100)}%</dd></div>
                </dl>
                <p className="mt-2 text-[0.78rem] text-ink-3">Run {new Date(b.ranAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} with <span className="font-record">npm run bench</span>.</p>
              </div>
            ) : null,
          )}
        </div>
      </section>

      {claims ? (
        <section className="mt-6 rounded-2xl border border-rule bg-card p-6 shadow-card" aria-labelledby="claims-h">
          <h2 id="claims-h" className="text-[1.15rem] font-extrabold text-ink">The sentence check, measured too</h2>
          <p className="mt-1 max-w-[52rem] text-[0.92rem] text-ink-2">
            {claims.items} sentences written about real abstracts, where we know whether the passage supports each one. Three contain a planted error: a misquote, a changed number and a changed year.
          </p>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-paper p-3"><dt className="text-[0.75rem] text-ink-3">Planted errors caught by code</dt><dd className="text-[1.4rem] font-extrabold text-ink tabular">{claims.plantedCaught}/{claims.plantedErrors}</dd></div>
            <div className="rounded-xl bg-paper p-3"><dt className="text-[0.75rem] text-ink-3">False alarms from code</dt><dd className="text-[1.4rem] font-extrabold text-ink tabular">{claims.falseAlarms}/{claims.cleanItems}</dd></div>
            {claims.judge ? (
              <>
                <div className="rounded-xl bg-paper p-3"><dt className="text-[0.75rem] text-ink-3">Judge gave the expected answer</dt><dd className="text-[1.4rem] font-extrabold text-ink tabular">{claims.judge.exact}/{claims.judge.of}</dd></div>
                <div className="rounded-xl bg-paper p-3"><dt className="text-[0.75rem] text-ink-3">Unsupported claims kept from “Verified”</dt><dd className="text-[1.4rem] font-extrabold text-ink tabular">{claims.judge.unsupportedNotVerified}</dd></div>
              </>
            ) : null}
          </dl>
          <p className="mt-3 text-[0.85rem] text-ink-3">
            {claims.judge
              ? `The Judge here was ${claims.judge.model}. The Judge is an AI and is not perfect, which is why a sentence also has to pass the code checks, and why you approve the summary yourself.`
              : "The Judge part needs an AI model and was not run on this copy."}{" "}
            Run it with <span className="font-record">npm run bench:claims</span>.
          </p>
        </section>
      ) : null}

      <section className="mt-12" aria-labelledby="limits-h">
        <h2 id="limits-h" className="flex items-center gap-2 text-[1.3rem] font-extrabold text-ink"><TriangleExclamationPoint className="size-5 text-warn" aria-hidden /> Honest limitations</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[0.95rem] text-ink-2">
          <li>Claims are checked against the full text only when it is free to read (PubMed Central, Europe PMC, arXiv) or you add your own PDF. For paywalled papers Knowlix can read the abstract only, so some sentences stay “Reported, not checked”.</li>
          <li>Books, reports and web pages without a DOI often get “Please check”. That is a prompt to confirm the source yourself, never an accusation.</li>
          <li>The Judge is an AI and can be wrong, which is why the words it quotes as evidence are re-checked by code, and why you can report any check.</li>
          <li>Coverage depends on the databases. Very new, very local or non-English work may be missing from all of them.</li>
          <li>The free database tiers have daily limits. When one runs out, Knowlix says “not checked” and never guesses.</li>
          <li>A small AI model running on a laptop writes weaker summaries than a large cloud model, so more of its sentences are removed by the checks. The checks themselves are the same.</li>
        </ul>
        <p className="mt-6">
          <Link href="/" className="font-semibold text-accent hover:text-accent-hover">Try it: paste a reference list →</Link>
        </p>
      </section>
    </div>
  );
}
