#!/usr/bin/env node
// Citation Intelligence MCP - entrypoint.
// All logging goes to stderr. stdout is reserved for JSON-RPC transport.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  checkCitations,
  checkCitationsInputSchema,
} from "./tools/check-citations.js";
import { amICited, amICitedInputSchema } from "./tools/am-i-cited.js";
import { aiOverview, aiOverviewInputSchema } from "./tools/ai-overview.js";
import { citedFor, citedForInputSchema } from "./tools/cited-for.js";
import {
  predictCitation,
  predictCitationInputSchema,
} from "./tools/predict-citation.js";
import { ToolFetchError } from "./lib/fetch.js";
import type { ToolError } from "./types.js";

const server = new McpServer({
  name: "@automatelab/citation-intelligence",
  version: "0.1.0",
});

type ToolResponse = {
  content: [{ type: "text"; text: string }];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function toolError(err: ToolError): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify(err, null, 2) }],
    isError: true,
  };
}

function wrapHandler<T>(handler: () => Promise<T>): Promise<ToolResponse> {
  return handler()
    .then((result): ToolResponse => ({
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result as unknown as Record<string, unknown>,
    }))
    .catch((err: unknown): ToolResponse => {
      if (err instanceof ToolFetchError) return toolError(err.toolError);
      const message = err instanceof Error ? err.message : String(err);
      console.error("[citation-intelligence]", message);
      return toolError({ type: "fetch_error", url: "", message });
    });
}

server.registerTool(
  "check_citations",
  {
    description:
      "Return URLs cited by an AI engine (Perplexity, Claude, ChatGPT, Gemini, or Bing) for a query. Use this when an agent or user wants to see what sources an AI search engine grounds answers on. Requires at least one engine API key; auto-picks the first available.",
    inputSchema: checkCitationsInputSchema,
  },
  (args) => wrapHandler(() => checkCitations(args)),
);

server.registerTool(
  "am_i_cited",
  {
    description:
      "Check whether a domain is cited by an AI engine across a cluster of queries. Returns per-query presence, rank, and a citation-rate summary. Use to measure visibility for a brand, product, or content site in AI search.",
    inputSchema: amICitedInputSchema,
  },
  (args) => wrapHandler(() => amICited(args)),
);

server.registerTool(
  "ai_overview",
  {
    description:
      "Check whether Google shows an AI Overview for a query, and which URLs it cites. Uses SerpAPI (free tier: 100/month). Set SERPAPI_KEY.",
    inputSchema: aiOverviewInputSchema,
  },
  (args) => wrapHandler(() => aiOverview(args)),
);

server.registerTool(
  "cited_for",
  {
    description:
      "List queries that the given domain has been cited for, served from the local cache. Build up a corpus by calling check_citations or am_i_cited first; cited_for queries it without spending API budget.",
    inputSchema: citedForInputSchema,
  },
  (args) => wrapHandler(() => citedFor(args)),
);

server.registerTool(
  "predict_citation",
  {
    description:
      "Score citation likelihood for a URL from public signals (Wikipedia link presence, schema.org markup, /llms.txt, GitHub and Reddit references, canonical hygiene, HTTPS). No LLM fired - all heuristic. Returns 0-100 score, grade, signal breakdown, and ranked fixes.",
    inputSchema: predictCitationInputSchema,
  },
  (args) => wrapHandler(() => predictCitation(args)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  "[citation-intelligence] server ready on stdio (tools: check_citations, am_i_cited, ai_overview, cited_for, predict_citation)",
);
