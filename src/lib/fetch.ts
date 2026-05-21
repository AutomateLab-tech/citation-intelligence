import { request } from "undici";
import type { ToolError } from "../types.js";

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

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOpts = {},
): Promise<T> {
  const { method = "GET", headers = {}, body, timeoutMs = 30_000 } = opts;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await request(url, {
      method,
      headers: { "user-agent": "citation-intelligence-mcp/0.1", ...headers },
      body,
      signal: ac.signal,
    });
    const text = await res.body.text();
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
}

export async function fetchText(
  url: string,
  opts: FetchOpts = {},
): Promise<{ text: string; status: number; finalUrl: string }> {
  const { method = "GET", headers = {}, body, timeoutMs = 30_000 } = opts;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await request(url, {
      method,
      headers: { "user-agent": "citation-intelligence-mcp/0.1", ...headers },
      body,
      signal: ac.signal,
    });
    const text = await res.body.text();
    return { text, status: res.statusCode, finalUrl: url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ToolFetchError({ type: "fetch_error", url, message: msg });
  } finally {
    clearTimeout(timer);
  }
}
