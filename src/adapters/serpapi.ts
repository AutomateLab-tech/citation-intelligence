import { envKey } from "../lib/config.js";
import { fetchJson, ToolFetchError } from "../lib/fetch.js";
import type { Citation } from "../types.js";

type SerpApiResponse = {
  ai_overview?: {
    text_blocks?: Array<{ snippet?: string; text?: string }>;
    references?: Array<{ link?: string; title?: string }>;
  };
  organic_results?: Array<{ link?: string; title?: string; snippet?: string }>;
};

export type AiOverviewResult = {
  ai_overview_present: boolean;
  ai_overview_text?: string;
  sources: Citation[];
};

export async function serpapiAiOverview(
  query: string,
  location?: string,
  hl?: string,
): Promise<AiOverviewResult> {
  const key = envKey("SERPAPI_KEY");
  if (!key) {
    throw new ToolFetchError({
      type: "missing_key",
      engine: "auto",
      env_var: "SERPAPI_KEY",
      message:
        "Set SERPAPI_KEY to fetch Google AI Overviews. Free tier at https://serpapi.com (100 searches/month).",
    });
  }

  const params = new URLSearchParams({
    engine: "google",
    q: query,
    api_key: key,
    hl: hl ?? "en",
  });
  if (location) params.set("location", location);

  const res = await fetchJson<SerpApiResponse>(
    `https://serpapi.com/search?${params.toString()}`,
  );

  const ao = res.ai_overview;
  if (!ao) {
    return { ai_overview_present: false, sources: [] };
  }

  const textParts: string[] = [];
  for (const block of ao.text_blocks ?? []) {
    const t = block.text ?? block.snippet;
    if (t) textParts.push(t);
  }

  const sources: Citation[] = [];
  let rank = 1;
  for (const ref of ao.references ?? []) {
    if (!ref.link) continue;
    sources.push({ url: ref.link, title: ref.title, rank: rank++ });
  }

  return {
    ai_overview_present: true,
    ai_overview_text: textParts.join("\n\n") || undefined,
    sources,
  };
}
