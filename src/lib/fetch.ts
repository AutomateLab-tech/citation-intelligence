import { request } from "undici";
import type { ToolError } from "../types.js";
import { log } from "./log.js";

export class ToolFetchError extends Error {
  toolError: ToolError;
  constructor(toolError: ToolError) {
    super(toolError.message);
    this.toolError = toolError;
  }
}

export type FetchOpts = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

// ---------------------------------------------------------------------------
// Per-host concurrency + rate-limit middleware (AL-546)
//
// Two knobs, both env-configurable:
//   CITATION_MAX_CONCURRENT_PER_HOST  (default 4)   - in-flight cap per host
//   CITATION_MIN_INTERVAL_MS_PER_HOST (default 0)   - floor on time between
//                                                    consecutive requests
// The cap is per hostname; different hosts run in parallel. The floor uses a
// simple last-request-timestamp gate (no token bucket - keep it small).
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_PER_HOST = Math.max(
  1,
  Number(process.env.CITATION_MAX_CONCURRENT_PER_HOST ?? "4"),
);
const MIN_INTERVAL_MS_PER_HOST = Math.max(
  0,
  Number(process.env.CITATION_MIN_INTERVAL_MS_PER_HOST ?? "0"),
);

type HostState = {
  inflight: number;
  queue: Array<() => void>;
  lastStart: number;
};

const hostState = new Map<string, HostState>();

function getHostState(host: string): HostState {
  let s = hostState.get(host);
  if (!s) {
    s = { inflight: 0, queue: [], lastStart: 0 };
    hostState.set(host, s);
  }
  return s;
}

async function acquire(host: string): Promise<void> {
  const s = getHostState(host);
  if (s.inflight < MAX_CONCURRENT_PER_HOST) {
    s.inflight += 1;
  } else {
    await new Promise<void>((resolve) => s.queue.push(resolve));
    s.inflight += 1;
  }
  if (MIN_INTERVAL_MS_PER_HOST > 0) {
    const elapsed = Date.now() - s.lastStart;
    if (elapsed < MIN_INTERVAL_MS_PER_HOST) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS_PER_HOST - elapsed));
    }
  }
  s.lastStart = Date.now();
}

function release(host: string): void {
  const s = getHostState(host);
  s.inflight = Math.max(0, s.inflight - 1);
  const next = s.queue.shift();
  if (next) next();
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

// Test/diagnostic helper. Not exported via index.
export function _fetchDiagnostics(): {
  max_concurrent_per_host: number;
  min_interval_ms_per_host: number;
  hosts: Array<{ host: string; inflight: number; queued: number }>;
} {
  return {
    max_concurrent_per_host: MAX_CONCURRENT_PER_HOST,
    min_interval_ms_per_host: MIN_INTERVAL_MS_PER_HOST,
    hosts: [...hostState.entries()].map(([host, s]) => ({
      host,
      inflight: s.inflight,
      queued: s.queue.length,
    })),
  };
}

async function withHostGate<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = hostOf(url);
  await acquire(host);
  try {
    return await fn();
  } finally {
    release(host);
  }
}

// ---------------------------------------------------------------------------

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOpts = {},
): Promise<T> {
  const { method = "GET", headers = {}, body, timeoutMs = 30_000 } = opts;
  return withHostGate(url, async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await request(url, {
        method,
        headers: { "user-agent": "citation-intelligence-mcp/0.5", ...headers },
        body,
        signal: ac.signal,
      });
      const text = await res.body.text();
      if (res.statusCode === 429) {
        log.warn("rate limited", { url, status: 429 });
      }
      if (res.statusCode >= 400) {
        throw new ToolFetchError({
          type: "fetch_error",
          url,
          status: res.statusCode,
          message: `${res.statusCode}: ${text.slice(0, 500)}`,
        });
      }
      if (!text) return undefined as unknown as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ToolFetchError({
          type: "fetch_error",
          url,
          status: res.statusCode,
          message: `non-JSON response: ${text.slice(0, 200)}`,
        });
      }
    } catch (err) {
      if (err instanceof ToolFetchError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new ToolFetchError({ type: "fetch_error", url, message: msg });
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function fetchText(
  url: string,
  opts: FetchOpts = {},
): Promise<{ text: string; status: number; finalUrl: string }> {
  const { method = "GET", headers = {}, body, timeoutMs = 30_000 } = opts;
  return withHostGate(url, async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await request(url, {
        method,
        headers: { "user-agent": "citation-intelligence-mcp/0.5", ...headers },
        body,
        signal: ac.signal,
      });
      const text = await res.body.text();
      if (res.statusCode === 429) {
        log.warn("rate limited", { url, status: 429 });
      }
      return { text, status: res.statusCode, finalUrl: url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ToolFetchError({ type: "fetch_error", url, message: msg });
    } finally {
      clearTimeout(timer);
    }
  });
}
