import { z } from "zod";
import { checkCitations } from "./check-citations.js";
import { collectSignals } from "../adapters/predictors.js";
import { log } from "../lib/log.js";

export const citationFreshnessScoreInputSchema = {
  query: z.string().min(1).describe("Search query whose cited URLs to score for freshness."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing_serp", "brave_serp", "google_ai_mode", "auto"])
    .default("auto")
    .describe("AI engine to query for the citation set."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("How many cited URLs to inspect."),
};

const inputSchema = z.object(citationFreshnessScoreInputSchema);

function freshnessBucket(daysAgo: number | undefined): "fresh" | "current" | "stale" | "ancient" | "unknown" {
  if (daysAgo === undefined) return "unknown";
  if (daysAgo <= 180) return "fresh";
  if (daysAgo <= 365) return "current";
  if (daysAgo <= 730) return "stale";
  return "ancient";
}

// Recency weight from 0..1; halves every 365 days.
function weight(daysAgo: number | undefined): number {
  if (daysAgo === undefined) return 0;
  const halflife = 365;
  return Math.max(0, Math.pow(0.5, daysAgo / halflife));
}

export async function citationFreshnessScore(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  log.debug("citation_freshness_score start", { query: parsed.query });

  const citations = await checkCitations({
    query: parsed.query,
    engine: parsed.engine,
    max_results: parsed.max_results,
  });

  const perUrl = await Promise.all(
    citations.citations.map(async (c) => {
      try {
        const signals = await collectSignals(c.url);
        return {
          url: c.url,
          rank: c.rank,
          date_modified_iso: signals.date_modified_iso ?? null,
          last_modified_days_ago: signals.last_modified_days_ago ?? null,
          bucket: freshnessBucket(signals.last_modified_days_ago),
          weight: Number(weight(signals.last_modified_days_ago).toFixed(3)),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { url: c.url, rank: c.rank, error: msg };
      }
    }),
  );

  const scored = perUrl.filter((r): r is Extract<typeof perUrl[number], { weight: number }> => "weight" in r);
  const known = scored.filter((r) => r.last_modified_days_ago !== null);
  const avgDaysAgo =
    known.length > 0
      ? Math.round(known.reduce((a, r) => a + (r.last_modified_days_ago as number), 0) / known.length)
      : null;
  const recencyScore =
    scored.length > 0
      ? Math.round((scored.reduce((a, r) => a + r.weight, 0) / scored.length) * 100)
      : 0;

  const counts = {
    fresh: scored.filter((r) => r.bucket === "fresh").length,
    current: scored.filter((r) => r.bucket === "current").length,
    stale: scored.filter((r) => r.bucket === "stale").length,
    ancient: scored.filter((r) => r.bucket === "ancient").length,
    unknown: perUrl.length - known.length,
  };

  return {
    query: parsed.query,
    engine: citations.engine,
    fetched_at: new Date().toISOString(),
    recency_score: recencyScore,
    average_days_old: avgDaysAgo,
    buckets: counts,
    per_url: perUrl,
    note:
      "recency_score is a 0-100 average of per-URL recency weights (halflife=365d). Pages with no detectable dateModified contribute weight 0.",
  };
}
