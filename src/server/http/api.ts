import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";

/** An error whose message is safe and useful to show the student. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

/**
 * Wraps a route handler: typed errors become clean JSON, unexpected ones are
 * logged and returned as a calm, generic message (never a stack trace).
 */
export function handle<C>(fn: (req: NextRequest, ctx: C) => Promise<Response | unknown>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      // A ceiling per network address on anything that changes data, so dropping the cookie does not dodge the limits.
      if (req.method !== "GET" && req.method !== "HEAD") rateLimit(`addr:${clientAddress(req)}`, 300);
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true });
    } catch (err) {
      if (err instanceof ApiError) {
        return Response.json(errorBody(err.code, err.message, err.details), { status: err.status });
      }
      if (err instanceof z.ZodError) {
        return Response.json(errorBody("invalid-input", friendlyIssue(err.issues[0])), { status: 400 });
      }
      const db = databaseError(err);
      if (db) return Response.json(errorBody(db.code, db.message), { status: db.status });
      console.error("[knowlix] unhandled API error", err);
      return Response.json(
        errorBody("internal", "Something went wrong on our side. Your data is safe; please try again."),
        { status: 500 },
      );
    }
  };
}

const FIELD_NAMES: Record<string, string> = {
  text: "The pasted text",
  question: "Your question",
  input: "The reference",
  reason: "Your reason",
  note: "Your note",
  notes: "Your notes",
  tags: "The tags",
  name: "The name",
  title: "The title",
  body: "The draft",
  minYear: "The earliest year",
  maxSources: "The number of sources",
  maxSummaryWords: "The summary length",
  key: "The workspace key",
  queries: "The list of searches",
};

/** Turns a validator complaint into a sentence a student can act on. */
function friendlyIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "Something in that request was not valid.";
  const last = [...issue.path].reverse().find((x) => typeof x === "string") as string | undefined;
  const what = (last && FIELD_NAMES[last]) ?? (last ? `“${last}”` : "That");
  const i = issue as unknown as { code: string; origin?: string; maximum?: number | bigint; minimum?: number | bigint; message: string };
  const n = (v: number | bigint | undefined) => Number(v ?? 0).toLocaleString("en-GB");
  if (i.code === "too_big") return i.origin === "string" ? `${what} is too long: the limit is ${n(i.maximum)} characters.` : i.origin === "array" ? `${what} has too many items: the limit is ${n(i.maximum)}.` : `${what} is too high: the most allowed is ${Number(i.maximum ?? 0)}.`;
  if (i.code === "too_small") return i.origin === "string" ? (Number(i.minimum) <= 1 ? `${what} is empty.` : `${what} is too short: write at least ${n(i.minimum)} characters.`) : i.origin === "array" ? `${what} needs at least ${n(i.minimum)}.` : `${what} is too low: the least allowed is ${Number(i.minimum ?? 0)}.`;
  if (i.code === "invalid_type" || i.code === "invalid_value" || i.code === "invalid_format") return /^[A-Z].*[.?!]$/.test(i.message) ? i.message : `${what} is missing or not in the expected form.`;
  return /^[A-Z].*[.?!]$/.test(i.message) ? i.message : `${what} is not valid.`;
}

/** Database complaints that are really "that does not exist" or "that text cannot be stored". */
function databaseError(err: unknown): { status: number; code: string; message: string } | null {
  const codeOf = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "");
  const code = codeOf(err) || codeOf((err as { cause?: unknown })?.cause);
  const text = `${err instanceof Error ? err.message : ""} ${(err as { cause?: { message?: string } })?.cause?.message ?? ""}`;
  if (code === "22P02" || /invalid input syntax for type uuid/i.test(text)) return { status: 404, code: "not-found", message: "That does not exist in your workspace." };
  if (code === "23503") return { status: 404, code: "not-found", message: "Something this refers to does not exist in your workspace." };
  if (code === "22021" || /invalid byte sequence|null character/i.test(text)) return { status: 400, code: "invalid-input", message: "That text contains characters that cannot be stored. Remove any unusual control characters and try again." };
  return null;
}

/** The caller's network address, for limits that must hold even without a workspace cookie. */
export function clientAddress(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    // Postgres cannot store the NUL character; drop it rather than fail on it.
    body = JSON.parse((await req.text()).replace(/\\u0000|\u0000/g, ""));
  } catch {
    throw new ApiError(400, "invalid-json", "The request body was not valid JSON.");
  }
  return schema.parse(body);
}

/** Newline-delimited JSON stream: lets the UI show each result the moment it lands. */
export function ndjsonStream(run: (send: (event: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        await run(send);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "The check stopped unexpectedly. Results so far are saved.";
        if (!(err instanceof ApiError)) console.error("[knowlix] stream error", err);
        send({ type: "error", message });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/* ───────────── Simple in-memory rate limiter (per workspace, per bucket) ───────────── */

const buckets = new Map<string, { tokens: number; updated: number }>();

export function rateLimit(key: string, perMinute: number) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, updated: now };
  const refill = ((now - b.updated) / 60_000) * perMinute;
  b.tokens = Math.min(perMinute, b.tokens + refill);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    throw new ApiError(429, "rate-limited", "You're going a little fast. Wait a few seconds and try again.");
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 5000) buckets.clear();
}
