import "server-only";
import { LRUCache } from "lru-cache";
import { env, userAgent } from "../env";

/**
 * One polite HTTP client for every scholarly API:
 *  - per-host concurrency + spacing (Crossref and friends rate-limit hard)
 *  - timeouts, retries with backoff, Retry-After
 *  - an LRU cache with in-flight de-duplication (the same DOI checked by
 *    three features costs one request)
 */

export class UpstreamError extends Error {
  constructor(
    public host: string,
    public status: number | null,
    message: string,
  ) {
    super(message);
  }
}

interface HostRule {
  concurrency: number;
  minIntervalMs: number;
}

const HOST_RULES: Record<string, HostRule> = {
  // Crossref has two pools. With a contact email ("polite"): 3 at once. Without one ("public"): one at a time,
  // five a second. Sending more than that gets every request refused, so we stay inside it and also follow
  // the limits Crossref states in each answer (see adoptLimits).
  "api.crossref.org": env.contactEmail ? { concurrency: 3, minIntervalMs: 110 } : { concurrency: 1, minIntervalMs: 220 },
  "eutils.ncbi.nlm.nih.gov": { concurrency: 2, minIntervalMs: 350 },
  "pmc.ncbi.nlm.nih.gov": { concurrency: 2, minIntervalMs: 350 },
  "doi.org": { concurrency: 5, minIntervalMs: 40 },
  "api.openalex.org": { concurrency: 5, minIntervalMs: 40 },
  "openlibrary.org": { concurrency: 2, minIntervalMs: 200 },
  "export.arxiv.org": { concurrency: 1, minIntervalMs: 1000 },
  "arxiv.org": { concurrency: 1, minIntervalMs: 500 },
  "www.ebi.ac.uk": { concurrency: 3, minIntervalMs: 120 },
  // Semantic Scholar: 1 request per second with a key; the keyless pool is shared by everyone.
  "api.semanticscholar.org": { concurrency: 1, minIntervalMs: 1100 },
  "www.googleapis.com": { concurrency: 2, minIntervalMs: 150 },
  "api.unpaywall.org": { concurrency: 3, minIntervalMs: 100 },
};
const DEFAULT_RULE: HostRule = { concurrency: 4, minIntervalMs: 50 };

class HostGate {
  private active = 0;
  private last = 0;
  private queue: (() => void)[] = [];
  constructor(private rule: HostRule) {}

