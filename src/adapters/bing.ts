import { envKey } from "../lib/config.js";
import { fetchJson, ToolFetchError } from "../lib/fetch.js";
import type { AdapterResult, Citation } from "../types.js";

type BingResponse = {
  webPages?: {
    value?: Array<{ name?: string; url?: string; snippet?: string }>;
  };
};

export async function bingSearch(
  query: string,
  maxResults: number,
): Promise<AdapterResult> {
  const key = envKey("BING_API_KEY");
  if (!key) {
    throw new ToolFetchError({
      type: "missing_key",
      engine: "bing_serp",
      env_var: "BING_API_KEY",
      message:
        "Set BING_API_KEY to use the Bing engine. Free tier at https://www.microsoft.com/en-us/bing/apis/bing-web-search-api.",
    });
  }

  const params = new URLSearchParams({ q: query, count: String(maxResults) });
  const res = await fetchJson<BingResponse>(
    `https://api.bing.microsoft.com/v7.0/search?${params.toString()}`,
    { headers: { "ocp-apim-subscription-key": key } },
  );

  const citations: Citation[] = [];
  let rank = 1;
  for (const v of res.webPages?.value ?? []) {
    if (!v.url) continue;
    citations.push({
      url: v.url,
      title: v.name,
      snippet: v.snippet,
      rank: rank++,
    });
    if (citations.length >= maxResults) break;
  }

  return { citations };
}
