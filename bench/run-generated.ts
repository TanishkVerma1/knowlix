/**
 * Runs every case in bench/data/generated.json through the SAME code the
 * website uses (parseInput → verifyReference) and writes:
 *   - src/shared/benchmark-cases.json   every case + result, shown inside the app
 *   - bench/results/lock1-generated.json full detail (field scores, steps) for debugging
 *
 *   npm run bench:generated                  all cases (needs internet; ~5–10 min)
 *   npm run bench:generated -- --errors      re-run only cases that ended in an upstream error, merge into the last run
 *   npm run bench:generated -- GF012         one case, or one category id; prints detail, writes nothing
 *
 * Nothing here is tuned: the script only records what the verifier answers.
 * A transient upstream failure (timeout, database unreachable) is retried once
 * and then recorded as `error`, which is counted separately from wrong answers.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseInput } from "../src/server/verify/structured";
import { verifyReference } from "../src/server/verify/verify";

type Label = "verified" | "check" | "mismatch";
type Got = Label | "error";
interface Case {
  id: string;
  category: string;
  kind: "real" | "imperfect" | "fake";
  style: string;
  input: string;
  acceptable: Label[];
  mustNot: Label[];
  truth: { doi?: string; title: string; firstAuthor?: string; year?: number; source: string; role: string };
  tags: string[];
  note: string;
}
interface Dataset {
  seed: number;
  builtAt: string;
  provenance: string;
  categories: { id: string; name: string; description: string; kind: Case["kind"] }[];
  cases: Case[];
}
interface Row {
  id: string;
  category: string;
  kind: Case["kind"];
  style: string;
  input: string;
  acceptable: Label[];
  mustNot: Label[];
  got: Got;
  score: number | null;
  reason: string;
  pass: boolean;
  seriousError: boolean;
  ms: number;
  note: string;
}
interface Detail extends Row {
  fullInput: string;
  truth: Case["truth"];
  tags: string[];
  attempts: number;
  reasonCode: string | null;
  recordSource: string | null;
  recordTitle: string | null;
  recordDoi: string | null;
  flags: string[];
  parsed: Record<string, unknown> | null;
  fields: { field: string; entered: string | null; found: string | null; similarity: number; points: number; verdict: string }[];
  checks: { id: string; outcome: string; detail: string }[];
}

const CONCURRENCY = 4;
const CASE_TIMEOUT_MS = 75_000;
const RETRY_PAUSE_MS = 20_000;
const ROOT = path.join(__dirname, "..");
// BENCH_SEED selects the sample built with the same seed (see build-generated.ts).
const SUFFIX = process.env.BENCH_SEED && Number(process.env.BENCH_SEED) !== 20261125 ? `-${Number(process.env.BENCH_SEED)}` : "";
const DATA = path.join(__dirname, "data", `generated${SUFFIX}.json`);
const DETAIL_OUT = path.join(__dirname, "results", "lock1-generated.json");
const PUBLIC_OUT = path.join(ROOT, "src", "shared", "benchmark-cases.json");

const arg = process.argv[2];
const onlyErrors = arg === "--errors";
const only = arg && !arg.startsWith("--") ? arg : null;

/** Short fingerprint of the checker's source files, so a result can be tied to the exact code that produced it. */
function verifierFingerprint(): string {
  const h = createHash("sha1");
  for (const rel of ["src/server/verify/verify.ts", "src/server/verify/match.ts", "src/server/verify/parse.ts", "src/server/verify/structured.ts", "src/server/text/similarity.ts", "src/shared/identifiers.ts"]) {
    const file = path.join(ROOT, rel);
    if (fs.existsSync(file)) h.update(fs.readFileSync(file));
  }
  return h.digest("hex").slice(0, 12);
}
const FINGERPRINT = verifierFingerprint();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * The checker catches its own exceptions, logs them with console.error and answers "could not be checked".
 * That is a bug in the checker, not an outage, so the message is captured here to report it as such.
 */
let lastCrash = "";
const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("verifyReference failed")) {
    const e = args[1];
    lastCrash = e instanceof Error ? e.message : String(e);
    return;
  }
  originalConsoleError(...args);
};

type Attempt = { transient: true; why: string; ms: number } | { transient: false; crashed?: string; detail: Omit<Detail, keyof Row | "fullInput" | "truth" | "tags" | "attempts">; got: Label; score: number | null; reason: string; ms: number };

