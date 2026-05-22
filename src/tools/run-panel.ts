import { z } from "zod";
import { amICited } from "./am-i-cited.js";
import { loadPanel, appendSnapshot } from "../lib/panels.js";

export const runPanelInputSchema = {
  name: z
    .string()
    .min(1)
    .describe("Panel name previously saved via track_queries."),
  domain: z
    .string()
    .optional()
    .describe("Override the panel's default domain for this run."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing_serp", "brave_serp", "google_ai_mode", "auto"])
    .default("auto")
    .describe("AI engine to query. Use bing_serp/brave_serp for web_rank comparison only — am_i_cited will refuse them."),
};

const inputSchema = z.object(runPanelInputSchema);

export async function runPanel(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const panel = await loadPanel(parsed.name);
  if (!panel) {
    return { error: `panel '${parsed.name}' not found` };
  }
  const domain = parsed.domain ?? panel.domain;
  if (!domain) {
    return {
      error:
        "no domain set on panel and none passed; specify domain on the panel or per call",
    };
  }

  const CHUNK = 20;
  const chunks: string[][] = [];
  for (let i = 0; i < panel.queries.length; i += CHUNK) {
    chunks.push(panel.queries.slice(i, i + CHUNK));
  }

  const perQuery: Array<{ query: string; cited: boolean; rank?: number; matching_urls: string[] }> = [];
  let engineUsed = parsed.engine;
  const fetchedAt = new Date().toISOString();
  for (const queries of chunks) {
    const res = await amICited({ domain, queries, engine: parsed.engine });
    engineUsed = res.engine;
    perQuery.push(...res.results);
  }

  const queriesCited = perQuery.filter((q) => q.cited).length;
  const snapshot = {
    panel: panel.name,
    domain,
    engine: engineUsed,
    taken_at: fetchedAt,
    per_query: perQuery,
    summary: {
      queries_total: perQuery.length,
      queries_cited: queriesCited,
      citation_rate: perQuery.length > 0 ? queriesCited / perQuery.length : 0,
    },
  };
  const path = await appendSnapshot(snapshot);
  return { saved_to: path, snapshot };
}
