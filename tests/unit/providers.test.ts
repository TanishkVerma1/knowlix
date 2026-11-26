import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cloud AI path, tested against a pretend Groq: what the app does when a
 * free allowance says "slow down", when one request is too large, and when a
 * model has been switched off.
 */

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
type Seen = { url: string; model: string; body: Record<string, unknown> };

function pretend(answer: (seen: Seen, n: number) => Reply) {
  const calls: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const seen = { url: String(url), model: String(body.model), body };
      calls.push(seen);
      const r = answer(seen, calls.length);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
    }),
  );
  return calls;
}

const ok = (text: string): Reply => ({ status: 200, body: { choices: [{ message: { content: text } }] } });
const slowDown = (seconds: string): Reply => ({
  status: 429,
  headers: { "retry-after": seconds },
  body: { error: { message: `Rate limit reached on tokens per minute (TPM): Limit 8000, Used 7900, Requested 2100. Please try again in ${seconds}s.` } },
});

const request = { system: "s", user: "u", temperature: 0, maxTokens: 900, agent: "planner" };

async function load(extra: Record<string, string> = {}) {
  vi.resetModules();
  for (const name of ["GEMINI_API_KEY", "OLLAMA_BASE_URL", "MOCK_AI", "GROQ_MODEL", "AI_PROVIDERS"]) vi.stubEnv(name, "");
  vi.stubEnv("GROQ_API_KEY", "test-key");
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
  return import("@/server/agents/providers");
}

beforeEach(() => vi.useRealTimers());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("cloud AI on a free allowance", () => {
  it("asks a model that is on Groq's free plan today, with brief thinking kept out of the answer", async () => {
    const { chat, primaryModel } = await load();
    const calls = pretend(() => ok('{"a":1}'));
    const res = await chat(request);
    expect(primaryModel()).toEqual({ provider: "groq", model: "openai/gpt-oss-120b" });
    expect(res).toMatchObject({ text: '{"a":1}', provider: "groq", model: "openai/gpt-oss-120b" });
    expect(calls[0].body).toMatchObject({ reasoning_effort: "low", include_reasoning: false, max_completion_tokens: 1300, response_format: { type: "json_object" } });
  });

  it("moves to the next model when one says slow down: each model has its own allowance", async () => {
    const { chat } = await load();
    const calls = pretend((seen) => (seen.model === "openai/gpt-oss-120b" ? slowDown("12") : ok('{"a":2}')));
    const res = await chat(request);
    expect(res.model).toBe("openai/gpt-oss-20b");
    expect(calls.map((c) => c.model)).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  });

  it("moves on when a single request is larger than the per-minute allowance", async () => {
    const { chat } = await load();
    pretend((seen) => (seen.model.startsWith("openai/") ? { status: 413, body: { error: { message: "Request too large for model: Limit 8000, Requested 9100" } } } : ok('{"a":3}')));
    const res = await chat(request);
    expect(res.model).toBe("qwen/qwen3.8-27b");
  });

  it("waits out a short per-minute limit once, instead of failing the step", async () => {
    const { chat } = await load();
    const calls = pretend((_seen, n) => (n <= 3 ? slowDown("0.05") : ok('{"a":4}')));
    const res = await chat(request);
    expect(res.text).toBe('{"a":4}');
    expect(calls).toHaveLength(4);
  });

  it("does not sit waiting for a daily allowance", async () => {
    const { chat } = await load();
    const calls = pretend(() => slowDown("5400"));
    await expect(chat(request)).rejects.toThrow(/Every AI provider failed/);
    expect(calls).toHaveLength(3);
  });

  it("skips a model that has been switched off and remembers it", async () => {
    const { chat } = await load({ GROQ_MODEL: "llama-3.3-70b-versatile" });
    const calls = pretend((seen) => (seen.model === "llama-3.3-70b-versatile" ? { status: 404, body: { error: { message: "The model `llama-3.3-70b-versatile` does not exist or you do not have access to it." } } } : ok('{"a":5}')));
    expect((await chat(request)).model).toBe("openai/gpt-oss-120b");
    await chat(request);
    expect(calls.filter((c) => c.model === "llama-3.3-70b-versatile")).toHaveLength(1);
  });

  it("asks again without the thinking settings if a model refuses them", async () => {
    const { chat } = await load();
    const calls = pretend((seen) => ("reasoning_effort" in seen.body ? { status: 400, body: { error: { message: "property 'reasoning_effort' is unsupported" } } } : ok('{"a":6}')));
    const res = await chat(request);
    expect(res.model).toBe("openai/gpt-oss-120b");
    expect(calls[1].body).toMatchObject({ max_tokens: 900 });
    expect(calls[1].body).not.toHaveProperty("reasoning_effort");
  });

  it("gives a small reading list to Groq's free allowance and a full one to Gemini", async () => {
    expect((await load()).aiIsCompact()).toBe(true);
    expect((await load({ GROQ_API_KEY: "", GEMINI_API_KEY: "k" })).aiIsCompact()).toBe(false);
  });

  it("reads the wait a provider asks for", async () => {
    const { waitHint } = await load();
    expect(waitHint("", "2")).toBe(2000);
    expect(waitHint("Please try again in 7.66s.", null)).toBe(7660);
    expect(waitHint("Please try again in 2m59.56s.", null)).toBe(179560);
    expect(waitHint("Please retry in 450ms", null)).toBe(450);
    expect(waitHint("quota exceeded", null)).toBeNull();
  });
});
