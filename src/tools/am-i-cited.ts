import { z } from "zod";
import { checkCitations } from "./check-citations.js";
import { ToolFetchError } from "../lib/fetch.js";
import { envKey } from "../lib/config.js";
import type { Engine } from "../types.js";
import { ENGINE_SURFACE, ENGINE_INTERPRETATION_NOTE } from "../types.js";

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
      "LLM engine to check for citations. 'auto' runs all available LLM engines and returns per-engine breakdown + cross-engine consensus. " +
      "Pin to a specific engine to reduce cost. 'bing_serp' and 'brave_serp' measure web rank, not LLM citations — use check_citations for those."
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

/** LLM engines available for auto-multi mode (no web_rank engines). */
function availableLlmEngines(): Engine[] {
  const list: Engine[] = [];
  if (envKey("SERPAPI_KEY")) list.push("google_ai_mode");
  if (envKey("PERPLEXITY_API_KEY")) list.push("perplexity");
  if (envKey("ANTHROPIC_API_KEY")) list.push("claude");
  if (envKey("OPENAI_API_KEY")) list.push("openai");
  if (envKey("GEMINI_API_KEY")) list.push("gemini");
  return list;
}

type PerQueryResult = {
  query: string;
  cited: boolean;
  rank?: number;
  matching_urls: string[];
};

async function runEngineForDomain(
  engine: Engine,
  queries: readonly string[],
  needle: string,
): Promise<{ engine: Engine; results: PerQueryResult[] }> {
  const results: PerQueryResult[] = [];
  for (const query of queries) {
    const res = await checkCitations({ query, engine, max_results: 20 });
    if (res.engine === "brave_serp") {
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
  return { engine, results };
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
        `to measure web rank instead, or set engine='auto' to fan across all LLM engines.`,
    });
  }

  const needle = normalizeDomain(parsed.domain);
  const fetched_at = new Date().toISOString();

  // Multi-engine mode: when engine='auto', fan across all available LLM engines.
  if (parsed.engine === "auto") {
    const engines = availableLlmEngines();
    if (engines.length === 0) {
      return {
        domain: parsed.domain,
        mode: "multi_engine",
        fetched_at,
        engines: [],
        per_engine: [],
        consensus: { queries_cited_by_all: 0, queries_total: parsed.queries.length, consensus_rate: 0 },
        note: "No LLM engine API keys configured. Set at least one of SERPAPI_KEY, PERPLEXITY_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY.",
      };
    }

    // Run all engines in parallel.
    const engineRuns = await Promise.all(
      engines.map((e) => runEngineForDomain(e, parsed.queries, needle).catch((err) => ({
        engine: e,
        results: [] as PerQueryResult[],
        error: err instanceof Error ? err.message : String(err),
      }))),
    );

    const perEngine = engineRuns.map((run) => {
      const engineKey = run.engine as Exclude<Engine, "auto">;
      const cited = run.results.filter((r) => r.cited);
      const ranks = cited.map((r) => r.rank).filter((r): r is number => r !== undefined);
      return {
        engine: run.engine,
        surface: ENGINE_SURFACE[engineKey],
        interpretation_note: ENGINE_INTERPRETATION_NOTE[engineKey],
        ok: !("error" in run),
        error: "error" in run ? run.error : undefined,
        results: run.results,
        summary: {
          queries_total: parsed.queries.length,
          queries_cited: cited.length,
          citation_rate: parsed.queries.length > 0 ? cited.length / parsed.queries.length : 0,
          average_rank: ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : undefined,
        },
      };
    });

    // Cross-engine consensus: queries cited by ALL succeeding engines.
    const okRuns = perEngine.filter((r) => r.ok && r.results.length > 0);
    const consensusQueries = parsed.queries.filter((q) =>
      okRuns.length > 0 && okRuns.every((r) => r.results.find((qr) => qr.query === q)?.cited),
    );

    return {
      domain: parsed.domain,
      mode: "multi_engine",
      fetched_at,
      engines: perEngine.map((r) => ({
        engine: r.engine,
        surface: r.surface,
        ok: r.ok,
        queries_cited: r.summary.queries_cited,
        citation_rate: r.summary.citation_rate,
      })),
      per_engine: perEngine,
      consensus: {
        queries_cited_by_all: consensusQueries.length,
        queries_total: parsed.queries.length,
        consensus_rate: parsed.queries.length > 0 ? consensusQueries.length / parsed.queries.length : 0,
        queries: consensusQueries,
      },
      note:
        "consensus = queries where domain is cited by ALL succeeding engines. " +
        "High consensus_rate = strong multi-engine signal. Low = engine-specific citation.",
    };
  }

  // Single-engine mode: explicit engine specified.
  const { results } = await runEngineForDomain(parsed.engine, parsed.queries, needle);
  const engineKey = parsed.engine as Exclude<Engine, "auto">;

  const cited = results.filter((r) => r.cited);
  const ranks = cited.map((r) => r.rank).filter((r): r is number => r !== undefined);
  const average_rank =
    ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : undefined;

  return {
    domain: parsed.domain,
    mode: "single_engine",
    engine: parsed.engine,
    surface: ENGINE_SURFACE[engineKey],
    interpretation_note: ENGINE_INTERPRETATION_NOTE[engineKey],
    fetched_at,
    results,
    summary: {
      queries_total: parsed.queries.length,
      queries_cited: cited.length,
      citation_rate: parsed.queries.length > 0 ? cited.length / parsed.queries.length : 0,
      average_rank,
    },
  };
}
