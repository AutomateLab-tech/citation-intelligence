import { z } from "zod";
import { citedForDomain } from "../lib/cache.js";

export const citedForInputSchema = {
  domain: z.string().min(1).describe("Domain to look up, e.g. 'automatelab.tech'."),
  since: z
    .string()
    .optional()
    .describe("ISO date floor, e.g. '2026-01-01'. Only return entries fetched on or after this date."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing"])
    .optional()
    .describe("Filter by engine. Omit to include all."),
  limit: z.number().int().min(1).max(500).default(50).describe("Maximum results."),
};

const inputSchema = z.object(citedForInputSchema);

export async function citedFor(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const results = await citedForDomain(
    parsed.domain,
    parsed.since,
    parsed.engine,
    parsed.limit,
  );
  return {
    domain: parsed.domain,
    since: parsed.since,
    engine_filter: parsed.engine,
    results,
    total: results.length,
    source: "local_cache" as const,
  };
}
