import { z } from "zod";
import { fetchBingQueryStats } from "../adapters/bing-webmaster.js";
import { amICited } from "./am-i-cited.js";

export const bingCitationGapInputSchema = {
  domain: z
    .string()
    .min(1)
    .describe("Domain to analyze, e.g. 'automatelab.tech'. Used for the citation check."),
  queries: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .describe("Queries to cross-reference. 1-20 per call."),
  site_url: z
    .string()
    .optional()
    .describe(
      "Verified Bing Webmaster site URL. Defaults to 'https://<domain>/'. Bing uses the https origin WITH a trailing slash, NOT the sc-domain: form GSC uses.",
    ),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing_serp", "brave_serp", "google_ai_mode", "auto"])
    .default("auto")
    .describe("AI engine for the citation check."),
};

const inputSchema = z.object(bingCitationGapInputSchema);

export async function bingCitationGap(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);

  const siteUrl =
    parsed.site_url ?? `https://${parsed.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;

  const [bingStats, citation] = await Promise.all([
    fetchBingQueryStats(siteUrl),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    amICited({ domain: parsed.domain, queries: parsed.queries, engine: parsed.engine }) as Promise<any>,
  ]);

  // Map Bing's returned top queries by lowercased query for the join.
  const bingMap = new Map<string, { impressions: number; clicks: number; position: number }>();
  for (const s of bingStats) {
    bingMap.set(s.query.toLowerCase(), {
      impressions: s.impressions,
      clicks: s.clicks,
      position: s.position,
    });
  }

  // Flatten citation results regardless of single/multi-engine mode.
  const citationResults: Array<{ query: string; cited: boolean; rank?: number; matching_urls: string[] }> =
    citation.mode === "single_engine"
      ? citation.results
      : citation.per_engine?.[0]?.results ?? [];

  const rows = parsed.queries.map((q) => {
    const bing = bingMap.get(q.toLowerCase()) ?? null;
    const cite = citationResults.find((r) => r.query === q);
    return {
      query: q,
      bing,
      ai_cited: cite?.cited ?? false,
      ai_rank: cite?.rank,
    };
  });

  const gaps = rows
    .filter((r) => r.bing !== null && !r.ai_cited && r.bing.position <= 10)
    .sort((a, b) => (b.bing?.impressions ?? 0) - (a.bing?.impressions ?? 0));

  return {
    domain: parsed.domain,
    site_url: siteUrl,
    engine: citation.engine,
    rows,
    closest_wins: gaps,
  };
}
