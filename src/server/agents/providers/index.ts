import "server-only";
import { env } from "../../env";
import { mockChat } from "./mock";

/**
 * Provider router. Every AI call goes through chat(): it tries the configured
 * providers in order (AI_PROVIDERS) and falls back on rate limits, outages and
 * timeouts. Keys stay on the server; the browser never sees them.
 *
 * Answers are streamed when the caller passes onToken, so the student can
 * watch each agent type its answer. A provider that refuses to stream is
 * called again the ordinary way.
 */

export interface ChatRequest {
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  /** Agent id, used by the mock provider and for logging. */
  agent: string;
  /** JSON Schema of the expected answer. Providers that can constrain output to a schema use it. */
  jsonSchema?: unknown;
  /** Called with each piece of the answer as it arrives. */
  onToken?: (chunk: string, meta: { provider: string; model: string }) => void;
}

export interface ChatResponse {
  text: string;
  provider: string;
  model: string;
  latencyMs: number;
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number | null,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
  /** How long the provider asked us to wait before trying again (rate limits), when it said. */
  retryAfterMs: number | null = null;
}

type ProviderId = "groq" | "gemini" | "ollama" | "mock";
type Emit = ((chunk: string) => void) | undefined;

interface Provider {
  id: ProviderId;
  label: string;
  models: string[];
  configured: boolean;
  /** True when the model runs on this machine, so nothing leaves it. */
  local?: boolean;
  call: (req: ChatRequest, model: string, emit: Emit) => Promise<string>;
}

/** The wait a provider asked for: its retry-after header (seconds), or "try again in 2m59.5s" in its message. */
export function waitHint(detail: string, header: string | null): number | null {
  if (header && /^\s*[\d.]+\s*$/.test(header)) return Math.round(Number(header) * 1000);
  const said = detail.match(/(?:try again|retry) in\s+((?:[\d.]+(?:ms|h|m|s))+)/i)?.[1];
  if (!said) return null;
  const unit: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  let total = 0;
  for (const [, n, u] of said.matchAll(/([\d.]+)(ms|h|m|s)/g)) total += Number(n) * unit[u];
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

function fail(provider: string, status: number, text: string, retryAfter: string | null = null): ProviderError {
  let detail = text.slice(0, 600);
  try {
    const j = JSON.parse(text);
    detail = j.error?.message ?? j.error ?? detail;
  } catch {
    /* keep raw */
  }
  // 413 is "this one request is larger than the per-minute allowance": another model or provider may take it.
  const retryable = status === 429 || status === 413 || status >= 500 || status === 404 || status === 400;
  const err = new ProviderError(provider, status, `${provider} ${status}: ${String(detail).slice(0, 200)}`, retryable);
  if (status === 429) err.retryAfterMs = waitHint(String(detail), retryAfter);
  return err;
}

/**
 * POSTs JSON and hands back the open response. The clock is an idle timer:
 * it restarts with every piece that arrives, so a slow local model that is
 * still typing is never cut off.
 */
async function open(url: string, body: unknown, headers: Record<string, string>, provider: string, idleMs: number) {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), idleMs);
  };
  touch();
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal, cache: "no-store" });
  } catch {
    clearTimeout(timer);
    throw new ProviderError(provider, null, ctrl.signal.aborted ? `${provider} timed out` : `${provider} could not be reached`, true);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    clearTimeout(timer);
    throw fail(provider, res.status, text, res.headers.get("retry-after"));
  }
  return { res, touch, done: () => clearTimeout(timer), aborted: () => ctrl.signal.aborted };
}

async function postJson(url: string, body: unknown, headers: Record<string, string>, provider: string, timeoutMs: number) {
  const o = await open(url, body, headers, provider, timeoutMs);
  try {
    return JSON.parse(await o.res.text());
  } catch {
    throw new ProviderError(provider, null, o.aborted() ? `${provider} timed out` : `${provider} sent an unreadable answer`, true);
  } finally {
    o.done();
  }
}

