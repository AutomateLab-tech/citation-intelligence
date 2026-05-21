import { z } from "zod";
import { serpapiAiOverview } from "../adapters/serpapi.js";
import { getAiOverview, putAiOverview } from "../lib/cache.js";

export const aiOverviewInputSchema = {
  query: z.string().min(1).describe("Search query to check for Google AI Overview."),
  location: z
    .string()
    .optional()
    .describe("Location string, e.g. 'United States'. Affects AI Overview eligibility."),
  hl: z.string().default("en").describe("Language code, default 'en'."),
};

const inputSchema = z.object(aiOverviewInputSchema);

export async function aiOverview(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);

  const cached = await getAiOverview(parsed.query, parsed.location, parsed.hl);
  if (cached) {
    return {
      query: parsed.query,
      fetched_at: cached.fetched_at,
      ai_overview_present: cached.ai_overview_present,
      ai_overview_text: cached.ai_overview_text,
      sources: cached.sources,
      cached: true,
    };
  }

  const res = await serpapiAiOverview(parsed.query, parsed.location, parsed.hl);
  const fetched_at = new Date().toISOString();

  await putAiOverview({
    type: "ai_overview",
    query: parsed.query,
    location: parsed.location,
    hl: parsed.hl,
    fetched_at,
    ai_overview_present: res.ai_overview_present,
    ai_overview_text: res.ai_overview_text,
    sources: res.sources,
  });

  return {
    query: parsed.query,
    fetched_at,
    ai_overview_present: res.ai_overview_present,
    ai_overview_text: res.ai_overview_text,
    sources: res.sources,
    cached: false,
  };
}
