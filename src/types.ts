export type Engine =
  | "perplexity"
  | "claude"
  | "openai"
  | "gemini"
  | "bing_serp"
  | "brave_serp"
  | "brave"
  | "google_ai_mode"
  | "auto";

/** How the data was collected — lets callers understand what the result actually measures. */
export type Surface =
  | "consumer_scrape" // proxied through a real consumer-facing LLM search product
  | "api_proxy"       // API call to a search-enabled LLM (may differ from consumer product)
  | "web_rank"        // traditional web search ranking (not LLM citation)
  | "static_signal";  // static / offline signal (embeddings, Wikipedia, etc.)

export const ENGINE_SURFACE: Record<Exclude<Engine, "auto">, Surface> = {
  perplexity: "consumer_scrape",
  claude: "api_proxy",
  openai: "api_proxy",
  gemini: "api_proxy",
  google_ai_mode: "consumer_scrape",
  bing_serp: "web_rank",
  brave_serp: "web_rank",
  brave: "web_rank",
};

/**
 * One-line note explaining what each engine result actually measures vs the
 * consumer product. Included in every tool response as `interpretation_note`.
 */
export const ENGINE_INTERPRETATION_NOTE: Record<Exclude<Engine, "auto">, string> = {
  google_ai_mode:
    "SerpAPI scrape of the real Google AI Overview — pixel-accurate to what google.com users see.",
  perplexity:
    "sonar-pro API with a consumer-equivalent system prompt. Real perplexity.ai users may see sonar-reasoning-pro with multi-turn follow-ups.",
  openai:
    "gpt-4o + web_search_preview tool via the Responses API. Real chatgpt.com users get gpt-4o + SearchGPT with different ranking and UI-level re-scoring.",
  claude:
    "claude-sonnet-4-7 API with web_search tool (max 5 uses). Real claude.ai users get a different model tier and citation UI.",
  gemini:
    "gemini-2.5-pro API with google_search grounding. Real gemini.google.com uses the same grounding index but different re-ranking.",
  bing_serp:
    "Bing Web Search API — traditional SERP rank, NOT LLM citation behavior.",
  brave_serp:
    "Brave Search API — traditional SERP rank, NOT LLM citation behavior.",
  brave:
    "Brave Search API — traditional SERP rank, NOT LLM citation behavior.",
};

export type Citation = {
  url: string;
  title?: string;
  rank: number;
  snippet?: string;
};

export type NormalizedCitationResult = {
  query: string;
  engine: Engine;
  surface: Surface;
  fetched_at: string;
  citations: Citation[];
  raw_answer?: string;
  cached: boolean;
};

export type AdapterResult = {
  citations: Citation[];
  raw_answer?: string;
};

export type ToolError =
  | { type: "missing_key"; engine: Engine | "google_ai_mode"; env_var: string; message: string }
  | { type: "no_engine_available"; message: string }
  | { type: "fetch_error"; url: string; message: string; status?: number }
  | { type: "rate_limited"; engine: Engine; message: string }
  | { type: "invalid_input"; field: string; message: string };
