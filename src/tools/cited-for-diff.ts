import { z } from "zod";
import { citedForDomain } from "../lib/cache.js";
import { log } from "../lib/log.js";

export const citedForDiffInputSchema = {
  domain: z.string().min(1).describe("Domain to diff, e.g. 'automatelab.tech'."),
  baseline_until: z
    .string()
    .describe("ISO date (or ISO datetime). Baseline window = all cache entries fetched on or before this timestamp."),
  current_since: z
    .string()
    .optional()
    .describe("ISO date floor for the 'current' window. Defaults to baseline_until."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing_serp", "brave_serp", "google_ai_mode"])
    .optional()
    .describe("Filter by engine. Omit to include all."),
};

const inputSchema = z.object(citedForDiffInputSchema);

export async function citedForDiff(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  log.debug("cited_for_diff start", { domain: parsed.domain, baseline_until: parsed.baseline_until });

  const baselineUntilMs = Date.parse(parsed.baseline_until);
  if (Number.isNaN(baselineUntilMs)) {
    throw new Error(`baseline_until is not a parsable ISO date: ${parsed.baseline_until}`);
  }
  const currentSince = parsed.current_since ?? parsed.baseline_until;
  const currentSinceMs = Date.parse(currentSince);
  if (Number.isNaN(currentSinceMs)) {
    throw new Error(`current_since is not a parsable ISO date: ${currentSince}`);
  }

  // Pull a generous slice from the cache, then partition by timestamp here.
  const all = await citedForDomain(parsed.domain, undefined, parsed.engine, 500);

  const baseline = all.filter((r) => Date.parse(r.fetched_at) <= baselineUntilMs);
  const current = all.filter((r) => Date.parse(r.fetched_at) >= currentSinceMs);

  const baselineQueries = new Set(baseline.map((r) => r.query.toLowerCase()));
  const currentQueries = new Set(current.map((r) => r.query.toLowerCase()));

  const gained: Array<{ query: string; engine: string; rank: number; fetched_at: string; url: string }> = [];
  const lost: Array<{ query: string; engine: string; fetched_at: string; url: string }> = [];
  const unchanged: string[] = [];

  for (const q of currentQueries) {
    if (!baselineQueries.has(q)) {
      const sample = current.find((r) => r.query.toLowerCase() === q);
      if (sample) {
        gained.push({
          query: sample.query,
          engine: sample.engine,
          rank: sample.rank,
          fetched_at: sample.fetched_at,
          url: sample.url,
        });
      }
    } else {
      unchanged.push(q);
    }
  }
  for (const q of baselineQueries) {
    if (!currentQueries.has(q)) {
      const sample = baseline.find((r) => r.query.toLowerCase() === q);
      if (sample) {
        lost.push({
          query: sample.query,
          engine: sample.engine,
          fetched_at: sample.fetched_at,
          url: sample.url,
        });
      }
    }
  }

  return {
    domain: parsed.domain,
    engine_filter: parsed.engine,
    baseline_until: parsed.baseline_until,
    current_since: currentSince,
    fetched_at: new Date().toISOString(),
    counts: {
      baseline_unique_queries: baselineQueries.size,
      current_unique_queries: currentQueries.size,
      gained: gained.length,
      lost: lost.length,
      unchanged: unchanged.length,
    },
    gained,
    lost,
    unchanged_queries: unchanged,
    source: "local_cache" as const,
  };
}
