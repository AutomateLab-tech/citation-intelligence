import { z } from "zod";
import { perplexitySearch } from "../adapters/perplexity.js";
import { bingSearch } from "../adapters/bing.js";
import { claudeSearch } from "../adapters/anthropic.js";
import { openaiSearch } from "../adapters/openai.js";
import { geminiSearch } from "../adapters/gemini.js";
import { braveSearch } from "../adapters/brave.js";
import { googleAiModeSearch } from "../adapters/google-ai-mode.js";
import { envKey } from "../lib/config.js";
import { getCitations, putCitations } from "../lib/cache.js";
import { ToolFetchError } from "../lib/fetch.js";
import type { AdapterResult, Engine, Surface } from "../types.js";
import { ENGINE_SURFACE, ENGINE_INTERPRETATION_NOTE } from "../types.js";

export const checkCitationsInputSchema = {
  query: z.string().min(1).describe("The search query to test (what would a user ask an AI?)"),
  engine: z
    .enum([
      "perplexity",
      "claude",
      "openai",
      "gemini",
      "bing_serp",
      "brave_serp",
      "google_ai_mode",
      "auto",
    ])
    .default("auto")
    .describe(
      "Engine to query.\n" +
      "• perplexity / google_ai_mode — consumer_scrape: closest to real product behavior.\n" +
      "• claude / openai / gemini — api_proxy: API-tier call, may differ from consumer product.\n" +
      "• bing_serp / brave_serp — web_rank: traditional SERP rank, NOT LLM citation.\n" +
      "'auto' prefers SerpAPI (google_ai_mode) → Perplexity → LLM adapters → web_rank."
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum citations to return."),
  perplexity_model: z
    .string()
    .optional()
    .describe("Perplexity model override (e.g. 'sonar', 'sonar-pro', 'sonar-reasoning'). Only used when engine='perplexity'. Defaults to 'sonar-pro'."),
};

const inputSchema = z.object(checkCitationsInputSchema);

/** auto-pick prefers consumer_scrape surfaces first, then api_proxy, then web_rank */
function pickAutoEngine(): Engine | null {
  if (envKey("SERPAPI_KEY")) return "google_ai_mode";
  if (envKey("PERPLEXITY_API_KEY")) return "perplexity";
  if (envKey("ANTHROPIC_API_KEY")) return "claude";
  if (envKey("OPENAI_API_KEY")) return "openai";
  if (envKey("GEMINI_API_KEY")) return "gemini";
  if (envKey("BRAVE_API_KEY")) return "brave_serp";
  if (envKey("BING_API_KEY")) return "bing_serp";
  return null;
}

async function runEngine(
  engine: Engine,
  query: string,
  maxResults: number,
  perplexityModel?: string,
): Promise<AdapterResult> {
  switch (engine) {
    case "perplexity":
      return perplexitySearch(query, maxResults, perplexityModel);
    case "claude":
      return claudeSearch(query, maxResults);
    case "openai":
      return openaiSearch(query, maxResults);
    case "gemini":
      return geminiSearch(query, maxResults);
    case "bing_serp":
      return bingSearch(query, maxResults);
    case "brave_serp":
      return braveSearch(query, maxResults);
    case "google_ai_mode":
      return googleAiModeSearch(query, maxResults);
    case "auto":
      throw new Error("auto engine should be resolved before runEngine");
  }
}

export async function checkCitations(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const requested: Engine = parsed.engine;

  let engine: Engine;
  if (requested === "auto") {
    const picked = pickAutoEngine();
    if (!picked) {
      throw new ToolFetchError({
        type: "no_engine_available",
        message:
          "No engine API key configured. Set one of: PERPLEXITY_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, BING_API_KEY.",
      });
    }
    engine = picked;
  } else {
    engine = requested;
  }

  const engineKey = engine as Exclude<Engine, "auto">;
  const surface: Surface = ENGINE_SURFACE[engineKey];
  const interpretation_note = ENGINE_INTERPRETATION_NOTE[engineKey];

  const cached = await getCitations(parsed.query, engine);
  if (cached) {
    return {
      query: parsed.query,
      engine,
      surface,
      interpretation_note,
      fetched_at: cached.fetched_at,
      citations: cached.citations.slice(0, parsed.max_results),
      raw_answer: cached.raw_answer,
      cached: true,
    };
  }

  const result = await runEngine(engine, parsed.query, parsed.max_results, parsed.perplexity_model);
  const fetched_at = new Date().toISOString();

  await putCitations({
    type: "citation_check",
    engine,
    query: parsed.query,
    fetched_at,
    citations: result.citations,
    raw_answer: result.raw_answer,
  });

  return {
    query: parsed.query,
    engine,
    surface,
    interpretation_note,
    fetched_at,
    citations: result.citations,
    raw_answer: result.raw_answer,
    cached: false,
  };
}