  async acquire() {
    if (this.active >= this.rule.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    const wait = this.last + this.rule.minIntervalMs - Date.now();
    this.last = Math.max(Date.now(), this.last + this.rule.minIntervalMs);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  release() {
    this.active--;
    this.queue.shift()?.();
  }

  /** Follow the limits the host itself announces. */
  adopt(rule: HostRule) {
    this.rule = rule;
  }
}

/** Crossref states its limits in every answer; staying inside them is what keeps it answering. */
function adoptLimits(host: string, res: Response) {
  if (host !== "api.crossref.org") return;
  const limit = Number(res.headers.get("x-rate-limit-limit"));
  const interval = parseFloat(res.headers.get("x-rate-limit-interval") ?? "");
  const concurrency = Number(res.headers.get("x-concurrency-limit"));
  if (!(limit > 0) || !(interval > 0) || !(concurrency > 0)) return;
  // A little slower than the stated maximum, to leave room for clock skew.
  gateFor(host).adopt({ concurrency: Math.min(concurrency, 5), minIntervalMs: Math.ceil(((interval * 1000) / limit) * 1.15) });
}

const gates = new Map<string, HostGate>();
function gateFor(host: string) {
  let g = gates.get(host);
  if (!g) {
    g = new HostGate(HOST_RULES[host] ?? DEFAULT_RULE);
    gates.set(host, g);
  }
  return g;
}

export interface FetchResult<T> {
  status: number;
  data: T | null;
  url: string;
  fromCache: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cache = new LRUCache<string, FetchResult<any>>({ max: 3000, ttl: 1000 * 60 * 60 * 6 });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inflight = new Map<string, Promise<FetchResult<any>>>();

export interface GetOptions {
  accept?: string;
  timeoutMs?: number;
  retries?: number;
  /** Status codes that are an answer, not an error (e.g. 404 = "not found"). */
  okStatuses?: number[];
  parse?: "json" | "text";
  cacheTtlMs?: number;
  /** Extra request headers (e.g. an API key header). Never part of the cache key. */
  headers?: Record<string, string>;
  /**
   * Some hosts answer 429 without a Retry-After (Semantic Scholar, Google Books).
   * When set, a 429 that survives the retries puts the host to rest for this long,
   * so `isRateLimited(host)` is true and callers skip it instead of hammering it.
   */
  cooldownOn429Ms?: number;
  /** Same idea for a host that does not answer at all: after the retries time out, skip it for this long. */
  cooldownOnTimeoutMs?: number;
  /**
   * Rest only part of a host. OpenAlex bills searches and lists against a daily budget but answers
   * single-record look-ups for free: when the budget runs out, requests in the "paid" scope rest
   * while DOI look-ups carry on. A rest set without a scope still covers the whole host.
   */
  rateLimitScope?: string;
  /** Runs once on a successful body before it is cached (keep the small extract, drop the big document). */
  transform?: (data: unknown) => unknown;
}

const rateLimitedUntil = new Map<string, number>();

/** True while a host has told us to back off, or is being rested after not answering (so features can skip it instead of waiting). */
export function isRateLimited(host: string, scope?: string): boolean {
  const now = Date.now();
  if ((rateLimitedUntil.get(host) ?? 0) > now) return true;
  return scope ? (rateLimitedUntil.get(`${host}#${scope}`) ?? 0) > now : false;
}

async function rawGet<T>(url: string, opts: GetOptions): Promise<FetchResult<T>> {
  const host = new URL(url).host;
  const restKey = opts.rateLimitScope ? `${host}#${opts.rateLimitScope}` : host;
  if (isRateLimited(host, opts.rateLimitScope)) throw new UpstreamError(host, 429, `${host} is resting (it asked us to slow down or did not answer)`);
  const gate = gateFor(host);
  const retries = opts.retries ?? 2;
  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await gate.acquire();
    // The host may have been put to rest while this request waited its turn: do not send it after all.
    if (isRateLimited(host, opts.rateLimitScope)) {
      gate.release();
      throw new UpstreamError(host, 429, `${host} is resting (it asked us to slow down or did not answer)`);
    }
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        headers: {
          ...opts.headers,
          "User-Agent": userAgent(),
          Accept: opts.accept ?? "application/json",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(opts.timeoutMs ?? 9000),
        cache: "no-store",
      });
    } catch (err) {
      lastErr = err;
    } finally {
      gate.release();
    }

    if (res) {
      adoptLimits(host, res);
      if (res.ok || opts.okStatuses?.includes(res.status)) {
        let data: T | null = null;
        if (res.ok) {
          const text = await res.text();
          if (opts.parse === "text") data = text as unknown as T;
          else {
            try {
              data = JSON.parse(text) as T;
            } catch {
              throw new UpstreamError(host, res.status, `${host} returned something that was not JSON`);
            }
          }
          if (opts.transform) data = opts.transform(data) as T;
        }
        return { status: res.status, data, url, fromCache: false };
      }
      if (res.status === 429 || res.status >= 500) {
        lastErr = new UpstreamError(host, res.status, `${host} answered ${res.status}`);
        const retryAfter = Number(res.headers.get("retry-after"));
        // A long Retry-After (OpenAlex's keyless budget) means "not today": fail fast so callers degrade.
        if (res.status === 429 && Number.isFinite(retryAfter) && retryAfter > 5) {
          rateLimitedUntil.set(restKey, Date.now() + retryAfter * 1000);
          throw lastErr;
        }
        // Crossref refuses in bursts when its pool is busy: wait a full second or more before asking again.
        const base = host === "api.crossref.org" && res.status === 429 ? 1200 : 400;
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 4000) : base * 2 ** attempt;
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw new UpstreamError(host, res.status, `${host} answered ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
  }
  if (lastErr instanceof UpstreamError) {
    if (lastErr.status === 429 && opts.cooldownOn429Ms) rateLimitedUntil.set(restKey, Date.now() + opts.cooldownOn429Ms);
    throw lastErr;
  }
  const reason = lastErr instanceof Error && lastErr.name === "TimeoutError" ? "timed out" : "could not be reached";
  if (opts.cooldownOnTimeoutMs) rateLimitedUntil.set(host, Date.now() + opts.cooldownOnTimeoutMs); // a dead host is dead for every scope
  throw new UpstreamError(host, null, `${host} ${reason}`);
}

export async function getCached<T>(url: string, opts: GetOptions = {}): Promise<FetchResult<T>> {
  const key = `${opts.accept ?? "json"}|${url}`;
  const hit = cache.get(key);
  if (hit) return { ...hit, fromCache: true } as FetchResult<T>;
  const running = inflight.get(key);
  if (running) return running as Promise<FetchResult<T>>;
  const p = rawGet<T>(url, opts)
    .then((r) => {
      cache.set(key, r, { ttl: opts.cacheTtlMs });
      return r;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  return u.toString();
}
