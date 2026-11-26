/**
 * Lock 2 benchmark: 20 claim/passage pairs from real abstracts (bench/data/claims.json),
 * run through the SAME code the website uses.
 *
 *   npm run bench:claims
 *
 * Two things are measured:
 *   1. Code checks (no AI): do the three claims with a changed quote, number or year fail,
 *      and do the other seventeen pass without a false alarm?
 *   2. The Judge (AI), when a model is configured (GROQ_API_KEY, GEMINI_API_KEY or
 *      OLLAMA_BASE_URL): does it give the expected one of four answers, and does the final
 *      label ever say "Verified" for a claim the passage does not support?
 */
import fs from "node:fs";
import path from "node:path";
import { codeChecks, decideLabel, evidenceVerified, quoteAllCopiedRuns } from "../src/server/research/claims";
import { runAgent } from "../src/server/agents/runtime";
import { judge } from "../src/server/agents/prompts/judge";
import { aiAvailable, primaryModel } from "../src/server/agents/providers";
import type { JudgeResult, JudgeVerdict, Passage } from "../src/shared/types";

interface Item {
  id: string;
  passage: string;
  claim: string;
  quote: string | null;
  expected: JudgeVerdict;
  codeExpectation: string | null;
}

const data: Item[] = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "claims.json"), "utf8"));
// The bench has no database: AI calls are simply not recorded.
const noDb = { insert: () => ({ values: async () => undefined }) } as never;

async function main() {
  const rows = data.map((it) => {
    const passages = new Map<string, Passage>([["P1", { id: "P1", sourceId: "S1", text: it.passage, location: "abstract" }]]);
    // As in the app: wording copied from the passage is put in quotation marks before the checks run.
    const fixed = quoteAllCopiedRuns(it.claim, [{ id: "P1", text: it.passage }]);
    const checks = codeChecks({ text: fixed.text, kind: "sourced", citations: ["P1"], quote: it.quote ? { passageId: "P1", text: it.quote } : fixed.first }, passages, [], []);
    return { it, checks, codeFailed: checks.some((c) => c.outcome === "fail"), quoted: fixed.added, judge: null as JudgeResult | null, label: "" };
  });

  const planted = rows.filter((r) => r.it.codeExpectation);
  const clean = rows.filter((r) => !r.it.codeExpectation);
  const caught = planted.filter((r) => r.codeFailed).length;
  const falseAlarms = clean.filter((r) => r.codeFailed);
  console.log(`Code checks: ${caught}/${planted.length} planted errors caught (misquote, changed number, changed year); ${falseAlarms.length}/${clean.length} false alarms. Quotation marks were added to ${rows.filter((r) => r.quoted).length} claims that reused the source's wording.`);
  for (const r of planted.filter((r) => !r.codeFailed)) console.log(`  MISSED ${r.it.id} (${r.it.codeExpectation})`);
  for (const r of falseAlarms) console.log(`  FALSE ALARM ${r.it.id}: ${r.checks.find((c) => c.outcome === "fail")?.detail}`);

  let judged: null | { model: string; exact: number; of: number; unsupportedNotVerified: string; supportedVerified: string } = null;
  if (aiAvailable()) {
    const model = primaryModel();
    console.log(`\nJudge on ${model?.model} (${model?.provider}) …`);
    for (let i = 0; i < rows.length; i += 4) {
      const batch = rows.slice(i, i + 4);
      try {
        const out = await runAgent(judge, { claims: batch.map((r) => ({ id: r.it.id, text: r.it.claim, passages: [{ id: "P1", text: r.it.passage }] })) }, { db: noDb, workspaceId: "bench", runId: null });
        for (const v of out.output.verdicts) {
          const r = batch.find((x) => x.it.id === v.claimId);
          if (r && !r.judge) r.judge = { passageId: "P1", verdict: v.verdict, evidence: v.evidence, reason: v.reason, evidenceVerified: v.verdict === "says_nothing" ? true : evidenceVerified(v.evidence, r.it.passage) };
        }
        process.stdout.write(".".repeat(batch.length));
      } catch (err) {
        process.stdout.write("x".repeat(batch.length));
        console.log(`\n  batch failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log("\n");
    for (const r of rows) r.label = decideLabel({ kind: "sourced" }, r.checks, r.judge ? [r.judge] : null).label;
    const answered = rows.filter((r) => r.judge);
    const exact = answered.filter((r) => r.judge!.verdict === r.it.expected).length;
    const unsupported = rows.filter((r) => r.it.expected !== "supports");
    const supported = rows.filter((r) => r.it.expected === "supports");
    for (const r of rows) {
      const ok = r.judge?.verdict === r.it.expected;
      console.log(`${ok ? "  ok " : "  !! "}${r.it.id} expected ${r.it.expected.padEnd(12)} judge ${String(r.judge?.verdict ?? "none").padEnd(12)} code ${r.codeFailed ? "FAIL" : "pass"} → label ${r.label}${r.judge && !r.judge.evidenceVerified ? " (judge's evidence not in passage)" : ""}`);
    }
    judged = {
      model: `${model?.model} (${model?.provider})`,
      exact,
      of: answered.length,
      unsupportedNotVerified: `${unsupported.filter((r) => r.label !== "verified").length}/${unsupported.length}`,
      supportedVerified: `${supported.filter((r) => r.label === "verified").length}/${supported.length}`,
    };
    console.log(`\nJudge gave the expected answer for ${exact}/${answered.length}.`);
    console.log(`Claims the passage does NOT fully support that were kept from "Verified": ${judged.unsupportedNotVerified}.`);
    console.log(`Supported claims labelled "Verified": ${judged.supportedVerified}.`);
  } else {
    console.log("\nNo AI model configured, so the Judge part was skipped (set GROQ_API_KEY, GEMINI_API_KEY or OLLAMA_BASE_URL).");
  }

  const pub = path.join(__dirname, "..", "src", "shared", "benchmark.json");
  const current = fs.existsSync(pub) ? JSON.parse(fs.readFileSync(pub, "utf8")) : {};
  current.claims = { ranAt: new Date().toISOString(), items: rows.length, plantedErrors: planted.length, plantedCaught: caught, cleanItems: clean.length, falseAlarms: falseAlarms.length, judge: judged };
  fs.writeFileSync(pub, `${JSON.stringify(current, null, 2)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
