import "server-only";
import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations.generated";
import { env } from "../env";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

interface DbState {
  db: Db;
  driver: "postgres" | "pglite";
  ready: Promise<void>;
}

const globalForDb = globalThis as unknown as { __knowlixDb?: DbState };

const MIGRATION_LOCK = 727_274_001;

async function createPostgres(): Promise<DbState> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const url = env.databaseUrl!;
  const isLocal = /@(localhost|127\.0\.0\.1|db|postgres)(:|\/)/.test(url);
  const pool = new Pool({
    connectionString: url,
    max: env.isVercel ? 3 : 10,
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false },
  });
  const db = drizzle(pool, { schema }) as unknown as Db;
  const ready = (async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
      await client.query(
        "CREATE TABLE IF NOT EXISTS knowlix_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const { rows } = await client.query<{ tag: string }>("SELECT tag FROM knowlix_migrations");
      const applied = new Set(rows.map((r) => r.tag));
      for (const m of MIGRATIONS) {
        if (applied.has(m.tag)) continue;
        await client.query("BEGIN");
        try {
          for (const stmt of m.statements) await client.query(stmt);
          await client.query("INSERT INTO knowlix_migrations (tag) VALUES ($1)", [m.tag]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
      client.release();
    }
  })();
  return { db, driver: "postgres", ready };
}

async function createPglite(): Promise<DbState> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  // PGLITE_DIR="memory://" gives tests a throwaway in-memory database.
  const dataDir = process.env.PGLITE_DIR ?? (env.isVercel ? "/tmp/knowlix-pglite" : path.join(process.cwd(), ".data", "pglite"));
  if (!dataDir.startsWith("memory://")) fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema }) as unknown as Db;
  const ready = (async () => {
    await client.waitReady;
    await client.exec(
      "CREATE TABLE IF NOT EXISTS knowlix_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const { rows } = await client.query<{ tag: string }>("SELECT tag FROM knowlix_migrations");
    const applied = new Set(rows.map((r) => r.tag));
    for (const m of MIGRATIONS) {
      if (applied.has(m.tag)) continue;
      await client.transaction(async (tx) => {
        for (const stmt of m.statements) await tx.exec(stmt);
        await tx.query("INSERT INTO knowlix_migrations (tag) VALUES ($1)", [m.tag]);
      });
    }
  })();
  return { db, driver: "pglite", ready };
}

function init(): Promise<DbState> {
  return env.databaseUrl ? createPostgres() : createPglite();
}

let pending: Promise<DbState> | null = null;

/** Returns the ready database (migrations applied). Safe to call from every request. */
export async function getDb(): Promise<Db> {
  if (globalForDb.__knowlixDb) {
    await globalForDb.__knowlixDb.ready;
    return globalForDb.__knowlixDb.db;
  }
  pending ??= init().then((state) => {
    globalForDb.__knowlixDb = state;
    return state;
  });
  const state = await pending;
  await state.ready;
  return state.db;
}

export function dbDriver(): "postgres" | "pglite" {
  return env.databaseUrl ? "postgres" : "pglite";
}

export async function pingDb(): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t = Date.now();
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return { ok: true, ms: Date.now() - t };
  } catch (err) {
    return { ok: false, ms: Date.now() - t, error: err instanceof Error ? err.message : String(err) };
  }
}
