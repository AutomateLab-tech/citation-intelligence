import { envKey } from "../lib/config.js";
import { fetchJson, ToolFetchError } from "../lib/fetch.js";
import { log } from "../lib/log.js";
import type { AdapterResult, Citation } from "../types.js";

const OPENAI_MODEL = "gpt-4o-search-preview";

type OpenAiResponsesResult = {
  output?: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      annotations?: Array<{
        type: string;
        url?: string;
        title?: string;
      }>;
    }>;
  }>;
};

export async function openaiSearch(
  query: string,
  maxResults: number,
): Promise<AdapterResult> {
  const key = envKey("OPENAI_API_KEY");
  if (!key) {
    throw new ToolFetchError({
      type: "missing_key",
      engine: "openai",
      env_var: "OPENAI_API_KEY",
      message:
        "Set OPENAI_API_KEY to use the ChatGPT engine. Get a key at https://platform.openai.com.",
    });
  }

  log.debug("openai web_search", { model: OPENAI_MODEL });
  // System prompt approximates ChatGPT consumer behavior: answer with inline citations.
  // The Responses API takes the system prompt as `instructions`, not `system` (legacy Chat Completions param).
  const body = JSON.stringify({
    model: OPENAI_MODEL,
    tools: [{ type: "web_search_preview" }],
    instructions: "You are a search assistant. Answer with inline citations. List each source URL you used.",
    input: query,
  });

  const res = await fetchJson<OpenAiResponsesResult>(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body,
    },
  );

  const citations: Citation[] = [];
  const seen = new Set<string>();
  const textParts: string[] = [];

  for (const out of res.output ?? []) {
    for (const c of out.content ?? []) {
      if (c.type === "output_text" && c.text) textParts.push(c.text);
      for (const ann of c.annotations ?? []) {
        if (ann.type !== "url_citation" || !ann.url || seen.has(ann.url))
          continue;
        seen.add(ann.url);
        citations.push({
          url: ann.url,
          title: ann.title,
          rank: citations.length + 1,
        });
        if (citations.length >= maxResults) break;
      }
    }
  }

  return { citations, raw_answer: textParts.join("\n") || undefined };
}
