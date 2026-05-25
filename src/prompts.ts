// Prompt templates exposed via MCP. Each prompt returns one or more user
// messages that guide the calling LLM to run a coherent sequence of this
// server's tools - so a client doesn't have to know which tools to chain.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type GetPromptResult = {
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: { type: "text"; text: string };
  }>;
};

function userMessage(text: string): GetPromptResult["messages"][number] {
  return { role: "user", content: { type: "text", text } };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "audit.citation_readiness",
    {
      title: "Audit citation readiness",
      description:
        "Score a URL's citation likelihood across public signals, then deep-validate its schema.org markup, then list the top fixes. Uses citations.predict + audit.schema.",
      argsSchema: {
        url: z.string().describe("The page URL to audit."),
      },
    },
    ({ url }): GetPromptResult => ({
      description: `Citation readiness audit for ${url}`,
      messages: [
        userMessage(
          [
            `Audit the citation readiness of ${url}.`,
            ``,
            `1. Call citations.predict with url="${url}" to get the public-signal score, grade, and ranked fixes.`,
            `2. Call audit.schema with url="${url}" to deep-validate any JSON-LD / microdata and surface missing required fields.`,
            `3. Summarize the result as:`,
            `   - one-sentence verdict`,
            `   - top 3 fixes (by impact)`,
            `   - quick-wins (anything cheap that lifts score by >=5)`,
            ``,
            `Do not call any other tools. Do not invent fixes that citations.predict didn't surface.`,
          ].join("\n"),
        ),
      ],
    }),
  );

  server.registerPrompt(
    "audit.competitor_snapshot",
    {
      title: "Competitor citation snapshot",
      description:
        "Build a cross-engine competitor map for a query and compare your own URL to the top-cited competitors. Uses competitors.canonical_set + competitors.compete.",
      argsSchema: {
        query: z.string().describe("The search query to analyze."),
        your_url: z
          .string()
          .optional()
          .describe("Your URL to benchmark against the competitor set. Optional."),
      },
    },
    ({ query, your_url }): GetPromptResult => ({
      description: `Competitor snapshot for "${query}"`,
      messages: [
        userMessage(
          [
            `Build a competitor citation snapshot for the query: "${query}".`,
            ``,
            `1. Call competitors.canonical_set with query="${query}" to get the top cited domains across engines (sorted by cross-engine consensus).`,
            your_url
              ? `2. Call competitors.compete with query="${query}" and your_url="${your_url}" to score your URL against the top competitors.`
              : `2. (Skipped - no your_url provided.) If you want a head-to-head score, ask the user for the URL to benchmark.`,
            `3. Report:`,
            `   - 3-5 sentence narrative: who dominates this query, how much consensus, where the gaps are`,
            `   - top 5 competitor domains with engine_count + sample URLs`,
            your_url
              ? `   - your URL's score vs the competitor average, and the largest signal gap`
              : `   - n/a (no your_url)`,
            ``,
            `Do not call citations.check directly - the two tools above already fan out.`,
          ].join("\n"),
        ),
      ],
    }),
  );

  server.registerPrompt(
    "audit.crawler_checkup",
    {
      title: "AI crawler access checkup",
      description:
        "Verify that all major AI crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot, Google-Extended, etc.) can fetch a URL and aren't being blocked at robots.txt or the server. Uses audit.crawler_access.",
      argsSchema: {
        url: z.string().describe("The page URL to check crawler access for."),
      },
    },
    ({ url }): GetPromptResult => ({
      description: `AI crawler access check for ${url}`,
      messages: [
        userMessage(
          [
            `Check whether AI crawlers can fetch ${url}.`,
            ``,
            `1. Call audit.crawler_access with url="${url}" (default bot list, fetch_with_ua=true).`,
            `2. Report:`,
            `   - which bots are 'allowed' vs 'blocked'`,
            `   - any robots.txt rules that block citation-relevant bots`,
            `   - any UA-based gating (allowed in robots, but the server 4xx/5xx'd under the bot's UA)`,
            `   - one concrete action item per blocked bot (e.g. "remove Disallow: / for GPTBot from robots.txt")`,
            ``,
            `If any consumer-facing AI engine bot (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot) is blocked, surface it as a citation-blocking risk.`,
          ].join("\n"),
        ),
      ],
    }),
  );

  server.registerPrompt(
    "audit.gap_analysis",
    {
      title: "Find queries with high Google rank but no AI citation",
      description:
        "Surface queries where a domain ranks well on Google but isn't cited by AI engines - the closest editorial wins. Uses signals.gsc_gap.",
      argsSchema: {
        domain: z.string().describe("Your domain, e.g. 'automatelab.tech'."),
        days: z
          .string()
          .optional()
          .describe("Window in days for GSC data (default: 28)."),
      },
    },
    ({ domain, days }): GetPromptResult => ({
      description: `Citation gap analysis for ${domain}`,
      messages: [
        userMessage(
          [
            `Find queries where ${domain} ranks well on Google but isn't cited by AI.`,
            ``,
            `1. Call signals.gsc_gap with domain="${domain}"${days ? ` and days=${days}` : ""}.`,
            `2. Report the top 10 gap queries (rank <=10 on Google AND not cited by AI), with:`,
            `   - the query`,
            `   - Google rank + impressions`,
            `   - the AI engine that should have cited it but didn't`,
            `3. For the top 3, suggest the page-level fix most likely to flip the AI citation (refer to citations.predict signals).`,
            ``,
            `These are the highest-leverage editorial targets: traffic interest already proven, citation just missing.`,
          ].join("\n"),
        ),
      ],
    }),
  );

  server.registerPrompt(
    "audit.sitemap_coverage",
    {
      title: "Sitemap citation coverage review",
      description:
        "Map a sitemap against the citation cache to see which URLs have been cited and which haven't. Identifies systemic visibility gaps. Uses audit.sitemap_map.",
      argsSchema: {
        sitemap_url: z.string().describe("Sitemap URL (sitemap.xml or sitemap index)."),
      },
    },
    ({ sitemap_url }): GetPromptResult => ({
      description: `Sitemap citation coverage for ${sitemap_url}`,
      messages: [
        userMessage(
          [
            `Review citation coverage across the sitemap at ${sitemap_url}.`,
            ``,
            `1. Call audit.sitemap_map with sitemap_url="${sitemap_url}".`,
            `2. Report:`,
            `   - coverage_pct (mapped/total)`,
            `   - top 5 most-cited URLs (by engine_count + citation_count)`,
            `   - top 10 unmapped URLs that look high-value (judge by URL slug)`,
            `3. Recommend 3 unmapped URLs to prioritize for citation-readiness audits next.`,
            ``,
            `Cache must be primed first - if citations_in_cache is 0, tell the user to run citations.check or run_panel for representative queries before re-running this.`,
          ].join("\n"),
        ),
      ],
    }),
  );
}
