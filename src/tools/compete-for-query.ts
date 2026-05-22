import { z } from "zod";
import { checkCitations } from "./check-citations.js";
import { compareDomains } from "./compare-domains.js";
import { log } from "../lib/log.js";

export const competeForQueryInputSchema = {
  query: z.string().min(1).describe("Search query to test (what would a user ask an AI?)."),
  your_url: z
    .string()
    .url()
    .describe("Your URL to benchmark against the cited competitors."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing_serp", "brave_serp", "google_ai_mode", "auto"])
    .default("auto")
    .describe("AI engine to query for the citation set. 'auto' picks the first available key."),
  max_competitors: z
    .number()
    .int()
    .min(1)
    .max(9)
    .default(4)
    .describe("How many cited URLs to compare against your_url. Capped at 9 (compare_domains accepts max 10 URLs total including yours)."),
};

const inputSchema = z.object(competeForQueryInputSchema);

export async function competeForQuery(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  log.debug("compete_for_query start", { query: parsed.query, your_url: parsed.your_url });

  const citations = await checkCitations({
    query: parsed.query,
    engine: parsed.engine,
    max_results: parsed.max_competitors,
  });

  const yourHost = new URL(parsed.your_url).hostname.toLowerCase();
  const competitorUrls: string[] = [];
  for (const c of citations.citations) {
    try {
      const host = new URL(c.url).hostname.toLowerCase();
      if (host === yourHost) continue;
      if (competitorUrls.length >= parsed.max_competitors) break;
      competitorUrls.push(c.url);
    } catch {
      // skip malformed
    }
  }

  if (competitorUrls.length === 0) {
    return {
      query: parsed.query,
      engine: citations.engine,
      fetched_at: new Date().toISOString(),
      your_url: parsed.your_url,
      competitors: [],
      comparison: null,
      note: "No competitor URLs found in citation set. Either no citations returned, or all citations came from your own domain.",
    };
  }

  const comparison = await compareDomains({ urls: [parsed.your_url, ...competitorUrls] });
  const yourRow = comparison.rows.find((r) => r.url === parsed.your_url);
  const competitorRows = comparison.rows.filter((r) => r.url !== parsed.your_url);

  const yourScore = yourRow && "score" in yourRow ? yourRow.score : undefined;
  const competitorScores = competitorRows
    .map((r) => ("score" in r ? r.score : undefined))
    .filter((s): s is number => typeof s === "number");
  const avgCompetitorScore =
    competitorScores.length > 0
      ? Math.round(competitorScores.reduce((a, b) => a + b, 0) / competitorScores.length)
      : null;

  const gap =
    typeof yourScore === "number" && avgCompetitorScore !== null
      ? yourScore - avgCompetitorScore
      : null;

  return {
    query: parsed.query,
    engine: citations.engine,
    fetched_at: new Date().toISOString(),
    your_url: parsed.your_url,
    your_score: yourScore ?? null,
    your_in_citations: citations.citations.some((c) => {
      try {
        return new URL(c.url).hostname.toLowerCase() === yourHost;
      } catch {
        return false;
      }
    }),
    competitors: competitorUrls,
    average_competitor_score: avgCompetitorScore,
    score_gap: gap,
    comparison,
  };
}