/** One pass through the real verifier. "Transient" = the databases did not answer, so there is no verdict to grade. */
async function attempt(c: Case): Promise<Attempt> {
  const t0 = Date.now();
  try {
    const { items } = await parseInput(c.input);
    const parsed = items[0];
    if (!parsed) {
      return { transient: false, got: "check", score: null, reason: "The reference could not be read at all.", ms: Date.now() - t0, detail: { reasonCode: "unparsed", recordSource: null, recordTitle: null, recordDoi: null, flags: [], parsed: null, fields: [], checks: [] } };
    }
    const r = await withTimeout(verifyReference(parsed), CASE_TIMEOUT_MS);
    const flags = r.flags.map((f) => f.code);
    // An "error" step means the checker itself threw an exception (see lastCrash above).
    const crashed = r.checks.some((s) => s.id === "error") ? lastCrash || "unknown internal error" : undefined;
    // The verifier itself says when it could not reach its sources; that is an outage, not an answer.
    if (!crashed && (r.reasonCode === "service-unavailable" || flags.includes("service-degraded"))) return { transient: true, why: r.reason, ms: Date.now() - t0 };
    return {
      transient: false,
      crashed,
      got: r.status as Label,
      score: r.score,
      reason: crashed ? `${r.reason} [The checker stopped with an internal error: ${crashed}. This is a bug in the checker, not an outage.]` : r.reason,
      ms: r.durationMs,
      detail: {
        reasonCode: crashed ? "verifier-exception" : r.reasonCode,
        recordSource: r.recordSource,
        recordTitle: r.record?.title ?? null,
        recordDoi: r.record?.DOI ?? null,
        flags,
        parsed: { format: parsed.format, title: parsed.title, authors: parsed.authors.map((a) => a.family), etAl: parsed.etAl, year: parsed.year, venue: parsed.venue, publisher: parsed.publisher, doi: parsed.doi, isbn: parsed.isbn, arxivId: parsed.arxivId },
        fields: r.fields.map((f) => ({ field: f.field, entered: f.entered, found: f.found, similarity: Math.round(f.similarity * 100) / 100, points: Math.round(f.points * 10) / 10, verdict: f.verdict })),
        checks: r.checks.map((s) => ({ id: s.id, outcome: s.outcome, detail: s.detail })),
      },
    };
  } catch (err) {
    return { transient: true, why: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 };
  }
}

async function runCase(c: Case): Promise<Detail> {
  let a = await attempt(c);
  let attempts = 1;
  // Retry once after a pause: outages pass, and a crash that repeats is shown to be deterministic.
  if (a.transient || a.crashed) {
    await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    a = await attempt(c);
    attempts = 2;
  }
  const base = { id: c.id, category: c.category, kind: c.kind, style: c.style, input: c.input.length > 400 ? `${c.input.slice(0, 399)}…` : c.input, acceptable: c.acceptable, mustNot: c.mustNot };
  const tail = { note: c.note, fullInput: c.input, truth: c.truth, tags: c.tags, attempts };
  if (a.transient) {
    return { ...base, got: "error", score: null, reason: `Not graded: ${a.why}`, pass: false, seriousError: false, ms: a.ms, ...tail, reasonCode: "upstream-error", recordSource: null, recordTitle: null, recordDoi: null, flags: [], parsed: null, fields: [], checks: [] };
  }
  return { ...base, got: a.got, score: a.score, reason: a.reason, pass: c.acceptable.includes(a.got), seriousError: c.mustNot.includes(a.got), ms: a.ms, ...tail, ...a.detail };
}

/**
 * `fingerprint` names the checker code that produced the run. When only the errored cases are re-run later
 * and the checker has changed in between, the original fingerprint is kept and the newer one is listed beside it.
 */
