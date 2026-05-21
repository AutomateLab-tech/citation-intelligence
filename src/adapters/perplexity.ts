import { envKey } from "../lib/config.js";
import { fetchJson, ToolFetchError } from "../lib/fetch.js";
import type { AdapterResult, Citation } from "../types.js";

type SonarResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
  citations?: string[];
  search_results?: Array<{ title?: string; url?: string }>;
};

export async function perplexitySearch(
  query: string,
  maxResults: number,
): Promise<AdapterResult> {
  const key = envKey("PERPLEXITY_API_KEY");
  if (!key) {
    throw new ToolFetchError({
      type: "missing_key",
      engine: "perplexity",
      env_var: "PERPLEXITY_API_KEY",
      message:
        "Set PERPLEXITY_API_KEY to use the Perplexity engine. Sign up at https://www.perplexity.ai/settings/api",
    });
  }

  const body = JSON.stringify({
    model: "sonar",
    messages: [{ role: "user", content: query }],
    return_citations: true,
  });

  const res = await fetchJson<SonarResponse>(
    "https://api.perplexity.ai/chat/completions",
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

  if (res.search_results) {
    for (const r of res.search_results) {
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
  if (citations.length < maxResults && res.citations) {
    for (const url of res.citations) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      citations.push({ url, rank: citations.length + 1 });
      if (citations.length >= maxResults) break;
    }
  }

  const raw_answer = res.choices?.[0]?.message?.content;
  return { citations, raw_answer };
}
