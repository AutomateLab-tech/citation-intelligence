import { envKey } from "../lib/config.js";
import { fetchJson, ToolFetchError } from "../lib/fetch.js";
import type { AdapterResult, Citation } from "../types.js";

type BraveResponse = {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
    }>;
  };
};

export async function braveSearch(
  query: string,
  maxResults: number,
): Promise<AdapterResult> {
  const key = envKey("BRAVE_API_KEY");
  if (!key) {
    throw new ToolFetchError({
      type: "missing_key",
      engine: "brave_serp",
      env_var: "BRAVE_API_KEY",
      message:
        "Set BRAVE_API_KEY to use the Brave engine. Free tier at https://api.search.brave.com (2000 queries/month).",
    });
  }

  const params = new URLSearchParams({ q: query, count: String(Math.min(maxResults, 20)) });
  const res = await fetchJson<BraveResponse>(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    {
      headers: {
        accept: "application/json",
        "x-subscription-token": key,
      },
    },
  );

  const citations: Citation[] = [];
  let rank = 1;
  for (const v of res.web?.results ?? []) {
    if (!v.url) continue;
    citations.push({
      url: v.url,
      title: v.title,
      snippet: v.description,
      rank: rank++,
    });
    if (citations.length >= maxResults) break;
  }

  return { citations };
}
