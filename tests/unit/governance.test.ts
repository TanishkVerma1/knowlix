import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const { getDb } = await import("@/server/db/client");
const { logActivity, verifyChain } = await import("@/server/audit/activity");
const { workspaces } = await import("@/server/db/schema");

const WS = "11111111-2222-4333-8444-555555555555";

describe("activity log governance (real Postgres via PGlite)", () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.insert(workspaces).values({ id: WS }).onConflictDoNothing();
    await logActivity(db, WS, { actor: "student", action: "test.one", summary: "First entry" });
    await logActivity(db, WS, { actor: "verifier", action: "test.two", summary: "Second entry", details: { n: 2 } });
  }, 60_000);

  it("chains every entry to the previous one", async () => {
    const chain = await verifyChain(await getDb(), WS);
    expect(chain.intact).toBe(true);
    expect(chain.count).toBe(2);
  });

  it("refuses UPDATE at the database level", async () => {
    const db = await getDb();
    await expect(db.execute(sql`update activity_log set summary = 'rewritten' where workspace_id = ${WS}`)).rejects.toThrow();
  });

  it("refuses DELETE unless the student is erasing their own data", async () => {
    const db = await getDb();
    await expect(db.execute(sql`delete from activity_log where workspace_id = ${WS}`)).rejects.toThrow();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('knowlix.erasing', 'on', true)`);
      await tx.delete(workspaces).where(sql`id = ${WS}`);
    });
    const rows = await db.execute(sql`select count(*)::int as n from activity_log where workspace_id = ${WS}`);
    expect((rows as unknown as { rows: { n: number }[] }).rows[0].n).toBe(0);
  });
});
