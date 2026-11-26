/**
 * Writes docs/AGENT_PERSONAS.md from the real prompt definitions, so the
 * document can never drift from what the agents actually receive.
 *   npm run docs:personas
 */
import fs from "node:fs";
import path from "node:path";
import { CONSTITUTION } from "../src/server/agents/prompts/constitution";
import { planner } from "../src/server/agents/prompts/planner";
import { finder } from "../src/server/agents/prompts/finder";
import { writer, repair } from "../src/server/agents/prompts/writer";
import { judge } from "../src/server/agents/prompts/judge";
import { critic } from "../src/server/agents/prompts/critic";

const agents = [planner, finder, writer, repair, judge, critic];

const GUARDRAILS: [string, string, string][] = [
  ["Data, not instructions", "Every agent gets the constitution first. Source text is wrapped in <input_json> as data. Passages matching prompt-injection patterns are flagged (shown to the student) and their markup neutralised.", "agents/prompts/constitution.ts, agents/guardrails.ts (looksLikeInjection, neutralise)"],
  ["Personal data stays home", "Emails, phone numbers and ID numbers are removed from the question before it is stored, searched or sent to any AI; the agent room says how many.", "agents/guardrails.ts (redactPersonal), services/research.ts (createRun)"],
  ["Schema or nothing", "Every reply is parsed and validated with zod. One retry tells the model exactly what was wrong; then the step falls back to the labelled no-AI version.", "agents/runtime.ts (runAgent)"],
  ["No ID, no citation", "Citations to passage IDs that were not provided are deleted, and the sentence fails its check.", "agents/guardrails.ts (keepKnownIds), research/claims.ts"],
  ["No leaks into prose", "DOIs, URLs and (P3)-style markers are stripped from AI text. References are formatted by citeproc code, never by the AI.", "agents/guardrails.ts (scrubProse)"],
  ["Quotes are exact", "A quote must appear word for word (≥95% fuzzy, for curly quotes) in its passage.", "research/claims.ts (quoteInPassage)"],
  ["Copied wording becomes a quotation", "Eight or more words in a row taken from a cited passage are put in quotation marks by code, so a sentence is either a paraphrase or an honest quote.", "research/claims.ts (quoteCopiedRun, SIMILARITY_RUN)"],
  ["Numbers, years, names", "Every number and year in a sentence must appear in what it cites; naming an author whose paper is not cited fails. AI reasoning may not introduce any number or year.", "research/claims.ts (codeChecks)"],
  ["The Judge is checked too", "The Judge's evidence quote must be found in the passage, or 'supports' is downgraded to 'Reported, not checked'.", "research/claims.ts (evidenceVerified, decideLabel)"],
  ["The Critic is checked too", "A Critic flag that states a checkable fact (sources are old, mostly preprints, too few) is kept only when code agrees with it.", "services/research.ts (writeStep)"],
  ["Not found is a label, not a failure", "A sentence that only says the sources do not cover something is moved to the Not found list instead of being forced to cite.", "services/research.ts (writeStep)"],
  ["Weakest result wins", "A sentence gets the label of its weakest check. Failures get one rewrite (repair persona), are re-checked, and are otherwise removed and shown to the student.", "services/research.ts (runWrite)"],
  ["Checkpoints on the server", "The orchestrator refuses to search before the plan is approved and to write before sources are chosen (HTTP 409).", "services/research.ts (requireState, assertStep)"],
  ["Provider failover", "Groq → Gemini → Ollama, falling back on rate limits, outages and retired models. Keys never reach the browser.", "agents/providers/index.ts"],
  ["Full transparency", "Every call is streamed live to the agent room as it is typed, and stored: persona version, model, temperature, the exact text sent and the raw reply ('Sent to the AI' panel).", "agents/runtime.ts (runAgent live hook, record), ai_calls table"],
  ["One step at a time", "A step that is already running for a research run cannot be started a second time (second tab, double click).", "services/research.ts (exclusive)"],
];

let md = `# Knowlix agent personas and guardrails

> Generated from the code by \`npm run docs:personas\`. Do not edit by hand: change the prompt files in \`src/server/agents/prompts/\` and regenerate.

Knowlix uses **five AI roles** (plus a repair mode of the Writer), each with one narrow job, a versioned persona prompt, a strict JSON output schema and a low temperature. Two parts are **plain code, never AI**: the **Verifier** (Lock 1: is a reference real?) and the **Orchestrator** (runs the steps in order and enforces the three human checkpoints).

| Role | Version | Temperature | Max tokens | Job |
|---|---|---|---|---|
${agents.map((a) => `| ${a.name} | \`${a.version}\` | ${a.temperature} | ${a.maxTokens} | ${a.persona.split("\n")[0].replace(/^ROLE:\s*/, "")} |`).join("\n")}

## 1. The constitution (every agent receives this first)

\`\`\`text
${CONSTITUTION}
\`\`\`

## 2. Personas

`;

for (const a of agents) {
  md += `### ${a.name} · \`${a.version}\` · temperature ${a.temperature}

\`\`\`text
${a.persona}
\`\`\`

**Output schema (validated by code):**

\`\`\`json
${a.shape}
\`\`\`

`;
}

md += `## 3. Guardrails around the agents

| Guardrail | What it does | Where |
|---|---|---|
${GUARDRAILS.map(([g, d, w]) => `| **${g}** | ${d} | \`src/server/${w.split(", ")[0].split(" (")[0]}\`${w.includes("(") ? ` ${w.slice(w.indexOf("("))}` : ""} |`).join("\n")}

## 4. How to see them working

- **Live in the app:** start a research question. The **agent room** shows each agent working: who it is, whether it is an AI model, plain code or the no-AI stand-in, what it was sent and its answer as it is typed.
- **Afterwards in the app:** open *How it works* to read every persona and the constitution. On any research run, press **Sent to the AI** to see each call's system prompt, the exact data sent and the raw reply.
- **In tests:** \`tests/unit/lock2.test.ts\`, \`tests/unit/explain.test.ts\` and \`tests/unit/pipeline.test.ts\` prove the injection detection, redaction, ID whitelist, quote, number, copy and label rules, and run the whole pipeline with a stand-in model.
- **Measured:** \`npm run bench:claims\` runs 20 claim/passage pairs with planted errors through the code checks and the Judge.
- **Changing a persona:** edit its file in \`src/server/agents/prompts/\`, bump \`version\` (it is stored with every call), then run \`npm run docs:personas\`.
`;

const out = path.join(__dirname, "..", "docs", "AGENT_PERSONAS.md");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md);
console.log(`Wrote ${path.relative(process.cwd(), out)} (${agents.length} personas, ${GUARDRAILS.length} guardrails)`);
