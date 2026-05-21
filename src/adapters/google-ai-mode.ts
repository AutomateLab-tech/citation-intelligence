import { envKey } from "../lib/config.js";
import { fetchJson, ToolFetchError } from "../lib/fetch.js";
import type { AdapterResult, Citation } from "../types.js";

// Google AI Mode is the conversational mode at google.com/ai - distinct from
// the inline AI Overview that appears on a normal SERP. SerpAPI exposes it
// behind engine=google_ai_mode (see https://serpapi.com/google-ai-mode-api).
//
// Response shape is similar to the AI Overview surface: a synthesized answer
// plus a list of references. We map references[].link/title to citations.

type GoogleAiModeResponse = {
  ai_mode?: {
    text_blocks?: Array<{ snippet?: string; text?: string }>;
    references?: Array<{ link?: string; title?: string; source?: string }>;
  };
  // Older / alt response shapes may surface results directly:
  text_blocks?: Array<{ snippet?: string; text?: string }>;
  references?: Array<{ link?: string; title?: string }>;
};

export async function googleAiModeSearch(
  query: string,
  maxResults: number,
  opts?: { location?: string; hl?: string },
): Promise<AdapterResult> {
  const key = envKey("SERPAPI_KEY");
  if (!key) {
    throw new ToolFetchError({
      type: "missing_key",
      engine: "google_ai_mode",
      env_var: "SERPAPI_KEY",
      message:
        "Set SERPAPI_KEY to use the Google AI Mode engine (separate from ai_overview). Free tier at https://serpapi.com (100 searches/month).",
    });
  }

  const params = new URLSearchParams({
    engine: "google_ai_mode",
    q: query,
    api_key: key,
    hl: opts?.hl ?? "en",
  });
  if (opts?.location) params.set("location", opts.location);

  const res = await fetchJson<GoogleAiModeResponse>(
    `https://serpapi.com/search?${params.toString()}`,
  );

  const block = res.ai_mode ?? res;
  const textParts: string[] = [];
  for (const t of block.text_blocks ?? []) {
    const s = t.text ?? t.snippet;
    if (s) textParts.push(s);
  }

  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const ref of block.references ?? []) {
    if (!ref.link || seen.has(ref.link)) continue;
    seen.add(ref.link);
    citations.push({
      url: ref.link,
      title: ref.title,
      rank: citations.length + 1,
    });
    if (citations.length >= maxResults) break;
  }

  return {
    citations,
    raw_answer: textParts.join("\n\n") || undefined,
  };
}
