export type Engine =
  | "perplexity"
  | "claude"
  | "openai"
  | "gemini"
  | "bing"
  | "auto";

export type Citation = {
  url: string;
  title?: string;
  rank: number;
  snippet?: string;
};

export type NormalizedCitationResult = {
  query: string;
  engine: Engine;
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
  | { type: "missing_key"; engine: Engine; env_var: string; message: string }
  | { type: "no_engine_available"; message: string }
  | { type: "fetch_error"; url: string; message: string; status?: number }
  | { type: "rate_limited"; engine: Engine; message: string }
  | { type: "invalid_input"; field: string; message: string };
