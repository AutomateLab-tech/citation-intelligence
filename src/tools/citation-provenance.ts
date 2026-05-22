import { z } from "zod";
import { envKey } from "../lib/config.js";
import { checkCitations } from "./check-citations.js";
import { log } from "../lib/log.js";
import type { Engine } from "../types.js";
import { ENGINE_SURFACE, ENGINE_INTERPRETATION_NOTE } from "../types.js";

export const citationProvenanceInputSchema = {
  query: z.string().min(1).describe("Search query to fan out across multiple engines."),
  engines: z
    .array(z.enum(["perplexity", "claude", "openai", "gemini", "google_ai_mode", "bing_serp", "brave_serp"]))
    .min(1)
    .max(7)
    .optional()
    .describe(
      "Engines to query. If omitted, uses all LLM engines with a configured API key " +
      "(perplexity, claude, openai, gemini, google_ai_mode). " +
      "Include bing_serp/brave_serp only when you explicitly want web_rank comparison."
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("Max citations per engine."),
};

const inputSchema = z.object(citationProvenanceInputSchema);

/** Returns only LLM engines by default (no web_rank) — consistent with citation provenance intent */
function availableEngines(): Engine[] {
  const list: Engine[] = [];
  if (envKey("SERPAPI_KEY")) list.push("google_ai_mode");
  if (envKey("PERPLEXITY_API_KEY")) list.push("perplexity");
  if (envKey("ANTHROPIC_API_KEY")) list.push("claude");
  if (envKey("OPENAI_API_KEY")) list.push("openai");
  if (envKey("GEMINI_API_KEY")) list.push("gemini");
  return list;
}

export async function citationProvenance(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  log.debug("citation_provenance start", { query: parsed.query });

  const engines: Engine[] = parsed.engines ?? availableEngines();
  if (engines.length === 0) {
    return {
      query: parsed.query,
      fetched_at: new Date().toISOString(),
      engines: [],
      per_url: [],
      consensus: [],
      note:
        "No engine API keys configured. Set at least one of PERPLEXITY_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, BRAVE_API_KEY, BING_API_KEY.",
    };
  }

  type EngineRun = {
    engine: Engine;
    ok: boolean;
    urls: string[];
    error?: string;
  };

  const runs: EngineRun[] = await Promise.all(
    engines.map(async (engine): Promise<EngineRun> => {
      try {
        const res = await checkCitations({
          query: parsed.query,
          engine,
          max_results: parsed.max_results,
        });
        return { engine, ok: true, urls: res.citations.map((c) => c.url) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { engine, ok: false, urls: [], error: msg };
      }
    }),
  );

  // Per-URL cross-engine matrix.
  const okRuns = runs.filter((r) => r.ok);
  const urlSet = new Set<string>();
  for (const r of okRuns) for (const u of r.urls) urlSet.add(u);

  const perUrl = [...urlSet]
    .map((url) => {
      const citedBy = okRuns.filter((r) => r.urls.includes(url)).map((r) => r.engine);
      return {
        url,
        cited_by: citedBy,
        engine_count: citedBy.length,
      };
    })
    .sort((a, b) => b.engine_count - a.engine_count || a.url.localeCompare(b.url));

  const consensus = perUrl.filter((p) => p.engine_count === okRuns.length && okRuns.length > 1);

  return {
    query: parsed.query,
    fetched_at: new Date().toISOString(),
    engines: runs.map((r) => ({
      engine: r.engine,
      surface: ENGINE_SURFACE[r.engine as Exclude<Engine, "auto">],
      interpretation_note: ENGINE_INTERPRETATION_NOTE[r.engine as Exclude<Engine, "auto">],
      ok: r.ok,
      citations: r.urls.length,
      error: r.error,
    })),
    engines_queried: runs.length,
    engines_succeeded: okRuns.length,
    per_url: perUrl,
    consensus_urls: consensus.map((c) => c.url),
    summary: {
      total_unique_urls: perUrl.length,
      consensus_count: consensus.length,
      median_engines_per_url:
        perUrl.length > 0
          ? perUrl.map((p) => p.engine_count).sort((a, b) => a - b)[Math.floor(perUrl.length / 2)]
          : 0,
    },
    note:
      "consensus_urls = URLs cited by ALL succeeding engines (requires >=2 engines). High engine_count = strong cross-engine signal; engine_count=1 = engine-specific citation.",
  };
}
