"use client";

/** Thin client for Knowlix's API: JSON in/out, readable errors, NDJSON streams. */

export class ClientApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function parseError(res: Response): Promise<ClientApiError> {
  try {
    const j = await res.json();
    return new ClientApiError(res.status, j?.error?.code ?? "error", j?.error?.message ?? `Request failed (${res.status})`, j?.error?.details);
  } catch {
    return new ClientApiError(res.status, "error", res.status === 504 ? "The server took too long. Please try again." : `Request failed (${res.status}).`);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ClientApiError(0, "offline", "You seem to be offline. Check your connection and try again.");
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

/** Reads a newline-delimited JSON stream, calling onEvent for each line as it arrives. */
export async function stream<E>(path: string, onEvent: (event: E) => void, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "POST",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ClientApiError(0, "offline", "You seem to be offline. Check your connection and try again.");
  }
  if (!res.ok || !res.body) throw await parseError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  const rest = buffer.trim();
  if (rest) onEvent(JSON.parse(rest) as E);
}

export function errorMessage(err: unknown): string {
  if (err instanceof ClientApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