function publish(data: Dataset, details: Detail[], fingerprint: { verifierFingerprint: string; errorsRerunFingerprint?: string }) {
  const rows = [...details].sort((a, b) => a.id.localeCompare(b.id));
  const of = (k: Case["kind"]) => rows.filter((r) => r.kind === k);
  const errors = rows.filter((r) => r.got === "error").length;
  const graded = rows.length - errors;
  const exact = rows.filter((r) => r.pass).length;
  const totals = {
    cases: rows.length,
    exact,
    /** Share of graded cases (cases minus upstream errors) whose label was one of the acceptable ones. */
    exactPct: graded ? Math.round((1000 * exact) / graded) / 10 : 0,
    fakes: of("fake").length,
    fakesNotVerified: of("fake").filter((r) => r.got !== "verified" && r.got !== "error").length,
    fakesProvenWrong: of("fake").filter((r) => r.got === "mismatch").length,
    real: of("real").length,
    realWronglyMismatch: of("real").filter((r) => r.got === "mismatch").length,
    imperfect: of("imperfect").length,
    imperfectWronglyMismatch: of("imperfect").filter((r) => r.got === "mismatch").length,
    errors,
    // Extra, optional keys (not required by the app):
    realVerified: of("real").filter((r) => r.got === "verified").length,
    fakesExpectedProvenWrong: of("fake").filter((r) => r.acceptable.length === 1 && r.acceptable[0] === "mismatch").length,
    seriousErrors: rows.filter((r) => r.seriousError).length,
    medianMs: rows.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0,
  };
  const categories = data.categories.map((c) => {
    const mine = rows.filter((r) => r.category === c.id);
    return { id: c.id, name: c.name, description: c.description, kind: c.kind, cases: mine.length, correct: mine.filter((r) => r.pass).length, seriousErrors: mine.filter((r) => r.seriousError).length, errors: mine.filter((r) => r.got === "error").length };
  });
  const generatedAt = new Date().toISOString();
  // How much of the run had OpenAlex available (its free daily quota is often used up).
  const second = rows.flatMap((r) => r.checks.filter((c) => c.id === "second"));
  const secondRan = second.filter((c) => c.outcome !== "skip" || !/unavailable/i.test(c.detail)).length;
  const searches = rows.flatMap((r) => r.checks.filter((c) => c.id === "search" && /OpenAlex/.test(c.detail)));
  const searchRan = searches.filter((c) => !c.detail.includes("OpenAlex (unavailable)")).length;
  const openAlex = { secondOpinionAnswered: secondRan, secondOpinionAsked: second.length, titleSearchAnswered: searchRan, titleSearchAsked: searches.length };
  const provenance = `${data.provenance} The sample was drawn on ${data.builtAt} with seed ${data.seed}, and the cases were fixed before the checker was run on them. During this run OpenAlex (free tier, no key) answered ${secondRan} of ${second.length} "second opinion" lookups and ${searchRan} of ${searches.length} title searches; where it did not answer, the checker skipped that step (this is expected, not a failure) and the result rests on the other sources alone: doi.org, Crossref, DataCite and, for books, Open Library and Google Books.`;

  fs.mkdirSync(path.dirname(DETAIL_OUT), { recursive: true });
  fs.writeFileSync(DETAIL_OUT, JSON.stringify({ generatedAt, seed: data.seed, ...fingerprint, openAlex, totals, categories, rows }, null, 1));

  const cases = rows.map((r) => ({ id: r.id, category: r.category, kind: r.kind, style: r.style, input: r.input, acceptable: r.acceptable, mustNot: r.mustNot, got: r.got, score: r.score, reason: r.reason, pass: r.pass, seriousError: r.seriousError, ms: r.ms, note: r.note }));
  // One case per line: readable diffs, and well under the 350 KB budget.
  const head = JSON.stringify({ generatedAt, seed: data.seed, builtAt: data.builtAt, ...fingerprint, provenance, totals, categories }, null, 2).replace(/\n}$/, "");
  const body = `${head},\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(",\n")}\n  ]\n}\n`;
  fs.writeFileSync(PUBLIC_OUT, body);
  return { totals, categories, bytes: Buffer.byteLength(body) };
}

async function main() {
  const data: Dataset = JSON.parse(fs.readFileSync(DATA, "utf8"));
  let previous: Detail[] = [];
  let fingerprint: { verifierFingerprint: string; errorsRerunFingerprint?: string } = { verifierFingerprint: FINGERPRINT };
  let queue = data.cases;
  if (onlyErrors) {
    const last = JSON.parse(fs.readFileSync(DETAIL_OUT, "utf8")) as { rows: Detail[]; verifierFingerprint?: string; errorsRerunFingerprint?: string };
    previous = last.rows;
    const bad = new Set(previous.filter((r) => r.got === "error").map((r) => r.id));
    queue = data.cases.filter((c) => bad.has(c.id));
    // Keep the fingerprint of the code that produced the full run; note a second one only if cases are re-run on changed code.
    if (last.verifierFingerprint) {
      fingerprint = { verifierFingerprint: last.verifierFingerprint, errorsRerunFingerprint: last.errorsRerunFingerprint };
      if (queue.length && last.verifierFingerprint !== FINGERPRINT) fingerprint.errorsRerunFingerprint = FINGERPRINT;
    }
    console.log(`Re-running ${queue.length} case(s) that ended in an upstream error.`);
  } else if (only) {
    queue = data.cases.filter((c) => c.id === only || c.category === only);
  }

  const done: Detail[] = [];
  let i = 0;
  async function worker() {
    while (i < queue.length) {
      const c = queue[i++];
      const d = await runCase(c);
      done.push(d);
      process.stdout.write(d.got === "error" ? "E" : d.seriousError ? "!" : d.pass ? "." : "x");
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log("\n");

  if (only) {
    for (const d of done.sort((a, b) => a.id.localeCompare(b.id))) console.log(JSON.stringify(d, null, 2));
    return;
  }
  const merged = onlyErrors ? previous.map((p) => done.find((d) => d.id === p.id) ?? p) : done;
  const { totals, categories, bytes } = publish(data, merged, fingerprint);
  for (const r of merged.filter((x) => !x.pass).sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`${r.seriousError ? "SERIOUS " : r.got === "error" ? "ERROR   " : "wrong   "}${r.id} [${r.category}/${r.style}] expected ${r.acceptable.join("|")} got ${r.got} (score ${r.score}) :: ${r.reason}`);
  }
  console.log("");
  for (const c of categories) console.log(`${c.id.padEnd(30)} ${String(c.correct).padStart(3)}/${String(c.cases).padEnd(3)} serious ${c.seriousErrors} errors ${c.errors}`);
  console.log(JSON.stringify(totals, null, 2));
  console.log(`Wrote ${path.relative(ROOT, PUBLIC_OUT)} (${Math.round(bytes / 1024)} KB) and ${path.relative(ROOT, DETAIL_OUT)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
