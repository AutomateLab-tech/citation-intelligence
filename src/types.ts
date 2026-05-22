export type Engine =
  | "perplexity"
  | "claude"
  | "openai"
  | "gemini"
  | "bing_serp"
  | "brave_serp"
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
