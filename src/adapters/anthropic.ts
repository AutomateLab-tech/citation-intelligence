import { envKey } from "../lib/config.js";
import { fetchJson, ToolFetchError } from "../lib/fetch.js";
import type { AdapterResult, Citation } from "../types.js";

type AnthropicMsgResponse = {
  content?: Array<
    | { type: "text"; text: string }
    | {
        type: "web_search_tool_result";
        content?: Array<{ title?: string; url?: string }>;
      }
    | { type: "tool_use"; name?: string }
  >;
};

export async function claudeSearch(
  query: string,
  maxResults: number,
): Promise<AdapterResult> {
  const key = envKey("ANTHROPIC_API_KEY");
  if (!key) {
    throw new ToolFetchError({
      type: "missing_key",
      engine: "claude",
      env_var: "ANTHROPIC_API_KEY",
      message:
        "Set ANTHROPIC_API_KEY to use the Claude engine. Get a key at https://console.anthropic.com.",
    });
  }

  const body = JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    messages: [{ role: "user", content: query }],
  });

  const res = await fetchJson<AnthropicMsgResponse>(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body,
    },
  );

  const citations: Citation[] = [];
  const seen = new Set<string>();
  const textParts: string[] = [];

  for (const block of res.content ?? []) {
    if (block.type === "text") {
      textParts.push(block.text);
    } else if (block.type === "web_search_tool_result") {
      for (const r of block.content ?? []) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        citations.push({
          url: r.url,
          title: r.title,
          rank: citations.length + 1,
        });
        if (citations.length >= maxResults) break;
      }
    }
  }

  return { citations, raw_answer: textParts.join("\n") || undefined };
}