/** Reads a streamed body line by line (SSE "data:" lines or NDJSON), calling onLine with each JSON payload. */
async function readLines(url: string, body: unknown, headers: Record<string, string>, provider: string, idleMs: number, onLine: (json: unknown) => void) {
  const o = await open(url, body, headers, provider, idleMs);
  if (!o.res.body) {
    o.done();
    throw new ProviderError(provider, null, `${provider} returned no stream`, true);
  }
  const reader = o.res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const take = (raw: string) => {
    const line = raw.trim();
    if (!line || line.startsWith(":") || line.startsWith("event:")) return;
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!payload || payload === "[DONE]") return;
    try {
      onLine(JSON.parse(payload));
    } catch {
      /* a partial or non-JSON line: ignore */
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      o.touch();
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        take(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    take(buffer);
  } catch {
    throw new ProviderError(provider, null, o.aborted() ? `${provider} stopped answering` : `${provider} dropped the connection`, true);
  } finally {
    o.done();
  }
}

/** Providers (or one provider's model) that refused to stream once are called the ordinary way from then on. */
const noStream = new Set<string>();
/** Models that rejected the thinking settings below are asked without them from then on. */
const plainOnly = new Set<string>();

/**
 * Groq's current models think before they answer. These agents give short, structured answers,
 * so the thinking is kept brief and out of the reply, with a little room left for it.
 */
function thinking(provider: string, model: string): { settings: Record<string, unknown>; headroom: number } | null {
  if (provider !== "groq") return null;
  if (/gpt-oss/i.test(model)) return { settings: { reasoning_effort: "low", include_reasoning: false }, headroom: 400 };
  if (/qwen/i.test(model)) return { settings: { reasoning_effort: "none", reasoning_format: "hidden" }, headroom: 0 };
  return null;
}

/* OpenAI-compatible chat completions (Groq). */
async function openAiCompatible(base: string, key: string | undefined, provider: string, req: ChatRequest, model: string, timeoutMs: number, emit: Emit) {
  const common = {
    model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    temperature: req.temperature,
    response_format: { type: "json_object" },
  };
  const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {};
  const id = `${provider}:${model}`;

  const whole = async (payload: Record<string, unknown>) => {
    const data = await postJson(`${base}/chat/completions`, payload, headers, provider, timeoutMs);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new ProviderError(provider, null, `${provider} returned an empty answer`, true);
    return content;
  };

  const ask = async (payload: Record<string, unknown>) => {
    if (emit && !noStream.has(id)) {
      let text = "";
      let refused = false;
      try {
        await readLines(`${base}/chat/completions`, { ...payload, stream: true }, headers, provider, timeoutMs, (j) => {
          const piece = (j as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
          if (typeof piece === "string" && piece) {
            text += piece;
            emit(piece);
          }
        });
      } catch (err) {
        if (err instanceof ProviderError && err.status === 400 && !text) refused = true;
        else throw err;
      }
      if (text.trim()) return text;
      if (!refused) throw new ProviderError(provider, null, `${provider} returned an empty answer`, true);
      // Streaming may be what was refused. Ask the ordinary way, and remember only if that works.
      const content = await whole(payload);
      noStream.add(id);
      emit(content);
      return content;
    }
    const content = await whole(payload);
    emit?.(content);
    return content;
  };

  const t = plainOnly.has(id) ? null : thinking(provider, model);
  if (t) {
    try {
      return await ask({ ...common, max_completion_tokens: req.maxTokens + t.headroom, ...t.settings });
    } catch (err) {
      // Only a complaint about the request itself is worth a second try without the settings.
      if (!(err instanceof ProviderError) || err.status !== 400 || /decommission|does not exist|not found|json/i.test(err.message)) throw err;
      plainOnly.add(id);
    }
  }
  return ask({ ...common, max_tokens: req.maxTokens });
}

/* Ollama's own API: lets us pin the answer to the JSON schema and keep the model warm. */
async function ollama(req: ChatRequest, model: string, emit: Emit) {
  const base = env.ollamaUrl!.replace(/\/$/, "");
  const body = (format: unknown) => ({
    model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    stream: true,
    format,
    keep_alive: "30m",
    options: { temperature: req.temperature, num_predict: req.maxTokens, num_ctx: env.ollamaContext },
  });
  const run = async (format: unknown) => {
    let text = "";
    await readLines(`${base}/api/chat`, body(format), {}, "ollama", 600_000, (j) => {
      const piece = (j as { message?: { content?: string } }).message?.content;
      if (typeof piece === "string" && piece) {
        text += piece;
        emit?.(piece);
      }
    });
    return text;
  };
  let text: string;
  try {
    text = await run(req.jsonSchema ?? "json");
  } catch (err) {
    // An older Ollama, or a schema it cannot turn into a grammar: plain JSON mode still works.
    if (err instanceof ProviderError && err.status === 400 && req.jsonSchema) text = await run("json");
    else throw err;
  }
  if (!text.trim()) throw new ProviderError("ollama", null, "ollama returned an empty answer", true);
  return text;
}

async function gemini(req: ChatRequest, model: string, emit: Emit) {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`;
  const headers = { "x-goog-api-key": env.geminiKey! };
  const body = (thinkingOff: boolean) => ({
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    generationConfig: {
      temperature: req.temperature,
      maxOutputTokens: req.maxTokens,
      responseMimeType: "application/json",
      // Hidden "thinking" would eat the output budget and cut the JSON short.
      ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  const textOf = (j: unknown) =>
    ((j as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const run = async (thinkingOff: boolean) => {
    if (emit && !noStream.has("gemini")) {
      let text = "";
      await readLines(`${base}:streamGenerateContent?alt=sse`, body(thinkingOff), headers, "gemini", 45_000, (j) => {
        const piece = textOf(j);
        if (piece) {
          text += piece;
          emit(piece);
        }
      });
      return text;
    }
    const data = await postJson(`${base}:generateContent`, body(thinkingOff), headers, "gemini", 45_000);
    const text = textOf(data);
    if (text) emit?.(text);
    return text;
  };
  const wantsThinkingOff = /2\.5-flash/.test(model);
  let content: string;
  try {
    content = await run(wantsThinkingOff);
  } catch (err) {
    if (err instanceof ProviderError && err.status === 400 && wantsThinkingOff) content = await run(false);
    else throw err;
  }
  if (!content.trim()) throw new ProviderError("gemini", null, "gemini returned no text", true);
  return content;
}

function providers(): Provider[] {
  const all: Record<Exclude<ProviderId, "mock">, Provider> = {
    groq: {
      id: "groq",
      label: "Groq",
      models: [...new Set([env.groqModel, "openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"])],
      configured: Boolean(env.groqKey),
      call: (req, model, emit) => openAiCompatible("https://api.groq.com/openai/v1", env.groqKey, "groq", req, model, 30_000, emit),
    },
    gemini: {
      id: "gemini",
      label: "Google Gemini",
      models: [...new Set([env.geminiModel, "gemini-2.5-flash", "gemini-flash-latest"])],
      configured: Boolean(env.geminiKey),
      call: gemini,
    },
    ollama: {
      id: "ollama",
      label: "Ollama (on this computer)",
      models: [env.ollamaModel],
      configured: Boolean(env.ollamaUrl),
      local: true,
      call: ollama,
    },
  };
  if (env.mockAi) {
    return [
      {
        id: "mock",
        label: "Mock AI (tests)",
        models: ["mock-1"],
        configured: true,
        call: async (req, _model, emit) => {
          const text = await mockChat(req);
          emit?.(text);
          return text;
        },
      },
    ];
  }
  return env.aiProviders.filter((p): p is Exclude<ProviderId, "mock"> => p in all).map((p) => all[p]);
}

export function aiAvailable(): boolean {
  return providers().some((p) => p.configured);
}

/** True when the first provider that will be tried runs on this machine (slow, but private). */
export function aiIsLocal(): boolean {
  return Boolean(providers().find((p) => p.configured)?.local);
}

/**
 * True when the first provider can only take a small reading list per call: a model on this computer
 * (slow), or Groq, whose free plan allows 8,000 tokens a minute per model.
 */
export function aiIsCompact(): boolean {
  const p = providers().find((x) => x.configured);
  return Boolean(p && (p.local || p.id === "groq"));
}

/** The provider and model that will be tried first, for showing "who is answering" before the first word arrives. */
export function primaryModel(): { provider: string; model: string } | null {
  const p = providers().find((x) => x.configured);
  return p ? { provider: p.id, model: p.models[0] } : null;
}

const deadModels = new Set<string>();

/** The longest a step will pause for a per-minute allowance to refill before moving on. */
const MAX_WAIT_MS = 45_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls the first working provider and model, and falls back on failures that another one may not have.
 * Free allowances are counted per model, so a model that says "slow down" is followed by the next model
 * of the same provider; if every cloud model says so, one short wait is tried before a model on this computer.
 */
export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const list = providers().filter((p) => p.configured);
  if (!list.length) throw new ProviderError("none", null, "No AI provider is configured.", false);
  const errors: string[] = [];
  const limited: { p: Provider; model: string; waitMs: number }[] = [];

  const attempt = async (p: Provider, model: string): Promise<ChatResponse> => {
    const t = Date.now();
    const emit: Emit = req.onToken ? (chunk) => req.onToken!(chunk, { provider: p.id, model }) : undefined;
    const text = await p.call(req, model, emit);
    return { text, provider: p.id, model, latencyMs: Date.now() - t };
  };

  let waited = false;
  const afterWaiting = async (): Promise<ChatResponse | null> => {
    if (waited || !limited.length) return null;
    const next = limited.reduce((a, b) => (b.waitMs < a.waitMs ? b : a));
    if (next.waitMs > MAX_WAIT_MS) return null; // a daily allowance: waiting will not help
    waited = true;
    await pause(next.waitMs + 500);
    try {
      return await attempt(next.p, next.model);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  for (const p of list) {
    if (p.local) {
      const r = await afterWaiting();
      if (r) return r;
    }
    for (const model of p.models) {
      if (deadModels.has(`${p.id}:${model}`)) continue;
      try {
        return await attempt(p, model);
      } catch (err) {
        const e = err instanceof ProviderError ? err : new ProviderError(p.id, null, String(err), true);
        errors.push(e.message);
        // A decommissioned/unknown model: skip it for the rest of this process.
        if (e.status === 404 || (e.status === 400 && /model/i.test(e.message))) {
          deadModels.add(`${p.id}:${model}`);
          continue;
        }
        if (e.status === 401 || e.status === 403) break; // bad key → next provider
        if (!e.retryable) throw e;
        if (e.status === 429) {
          if (e.retryAfterMs !== null) limited.push({ p, model, waitMs: e.retryAfterMs });
          continue; // each model has its own allowance
        }
        // Too large for this model's allowance, a refused request, or nothing usable came back: try the next model.
        if (e.status === 413 || e.status === 400 || (e.status === null && /empty answer|unreadable/.test(e.message))) continue;
        break; // outage or timeout → next provider
      }
    }
  }
  const r = await afterWaiting();
  if (r) return r;
  throw new ProviderError("all", null, `Every AI provider failed: ${errors.join(" · ").slice(0, 400)}`, false);
}

export function providerSummary() {
  return providers().map((p) => ({ id: p.id, label: p.label, model: p.models[0], configured: p.configured, local: Boolean(p.local) }));
}
