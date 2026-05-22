import { z } from "zod";
import { envKey } from "../lib/config.js";
import { checkCitations } from "./check-citations.js";
import { log } from "../lib/log.js";
import type { Engine } from "../types.js";

export const canonicalCompetitorSetInputSchema = {
  query: z
    .string()
    .min(1)
    .describe("Search query to fan out across engines."),
  engines: z
    .array(z.enum(["perplexity", "claude", "openai", "gemini", "google_ai_mode", "bing_serp", "brave_serp"]))
    .min(1)
    .max(7)
    .optional()
    .describe("Engines to query. If omitted, uses all LLM engines with a configured API key (google_ai_mode, perplexity, claude, openai, gemini). Include bing_serp/brave_serp only for web_rank comparison."),
  top_n: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Max competitor domains to return."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("Max citations per engine."),
  exclude_domains: z
    .array(z.string())
    .max(50)
    .optional()
    .describe(
      "Domains to filter out (e.g. your own brand, Wikipedia, Reddit). Suffix-match.",
    ),
};

const inputSchema = z.object(canonicalCompetitorSetInputSchema);

// Crude registered-domain extractor. Strips www. and handles the common
// two-label suffixes (co.uk, com.au, com.br, etc.). Good enough for grouping
// competitor citations; not RFC-correct.
const TWO_LABEL_TLDS = new Set([
  "co.uk",
  "co.jp",
  "co.kr",
  "co.in",
  "co.nz",
  "co.za",
  "com.au",
  "com.br",
  "com.mx",
  "com.tr",
  "com.sg",
  "com.tw",
  "com.hk",
  "com.cn",
  "com.ar",
  "ac.uk",
  "gov.uk",
  "gov.au",
  "net.au",
  "org.uk",
  "or.jp",
  "ne.jp",
  "ac.jp",
]);

function registeredDomain(host: string): string {
  const lower = host.toLowerCase().replace(/^www\./, "");
  const parts = lower.split(".");
  if (parts.length <= 2) return lower;
  const tail2 = parts.slice(-2).join(".");
  const tail3 = parts.slice(-3).join(".");
  if (TWO_LABEL_TLDS.has(tail2)) return tail3;
  return tail2;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function availableEngines(): Engine[] {
  const list: Engine[] = [];
  if (envKey("SERPAPI_KEY")) list.push("google_ai_mode");
  if (envKey("PERPLEXITY_API_KEY")) list.push("perplexity");
  if (envKey("ANTHROPIC_API_KEY")) list.push("claude");
  if (envKey("OPENAI_API_KEY")) list.push("openai");
  if (envKey("GEMINI_API_KEY")) list.push("gemini");
  // bing_serp/brave_serp not included by default — they measure web rank, not LLM citations
  return list;
}

export async function canonicalCompetitorSet(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  log.debug("canonical_competitor_set start", { query: parsed.query });

  const engines: Engine[] = parsed.engines ?? availableEngines();
  if (engines.length === 0) {
    return {
      query: parsed.query,
      fetched_at: new Date().toISOString(),
      engines: [],
      domains: [],
      note:
        "No engine API keys configured. Set at least one of PERPLEXITY_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, BRAVE_API_KEY, BING_API_KEY.",
    };
  }

  const excludeRegistered = (parsed.exclude_domains ?? []).map((d) =>
    registeredDomain(d.replace(/^https?:\/\//, "").replace(/\/.*/, "")),
  );

  type EngineRun = {
    engine: Engine;
    ok: boolean;
    citations: Array<{ url: string; rank: number; title?: string }>;
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
        return { engine, ok: true, citations: res.citations };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { engine, ok: false, citations: [], error: msg };
      }
    }),
  );

  const okRuns = runs.filter((r) => r.ok);

  type DomainAggregate = {
    domain: string;
    total_citations: number;
    best_rank: number;
    engines: Map<Engine, { count: number; best_rank: number; sample_urls: Set<string> }>;
    urls: Map<string, number>;
  };

  const agg = new Map<string, DomainAggregate>();
  for (const r of okRuns) {
    for (const c of r.citations) {
      const host = hostOf(c.url);
      if (!host) continue;
      const dom = registeredDomain(host);
      if (excludeRegistered.some((d) => dom === d || dom.endsWith(`.${d}`))) continue;

      let entry = agg.get(dom);
      if (!entry) {
        entry = {
          domain: dom,
          total_citations: 0,
          best_rank: c.rank,
          engines: new Map(),
          urls: new Map(),
        };
        agg.set(dom, entry);
      }
      entry.total_citations += 1;
      entry.best_rank = Math.min(entry.best_rank, c.rank);

      let perEngine = entry.engines.get(r.engine);
      if (!perEngine) {
        perEngine = { count: 0, best_rank: c.rank, sample_urls: new Set<string>() };
        entry.engines.set(r.engine, perEngine);
      }
      perEngine.count += 1;
      perEngine.best_rank = Math.min(perEngine.best_rank, c.rank);
      perEngine.sample_urls.add(c.url);

      entry.urls.set(c.url, (entry.urls.get(c.url) ?? 0) + 1);
    }
  }

  const ranked = [...agg.values()]
    .map((e) => ({
      domain: e.domain,
      total_citations: e.total_citations,
      engine_count: e.engines.size,
      best_rank: e.best_rank,
      by_engine: [...e.engines.entries()]
        .map(([engine, v]) => ({
          engine,
          citations: v.count,
          best_rank: v.best_rank,
          sample_urls: [...v.sample_urls].slice(0, 3),
        }))
        .sort((a, b) => b.citations - a.citations),
      top_urls: [...e.urls.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([url, count]) => ({ url, count })),
    }))
    .sort((a, b) => {
      // Primary: cited by more engines (cross-engine consensus).
      if (b.engine_count !== a.engine_count) return b.engine_count - a.engine_count;
      // Secondary: total citations.
      if (b.total_citations !== a.total_citations) return b.total_citations - a.total_citations;
      // Tertiary: best rank (lower = earlier).
      return a.best_rank - b.best_rank;
    });

  return {
    query: parsed.query,
    fetched_at: new Date().toISOString(),
    engines: runs.map((r) => ({
      engine: r.engine,
      ok: r.ok,
      citations: r.citations.length,
      error: r.error,
    })),
    engines_queried: runs.length,
    engines_succeeded: okRuns.length,
    excluded_domains: excludeRegistered,
    total_unique_domains: ranked.length,
    top_n: parsed.top_n,
    domains: ranked.slice(0, parsed.top_n),
    note:
      "domains aggregated by registered domain (eTLD+1 approximation). engine_count = how many engines cited this domain (cross-engine consensus). by_engine breaks down per-engine citation counts and best rank. Order: engine_count desc, then total_citations desc, then best_rank asc.",
  };
}
