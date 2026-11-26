/**
 * Lock 1 benchmark: runs every reference in bench/data/references.json
 * through the SAME code the website uses and reports accuracy.
 *   npm run bench            (needs internet; ~1–2 min)
 */
import fs from "node:fs";
import path from "node:path";
import { parseInput } from "../src/server/verify/structured";
import { verifyReference } from "../src/server/verify/verify";

type Item = { id: string; kind: "real" | "fake"; category: string; raw: string; expected: "verified" | "check" | "mismatch"; expectedFlags: string[]; note: string };

// npm run bench            → tuning set (references.json)
// npm run bench -- holdout → held-out set (holdout.json), never used for tuning
const dataset = process.argv[2] === "holdout" ? "holdout" : "references";
const data: Item[] = JSON.parse(fs.readFileSync(path.join(__dirname, "data", `${dataset}.json`), "utf8"));
const only = dataset === "holdout" ? process.argv[3] : process.argv[2];

async function main() {
  const rows: { id: string; category: string; kind: string; expected: string; got: string; score: number | null; flags: string[]; reason: string; ms: number; ok: boolean; flagsOk: boolean }[] = [];
  const queue = data.filter((d) => !only || d.id === only || d.category === only);
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const item = queue[i++];
      const { items } = await parseInput(item.raw);
      const parsed = items[0];
      if (!parsed) {
        rows.push({ id: item.id, category: item.category, kind: item.kind, expected: item.expected, got: "unparsed", score: null, flags: [], reason: "could not parse", ms: 0, ok: false, flagsOk: false });
        continue;
      }
      const r = await verifyReference(parsed);
      const flags = r.flags.map((f) => f.code);
      // Retracted papers are real records that we deliberately mark "check" so the student must acknowledge them.
      const got = r.status;
      const expectedStatus = item.expectedFlags.includes("retracted") ? "check" : item.expected;
      const ok = got === expectedStatus;
      const flagsOk = item.expectedFlags.every((f) => flags.includes(f as never));
      rows.push({ id: item.id, category: item.category, kind: item.kind, expected: expectedStatus, got, score: r.score, flags, reason: r.reason, ms: r.durationMs, ok, flagsOk });
      process.stdout.write(ok ? "." : "x");
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  rows.sort((a, b) => a.id.localeCompare(b.id));
  console.log("\n");
  for (const r of rows.filter((r) => !r.ok || !r.flagsOk)) console.log(`${r.id} [${r.category}] expected ${r.expected} got ${r.got} (score ${r.score}) flags=${r.flags.join("|")} :: ${r.reason}`);

  const real = rows.filter((r) => r.kind === "real");
  const fake = rows.filter((r) => r.kind === "fake");
  const fakesCaught = fake.filter((r) => r.got !== "verified").length;
  const realPassed = real.filter((r) => r.got === r.expected).length;
  const falseRed = real.filter((r) => r.got === "mismatch").length;
  const summary = {
    ranAt: new Date().toISOString(),
    total: rows.length,
    exactLabelAccuracy: rows.filter((r) => r.ok).length / rows.length,
    fakesNotVerified: `${fakesCaught}/${fake.length}`,
    fakesProvenRed: `${fake.filter((r) => r.got === "mismatch").length}/${fake.filter((r) => r.expected === "mismatch").length} expected red`,
    realCorrect: `${realPassed}/${real.length}`,
    realWronglyRed: falseRed,
    flagAccuracy: rows.filter((r) => r.flagsOk).length / rows.length,
    medianMs: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!only) {
    fs.writeFileSync(path.join(__dirname, "results", dataset === "holdout" ? "lock1-holdout.json" : "lock1.json"), JSON.stringify({ dataset, summary, rows }, null, 2));
    // Publish the headline numbers to the app (How it works page) — measured, never typed in by hand.
    const pub = path.join(__dirname, "..", "src", "shared", "benchmark.json");
    const current = fs.existsSync(pub) ? JSON.parse(fs.readFileSync(pub, "utf8")) : {};
    current[dataset === "holdout" ? "holdout" : "tuning"] = {
      ...summary,
      items: rows.length,
      real: real.length,
      fake: fake.length,
      fakesCaught: fakesCaught,
      realWronglyRed: falseRed,
      exactCorrect: rows.filter((r) => r.ok).length,
    };
    fs.writeFileSync(pub, `${JSON.stringify(current, null, 2)}\n`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
