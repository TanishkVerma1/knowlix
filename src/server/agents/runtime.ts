import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db } from "../db/client";
import { aiCalls } from "../db/schema";
import { chat, primaryModel, ProviderError } from "./providers";
import { systemPrompt, type AgentDef } from "./prompts/constitution";
import { extractJson } from "./guardrails";
import type { AgentStreamEvent } from "@/shared/types";

export interface AgentCtx {
  db: Db;
  workspaceId: string;
  runId: string | null;
  /** Live view: receives the start, every typed piece and the end of each AI call. */
  live?: (e: AgentStreamEvent) => void;
}

export interface AgentResult<O> {
  output: O;
  provider: string;
  model: string;
  latencyMs: number;
  promptVersion: string;
  attempts: number;
}

export class AgentError extends Error {
  constructor(
    public agent: string,
    message: string,
    public kind: "provider" | "invalid-output",
  ) {
    super(message);
  }
}

const MAX_LOG = 24_000;

function issuesToText(err: unknown): string {
  const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  if (!issues) return String(err);
  return issues
    .slice(0, 6)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

const schemaCache = new WeakMap<object, unknown>();

/** The persona's output schema as JSON Schema, for providers that can hold the model to it. */
function jsonSchemaOf(schema: z.ZodType): unknown {
  if (schemaCache.has(schema)) return schemaCache.get(schema);
  let out: unknown;
  try {
    out = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  } catch {
    out = undefined;
  }
  schemaCache.set(schema, out);
  return out;
}

/**
 * Runs one agent call: constitution + persona as system, task + data as user.
 * Output is parsed and schema-validated; one retry tells the model exactly
 * what was wrong. Every attempt is stored (what was sent, what came back)
 * and, when a live listener is attached, streamed as it is typed.
 */
export async function runAgent<I, O>(def: AgentDef<I, O>, input: I, ctx: AgentCtx): Promise<AgentResult<O>> {
  const system = systemPrompt(def);
  const task = def.task(input);
  const baseUser = `${task}\n\n<input_json>${JSON.stringify(input)}</input_json>`;
  let user = baseUser;
  let lastError = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    const callId = randomUUID();
    const startedAt = Date.now();
    ctx.live?.({
      type: "agent-start",
      call: { callId, agent: def.id, name: def.name, promptVersion: def.version, task, sentChars: system.length + user.length, attempt, provider: primaryModel()?.provider ?? null, model: primaryModel()?.model ?? null, text: "", status: "working", latencyMs: null, startedAt: new Date(startedAt).toISOString() },
    });

    // Pieces are batched so a fast model does not flood the stream with one event per token.
    let pending = "";
    let last = 0;
    let source = "";
    const flush = (meta?: { provider: string; model: string }, reset = false) => {
      if (!pending && !reset) return;
      ctx.live?.({ type: "agent-token", callId, text: pending, provider: meta?.provider, model: meta?.model, reset });
      pending = "";
      last = Date.now();
    };
    const onToken = ctx.live
      ? (chunk: string, meta: { provider: string; model: string }) => {
          const key = `${meta.provider}:${meta.model}`;
          if (source && source !== key) {
            pending = "";
            flush(meta, true); // a fallback provider started over
          }
          source = key;
          pending += chunk;
          if (Date.now() - last > 70) flush(meta);
        }
      : undefined;

    let res;
    try {
      res = await chat({ system, user, temperature: def.temperature, maxTokens: def.maxTokens, agent: def.id, jsonSchema: jsonSchemaOf(def.schema), onToken });
    } catch (err) {
      const msg = err instanceof ProviderError ? err.message : String(err);
      await record(ctx, def, system, user, null, { provider: "none", model: "none", latencyMs: 0 }, false, msg);
      ctx.live?.({ type: "agent-end", callId, ok: false, latencyMs: Date.now() - startedAt, provider: "none", model: "none", error: msg });
      throw new AgentError(def.id, msg, "provider");
    }
    flush({ provider: res.provider, model: res.model });

    let parsed: O | null = null;
    try {
      const json = extractJson(res.text);
      const v = def.schema.safeParse(json);
      if (v.success) parsed = v.data;
      else lastError = issuesToText(v.error);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    await record(ctx, def, system, user, res.text, res, parsed !== null, parsed ? null : `Invalid output: ${lastError}`);
    ctx.live?.({
      type: "agent-end",
      callId,
      ok: parsed !== null,
      latencyMs: res.latencyMs,
      provider: res.provider,
      model: res.model,
      error: parsed ? null : `The answer did not match the required format (${lastError}). ${attempt === 1 ? "Asking once more." : "Rejected."}`,
      text: res.text,
    });
    if (parsed !== null) {
      return { output: parsed, provider: res.provider, model: res.model, latencyMs: res.latencyMs, promptVersion: def.version, attempts: attempt };
    }
    user = `${baseUser}\n\nYour previous reply was rejected by the validator: ${lastError}. Reply again with ONE JSON object that matches the schema exactly.`;
  }
  throw new AgentError(def.id, `The ${def.name} returned output that failed validation twice (${lastError}).`, "invalid-output");
}

async function record<I, O>(
  ctx: AgentCtx,
  def: AgentDef<I, O>,
  system: string,
  user: string,
  received: string | null,
  res: { provider: string; model: string; latencyMs: number },
  ok: boolean,
  error: string | null,
) {
  try {
    await ctx.db.insert(aiCalls).values({
      workspaceId: ctx.workspaceId,
      runId: ctx.runId,
      agent: def.id,
      promptVersion: def.version,
      provider: res.provider,
      model: res.model,
      temperature: Math.round(def.temperature * 100),
      sent: { system: system.slice(0, MAX_LOG), user: user.slice(0, MAX_LOG) },
      received: received?.slice(0, MAX_LOG) ?? null,
      latencyMs: res.latencyMs,
      ok,
      error,
    });
  } catch (err) {
    console.error("[knowlix] could not record AI call", err);
  }
}
