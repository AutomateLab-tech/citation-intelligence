import { z } from "zod";
import { checkCitations } from "./check-citations.js";
import type { Engine } from "../types.js";

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
    .enum(["perplexity", "claude", "openai", "gemini", "bing", "auto"])
    .default("auto")
    .describe("AI engine to query."),
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
