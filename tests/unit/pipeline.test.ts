import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// The deterministic mock AI + an in-memory Postgres: the full Lock 2 pipeline, offline.
process.env.PGLITE_DIR = "memory://";
process.env.MOCK_AI = "1";
delete process.env.DATABASE_URL;

const { getDb } = await import("@/server/db/client");
const { workspaces, researchRuns, aiCalls } = await import("@/server/db/schema");
const { runWrite, getRun } = await import("@/server/services/research");
import type { SourceCandidate } from "@/shared/types";

const WS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function source(id: string, title: string, abstract: string): SourceCandidate {
  return {
    id,
    csl: { id, type: "article-journal", title, author: [{ family: "Doe" }], issued: { "date-parts": [[2020]] }, DOI: `10.1234/${id.toLowerCase()}`, abstract },
    foundBy: [{ adapter: "crossref", queryId: "Q1" }],
    relevance: "high",
    verification: null,
    accepted: true,
    abstractAvailable: true,
  };
}

describe("research pipeline with agents (mock AI)", () => {
  it("writes, checks, labels and records every AI call", async () => {
    const db = await getDb();
    await db.insert(workspaces).values({ id: WS }).onConflictDoNothing();
    const [run] = await db
      .insert(researchRuns)
      .values({
        workspaceId: WS,
        question: "Does retrieval practice improve long-term retention?",
        state: "writing",
        mode: "ai",
        sources: [
          source("S1", "Testing effect", "Retrieval practice improved recall after one week compared with restudy. The effect held for prose passages."),
          source("S2", "Classroom retrieval", "In classrooms, quizzing improved exam scores by a moderate amount. Feedback strengthened the benefit."),
        ],
      })
      .returning();

    const events: unknown[] = [];
    await runWrite({ db, workspaceId: WS }, run.id, (e) => events.push(e));

    const dto = await getRun({ db, workspaceId: WS }, run.id);
    expect(dto.state).toBe("summary_review");
    const draft = dto.draft!;
    expect(draft.mode).toBe("ai");
    // Every sourced sentence cites only passages that exist.
    const ids = new Set(draft.passages.map((p) => p.id));
    for (const s of draft.sentences) for (const c of s.citations) expect(ids.has(c)).toBe(true);
    // The Judge's evidence was re-checked by code, so supported sentences are Verified.
    expect(draft.sentences.some((s) => s.label === "verified")).toBe(true);
    expect(draft.sentences.some((s) => s.label === "reasoning")).toBe(true);
    expect(draft.gaps.length).toBeGreaterThan(0);
    // Critic flags are present (rule-based + AI).
    expect(draft.critic.length).toBeGreaterThan(0);
    // Every agent call was recorded with what was sent.
    const calls = await db.select().from(aiCalls).where(eq(aiCalls.runId, run.id));
    expect(calls.map((c) => c.agent).sort()).toEqual(expect.arrayContaining(["writer", "judge", "critic"]));
    expect(calls.every((c) => c.sent.system.includes("NON-NEGOTIABLE RULES"))).toBe(true);
    expect(events.some((e) => (e as { type: string }).type === "done")).toBe(true);
  }, 60_000);
});
