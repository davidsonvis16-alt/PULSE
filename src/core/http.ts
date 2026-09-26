/**
 * Networking used by every provider adapter.
 *
 * Gives us, in one place: request timeouts, one retry on transient failure,
 * a small client-side rate limiter so a fast-typing user cannot flood a public
 * API, and a short-lived response cache so revisiting a screen is instant.
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

type CacheEntry = { at: number; value: unknown };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;

function readCache<T>(key: string, ttlMs: number): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > ttlMs) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function writeCache(key: string, value: unknown) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Drop the oldest quarter rather than thrashing on every insert.
    const keys = [...cache.keys()].slice(0, Math.floor(MAX_CACHE_ENTRIES / 4));
    keys.forEach((k) => cache.delete(k));
  }
  cache.set(key, { at: Date.now(), value });
}

export function clearHttpCache(prefix?: string) {
  if (!prefix) {
    cache.clear();
    return;
  }
  [...cache.keys()].filter((k) => k.startsWith(prefix)).forEach((k) => cache.delete(k));
}

/** Token-bucket limiter, one bucket per host. */
class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
  }

  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.tokens = Math.min(
        this.capacity,
        this.tokens + ((now - this.lastRefill) / 1000) * this.refillPerSecond,
      );
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = ((1 - this.tokens) / this.refillPerSecond) * 1000;
      await delay(Math.min(waitMs, 1000));
    }
  }
}

const limiters = new Map<string, RateLimiter>();

function limiterFor(url: string, capacity: number, refillPerSecond: number) {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep the raw string as the bucket key */
  }
  let limiter = limiters.get(host);
  if (!limiter) {
    limiter = new RateLimiter(capacity, refillPerSecond);
    limiters.set(host, limiter);
  }
  return limiter;
}

export function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Work that is allowed to be late.
 *
 * `Promise.all` over a dozen endpoints runs at the speed of the worst one, and
 * a public feed that stops answering is not an unusual event — it is a Tuesday.
 * Anything assembled from many sources uses this instead: it hands back what
 * arrived inside the deadline and `undefined` for the rest, so one dead
 * endpoint costs the deadline rather than its own timeout.
 *
 * Nothing is cancelled. A late answer still lands in the response cache above,
 * which means the next call gets it for free.
 */
export function settleWithin<T>(
  work: Promise<T>[],
  deadlineMs: number,
): Promise<(T | undefined)[]> {
  if (work.length === 0) return Promise.resolve([]);

  let reachDeadline: () => void = () => {};
  const deadline = new Promise<undefined>((resolve) => {
    reachDeadline = () => resolve(undefined);
  });
  const timer = setTimeout(reachDeadline, deadlineMs);

  return Promise.all(
    work.map((item) => Promise.race([item.catch(() => undefined), deadline])),
  ).finally(() => clearTimeout(timer));
}

export interface GetJsonOptions {
  /** Cache lifetime. Pass 0 to bypass the cache entirely. */
  ttlMs?: number;
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  rate?: { capacity: number; perSecond: number };
  /** 'text' hands back the body untouched, for feeds that are not JSON. */
  responseType?: 'json' | 'text';
}

export async function getJson<T>(url: string, options: GetJsonOptions = {}): Promise<T> {
  const {
    ttlMs = DEFAULT_TTL_MS,
    timeoutMs = 12000,
    retries = 1,
    headers,
    signal,
    rate = { capacity: 8, perSecond: 4 },
    responseType = 'json',
  } = options;

  if (ttlMs > 0) {
    const cached = readCache<T>(url, ttlMs);
    if (cached !== undefined) return cached;
    const pending = inflight.get(url);
    if (pending) return pending as Promise<T>;
  }

  const run = (async () => {
    await limiterFor(url, rate.capacity, rate.perSecond).take();

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort);
      try {
        const response = await fetch(url, {
          headers: {
            Accept: responseType === 'json' ? 'application/json' : '*/*',
            ...headers,
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          // 4xx is a real answer: do not burn a retry on it.
          if (response.status < 500 && response.status !== 429) {
            throw new HttpError(`Request failed (${response.status})`, response.status, url);
          }
          throw new HttpError(`Request failed (${response.status})`, response.status, url);
        }
        const text = await response.text();
        const parsed = (responseType === 'text' ? text : text ? JSON.parse(text) : null) as T;
        if (ttlMs > 0) writeCache(url, parsed);
        return parsed;
      } catch (error) {
        lastError = error;
        if (signal?.aborted) throw error;
        const retryable =
          !(error instanceof HttpError) || error.status >= 500 || error.status === 429;
        if (!retryable || attempt === retries) break;
        await delay(400 * 2 ** attempt);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }

    if (lastError instanceof HttpError) throw lastError;
    if (lastError instanceof Error && lastError.name === 'AbortError') {
      throw new NetworkError('The request timed out.');
    }
    throw new NetworkError(lastError instanceof Error ? lastError.message : undefined);
  })();

  if (ttlMs > 0) {
    inflight.set(url, run);
    run.finally(() => inflight.delete(url)).catch(() => {});
  }

  return run;
}

/** The same timeouts, retry, rate limit and cache as `getJson`, for text bodies. */
export function getText(url: string, options: Omit<GetJsonOptions, 'responseType'> = {}) {
  return getJson<string>(url, { ...options, responseType: 'text' });
}

export function buildUrl(base: string, params: Record<string, string | number | undefined | null>) {
  const search = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && `${v}` !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return search ? `${base}?${search}` : base;
}
