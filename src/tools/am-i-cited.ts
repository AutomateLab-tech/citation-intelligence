import { z } from "zod";
import { checkCitations } from "./check-citations.js";
import { ToolFetchError } from "../lib/fetch.js";
import type { Engine } from "../types.js";
import { ENGINE_SURFACE } from "../types.js";

export const amICitedInputSchema = {
  domain: z
    .string()
    .min(1)
    .describe("Domain to check, e.g. 'automatelab.tech' (without protocol)."),
  queries: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .describe("Queries to test the domain against. 1-20 queries per call."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing_serp", "brave_serp", "google_ai_mode", "auto"])
    .default("auto")
    .describe(
      "LLM engine to check for citations. 'bing_serp' and 'brave_serp' measure web rank, not LLM citations — use check_citations directly for web_rank queries. 'auto' picks the best available LLM engine."
    ),
};

const inputSchema = z.object(amICitedInputSchema);

function normalizeDomain(d: string): string {
  return d
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function urlMatchesDomain(url: string, needle: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host === needle || host.endsWith("." + needle);
  } catch {
    return false;
  }
}

export async function amICited(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);

  // bing_serp / brave_serp measure web rank, not LLM citations — refuse them here.
  if (parsed.engine === "bing_serp" || parsed.engine === "brave_serp") {
    throw new ToolFetchError({
      type: "invalid_input",
      field: "engine",
      message:
        `'${parsed.engine}' is a web_rank engine (traditional SERP), not an LLM citation engine. ` +
        `am_i_cited only measures LLM citation behavior. Use check_citations with engine='${parsed.engine}' ` +
        `to measure web rank instead, or set engine='auto' to pick an LLM engine.`,
    });
  }

  const needle = normalizeDomain(parsed.domain);

  const results: Array<{
    query: string;
    cited: boolean;
    rank?: number;
    matching_urls: string[];
  }> = [];

  let resolvedEngine: Engine = parsed.engine;

  for (const query of parsed.queries) {
    const res = await checkCitations({
      query,
      engine: parsed.engine,
      max_results: 20,
    });
    resolvedEngine = res.engine as Engine;
    // Brave free tier: 1 req/sec. Delay after each call to avoid 429.
    if (resolvedEngine === "brave_serp") {
      await new Promise<void>((resolve) => setTimeout(resolve, 1100));
    }

    const matches = res.citations.filter((c) => urlMatchesDomain(c.url, needle));
    const rank = matches.length > 0 ? matches[0].rank : undefined;
    results.push({
      query,
      cited: matches.length > 0,
      rank,
      matching_urls: matches.map((m) => m.url),
    });
  }

  const cited = results.filter((r) => r.cited);
  const ranks = cited.map((r) => r.rank).filter((r): r is number => r !== undefined);
  const average_rank =
    ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : undefined;

  return {
    domain: parsed.domain,
    engine: resolvedEngine,
    surface: ENGINE_SURFACE[resolvedEngine as Exclude<Engine, "auto">],
    fetched_at: new Date().toISOString(),
    results,
    summary: {
      queries_total: parsed.queries.length,
      queries_cited: cited.length,
      citation_rate: parsed.queries.length > 0 ? cited.length / parsed.queries.length : 0,
      average_rank,
    },
  };
}
