#!/usr/bin/env node
// Citation Intelligence MCP - entrypoint.
// All logging goes to stderr. stdout is reserved for JSON-RPC transport.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Read version from package.json at runtime so the handshake string and
// the npm-published version never drift. dist/index.js sits at <pkg>/dist/.
const SERVER_VERSION: string = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
).version;

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
import { trackQueries, trackQueriesInputSchema } from "./tools/track-queries.js";
import { runPanel, runPanelInputSchema } from "./tools/run-panel.js";
import { citationTrend, citationTrendInputSchema } from "./tools/citation-trend.js";
import { compareDomains, compareDomainsInputSchema } from "./tools/compare-domains.js";
import { wikipediaMentions, wikipediaMentionsInputSchema } from "./tools/wikipedia-mentions.js";
import { auditSitemap, auditSitemapInputSchema } from "./tools/audit-sitemap.js";
import { gscCitationGap, gscCitationGapInputSchema } from "./tools/gsc-citation-gap.js";
import { bingCitationGap, bingCitationGapInputSchema } from "./tools/bing-citation-gap.js";
import { competeForQuery, competeForQueryInputSchema } from "./tools/compete-for-query.js";
import { citationFreshnessScore, citationFreshnessScoreInputSchema } from "./tools/citation-freshness-score.js";
import { citedForDiff, citedForDiffInputSchema } from "./tools/cited-for-diff.js";
import { schemaAudit, schemaAuditInputSchema } from "./tools/schema-audit.js";
import { llmsTxtGenerator, llmsTxtGeneratorInputSchema } from "./tools/llms-txt-generator.js";
import { answerBoxPosition, answerBoxPositionInputSchema } from "./tools/answer-box-position.js";
import { citationProvenance, citationProvenanceInputSchema } from "./tools/citation-provenance.js";
import { citationEvidence, citationEvidenceInputSchema } from "./tools/citation-evidence.js";
import { crawlerAccessAudit, crawlerAccessAuditInputSchema } from "./tools/crawler-access-audit.js";
import { sitemapCitationMap, sitemapCitationMapInputSchema } from "./tools/sitemap-citation-map.js";
import { canonicalCompetitorSet, canonicalCompetitorSetInputSchema } from "./tools/canonical-competitor-set.js";
import { structuredDataRepair, structuredDataRepairInputSchema } from "./tools/structured-data-repair.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { ToolFetchError } from "./lib/fetch.js";
import { log } from "./lib/log.js";
import type { ToolError } from "./types.js";
import {
  checkCitationsOutputShape,
  amICitedOutputShape,
  aiOverviewOutputShape,
  citedForOutputShape,
  predictCitationOutputShape,
  trackQueriesOutputShape,
  runPanelOutputShape,
  citationTrendOutputShape,
  compareDomainsOutputShape,
  wikipediaMentionsOutputShape,
  auditSitemapOutputShape,
  competeForQueryOutputShape,
  citationFreshnessScoreOutputShape,
  citedForDiffOutputShape,
  gscCitationGapOutputShape,
  bingCitationGapOutputShape,
  schemaAuditOutputShape,
  llmsTxtGeneratorOutputShape,
  answerBoxPositionOutputShape,
  citationProvenanceOutputShape,
  citationEvidenceOutputShape,
  crawlerAccessAuditOutputShape,
  sitemapCitationMapOutputShape,
  canonicalCompetitorSetOutputShape,
  structuredDataRepairOutputShape,
} from "./output-schemas.js";

const server = new McpServer({
  name: "@automatelab/citation-intelligence",
  version: SERVER_VERSION,
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
      if (err instanceof ToolFetchError) {
        log.warn("tool returned ToolFetchError", err.toolError);
        return toolError(err.toolError);
      }
      const message = err instanceof Error ? err.message : String(err);
      log.error("unhandled tool exception", { message });
      return toolError({ type: "fetch_error", url: "", message });
    });
}

server.registerTool(
  "citations.check",
  {
    description:
      "Return URLs cited by an AI engine (Perplexity, Claude, ChatGPT, Gemini, or Bing) for a query. Use this when an agent or user wants to see what sources an AI search engine grounds answers on. Requires at least one engine API key; auto-picks the first available.",
    inputSchema: checkCitationsInputSchema,
    outputSchema: checkCitationsOutputShape,
    annotations: {
      title: "Check AI engine citations",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => checkCitations(args)),
);

server.registerTool(
  "domain.am_i_cited",
  {
    description:
      "Check whether a domain is cited by an AI engine across a cluster of queries. Returns per-query presence, rank, and a citation-rate summary. Use to measure visibility for a brand, product, or content site in AI search.",
    inputSchema: amICitedInputSchema,
    outputSchema: amICitedOutputShape,
    annotations: {
      title: "Check domain citation presence",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => amICited(args)),
);

server.registerTool(
  "signals.ai_overview",
  {
    description:
      "Check whether Google shows an AI Overview for a query, and which URLs it cites. Uses SerpAPI (free tier: 100/month). Set SERPAPI_KEY.",
    inputSchema: aiOverviewInputSchema,
    outputSchema: aiOverviewOutputShape,
    annotations: {
      title: "Check Google AI Overview presence",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => aiOverview(args)),
);

server.registerTool(
  "domain.cited_for",
  {
    description:
      "List queries that the given domain has been cited for, served from the local cache. Build up a corpus by calling check_citations or am_i_cited first; cited_for queries it without spending API budget.",
    inputSchema: citedForInputSchema,
    outputSchema: citedForOutputShape,
    annotations: {
      title: "List cached queries domain was cited for",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  (args) => wrapHandler(() => citedFor(args)),
);

server.registerTool(
  "citations.predict",
  {
    description:
      "Score citation likelihood for a URL from public signals (Wikipedia link presence, schema.org markup, /llms.txt, GitHub and Reddit references, canonical hygiene, HTTPS). No LLM fired - all heuristic. Returns 0-100 score, grade, signal breakdown, and ranked fixes.",
    inputSchema: predictCitationInputSchema,
    outputSchema: predictCitationOutputShape,
    annotations: {
      title: "Predict citation likelihood for a URL",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => predictCitation(args)),
);

server.registerTool(
  "panel.track",
  {
    description:
      "Save, load, or list named query panels. A panel is a persisted set of queries you want to monitor over time (e.g. editorial-watchlist). Use action=save with queries[] to create, action=load to read, action=list to enumerate. Panels live under <config>/panels/<name>.json.",
    inputSchema: trackQueriesInputSchema,
    outputSchema: trackQueriesOutputShape,
    annotations: {
      title: "Save or load a query panel",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  (args) => wrapHandler(() => trackQueries(args)),
);

server.registerTool(
  "panel.run",
  {
    description:
      "Run a saved panel through am_i_cited and append a timestamped snapshot. Side effects: makes external API calls to the configured AI engine (costs API quota); writes one snapshot file to disk at <config>/snapshots/<panel>/<iso>.json. Requires at least one engine API key (same as am_i_cited). Returns per-query citation presence and a citation_rate summary for the run. Use panel.track to create a panel first; use citations.trend to read the accumulated trend after multiple runs.",
    inputSchema: runPanelInputSchema,
    outputSchema: runPanelOutputShape,
    annotations: {
      title: "Run panel and save snapshot",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => runPanel(args)),
);

server.registerTool(
  "citations.trend",
  {
    description:
      "Report citation rate over time for a panel from stored snapshots. Read-only; cache-only — makes no API calls to any AI engine and costs no API quota. Reads snapshot files from <config>/snapshots/<panel>/. Returns: snapshots[] (one entry per panel.run invocation, each with timestamp and citation_rate), plus per-query deltas (gained/lost/unchanged) comparing first vs last snapshot. Returns an empty series when no snapshots exist yet. No auth required. No rate limits. Use panel.run to accumulate snapshots first; use since to restrict the time window.",
    inputSchema: citationTrendInputSchema,
    outputSchema: citationTrendOutputShape,
    annotations: {
      title: "Report citation trend over time",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  (args) => wrapHandler(() => citationTrend(args)),
);

server.registerTool(
  "competitors.compare",
  {
    description:
      "Run predict_citation on 2-10 URLs and return a side-by-side signal table plus a list of signals where the URLs diverge. Use to compare your URL to top-cited competitors for the same query.",
    inputSchema: compareDomainsInputSchema,
    outputSchema: compareDomainsOutputShape,
    annotations: {
      title: "Compare citation signals across URLs",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => compareDomains(args)),
);

server.registerTool(
  "signals.wikipedia",
  {
    description:
      "List Wikipedia articles that reference the given domain. Read-only. One HTTPS GET to the Wikipedia API (en.wikipedia.org/w/api.php?action=query&list=exturlusage). No auth required; no API keys; no rate limits beyond Wikipedia's public API fair-use policy (~1 request/second). Returns article titles and URLs. Wikipedia backlinks are the highest-lift signal for LLM training corpora — a domain cited from Wikipedia is far more likely to appear in AI training data and citation pools. Use lang to query non-English Wikipedias.",
    inputSchema: wikipediaMentionsInputSchema,
    outputSchema: wikipediaMentionsOutputShape,
    annotations: {
      title: "Find Wikipedia articles citing a domain",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => wikipediaMentions(args)),
);

server.registerTool(
  "audit.sitemap",
  {
    description:
      "Fetch a sitemap.xml (or sitemap index) and run predict_citation on every URL. Returns results sorted worst-score-first. Surfaces systemic issues across a whole site in one pass. Zero engine keys needed.",
    inputSchema: auditSitemapInputSchema,
    outputSchema: auditSitemapOutputShape,
    annotations: {
      title: "Audit all URLs in a sitemap",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => auditSitemap(args)),
);

server.registerTool(
  "competitors.compete",
  {
    description:
      "End-to-end competitive snapshot for a single query. Calls check_citations to get the cited URLs, then runs compare_domains on your_url vs the top cited competitors. Returns your score, the average competitor score, and the gap.",
    inputSchema: competeForQueryInputSchema,
    outputSchema: competeForQueryOutputShape,
    annotations: {
      title: "Competitive citation snapshot for a query",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => competeForQuery(args)),
);

server.registerTool(
  "citations.freshness",
  {
    description:
      "Score how recent the pages cited for a query are. Calls check_citations, then collects dateModified for each cited URL, returns a 0-100 recency_score (halflife=365d) plus per-URL freshness bucket (fresh/current/stale/ancient/unknown). Surfaces queries where AI cites old content - opportunity to ship fresher.",
    inputSchema: citationFreshnessScoreInputSchema,
    outputSchema: citationFreshnessScoreOutputShape,
    annotations: {
      title: "Score freshness of AI-cited pages",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => citationFreshnessScore(args)),
);

server.registerTool(
  "domain.cited_for_diff",
  {
    description:
      "Diff cited_for between two time windows for a domain. Returns queries gained (cited now, not before baseline_until) and queries lost (cited before, not since current_since). Cache-only, no API spend. Use to track citation drift over time after publishing or migrating content.",
    inputSchema: citedForDiffInputSchema,
    outputSchema: citedForDiffOutputShape,
    annotations: {
      title: "Diff citation changes between time windows",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  (args) => wrapHandler(() => citedForDiff(args)),
);

server.registerTool(
  "signals.gsc_gap",
  {
    description:
      "Join Google Search Console performance with am_i_cited per query. Surfaces queries where the domain ranks well in Google but is not cited in AI - the closest editorial wins. Requires GCP service account creds (credentials_path or GOOGLE_APPLICATION_CREDENTIALS env).",
    inputSchema: gscCitationGapInputSchema,
    outputSchema: gscCitationGapOutputShape,
    annotations: {
      title: "Find GSC queries not cited by AI",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => gscCitationGap(args)),
);

server.registerTool(
  "signals.bing_gap",
  {
    description:
      "Join Bing Webmaster Tools query stats with am_i_cited per query. Surfaces queries where the domain ranks well in Bing but is not cited in AI - the closest editorial wins. Bing's index backs Copilot/ChatGPT/Perplexity grounding, so a Bing rank gap is an LLM-citation gap. Requires BING_WEBMASTER_API_KEY (Bing Webmaster Tools -> Settings -> API Access).",
    inputSchema: bingCitationGapInputSchema,
    outputSchema: bingCitationGapOutputShape,
    annotations: {
      title: "Find Bing queries not cited by AI",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => bingCitationGap(args)),
);

server.registerTool(
  "audit.schema",
  {
    description:
      "Deep schema.org validation for a URL. Parses every JSON-LD block and microdata node, checks required fields per @type (Article needs headline+author+datePublished, FAQPage needs mainEntity, HowTo needs step, etc.), and flags missing fields and malformed JSON-LD. Returns issues list and a valid/invalid verdict. Use to fix structured-data bugs that predict_citation flags but can't explain.",
    inputSchema: schemaAuditInputSchema,
    outputSchema: schemaAuditOutputShape,
    annotations: {
      title: "Audit schema.org structured data",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => schemaAudit(args)),
);

server.registerTool(
  "audit.llms_txt",
  {
    description:
      "Generate an llms.txt file (https://llmstxt.org spec) from a sitemap. Parses sitemap.xml + nested indexes, groups URLs by top-level path, and emits a Markdown document with H1+description+sectioned link lists. Set fetch_titles=true to pull <title> per URL (slower, richer output).",
    inputSchema: llmsTxtGeneratorInputSchema,
    outputSchema: llmsTxtGeneratorOutputShape,
    annotations: {
      title: "Generate llms.txt from sitemap",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => llmsTxtGenerator(args)),
);

server.registerTool(
  "signals.answer_box",
  {
    description:
      "Locate where each cited URL appears in the AI's raw answer text. Calls check_citations, finds the first mention of each citation's URL (or hostname) in raw_answer, and bins by char position into early/middle/late thirds. Surfaces whether your URL is cited up-front or buried near the end. Returns 'unknown' for engines without raw_answer (Bing, Brave).",
    inputSchema: answerBoxPositionInputSchema,
    outputSchema: answerBoxPositionOutputShape,
    annotations: {
      title: "Locate citation positions in AI answer",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => answerBoxPosition(args)),
);

server.registerTool(
  "citations.provenance",
  {
    description:
      "Fan a query out across multiple AI engines and report per-URL cross-engine consensus. Returns each unique cited URL with the list of engines that cited it, plus a consensus_urls list (URLs cited by ALL engines). High engine_count = strong cross-engine citation signal; engine_count=1 = engine-specific.",
    inputSchema: citationProvenanceInputSchema,
    outputSchema: citationProvenanceOutputShape,
    annotations: {
      title: "Cross-engine citation provenance",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => citationProvenance(args)),
);

server.registerTool(
  "citations.evidence",
  {
    description:
      "Extract the cited snippet from the AI engine's raw answer for each citation. Calls check_citations, then for each returned URL finds the first mention in raw_answer and returns a context window plus the nearest quoted span or containing sentence. Use to see *why* an engine cited a URL, not just *that* it did. Returns 'not found' for engines without raw_answer (Bing, Brave).",
    inputSchema: citationEvidenceInputSchema,
    outputSchema: citationEvidenceOutputShape,
    annotations: {
      title: "Extract citation evidence from AI answer",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => citationEvidence(args)),
);

server.registerTool(
  "audit.crawler_access",
  {
    description:
      "Verify that major AI crawlers (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, CCBot, Google-Extended, Applebot-Extended, Bytespider, Meta-ExternalAgent, plus real-time fetch UAs) can fetch a URL. Parses robots.txt and does a live GET with each bot's User-Agent. Surfaces robots.txt blocks AND UA-based gating that breaks AI citation.",
    inputSchema: crawlerAccessAuditInputSchema,
    outputSchema: crawlerAccessAuditOutputShape,
    annotations: {
      title: "Audit AI crawler access to a URL",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => crawlerAccessAudit(args)),
);

server.registerTool(
  "audit.sitemap_map",
  {
    description:
      "Cross-reference a sitemap with the citation cache. For each sitemap URL, reports whether it appears in cached citations (and how many queries/engines cited it). Inverse of audit_sitemap: not 'how citable is each URL', but 'has each URL actually been cited yet'. Cache must be primed via check_citations or run_panel first.",
    inputSchema: sitemapCitationMapInputSchema,
    outputSchema: sitemapCitationMapOutputShape,
    annotations: {
      title: "Map sitemap URLs against citation cache",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  (args) => wrapHandler(() => sitemapCitationMap(args)),
);

server.registerTool(
  "competitors.canonical_set",
  {
    description:
      "Fan a query across engines and aggregate citations by registered domain (not URL). Returns top competitor domains ranked by cross-engine consensus, with per-engine breakdown and top URLs per domain. Use to identify the canonical competitor set for a query - the domains every engine treats as authoritative.",
    inputSchema: canonicalCompetitorSetInputSchema,
    outputSchema: canonicalCompetitorSetOutputShape,
    annotations: {
      title: "Identify canonical competitor domains for a query",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => canonicalCompetitorSet(args)),
);

server.registerTool(
  "audit.structured_data",
  {
    description:
      "Suggest missing JSON-LD additions for a URL. Fetches the page, detects existing schema types, and returns ready-to-paste templates for types that are missing but signalled by page content (BlogPosting from og:type=article or bylines, FAQPage from Q&A pairs, HowTo from numbered steps, BreadcrumbList from nested paths, Organization on homepages). Templates are pre-filled from page metadata where possible; fields marked FILL: require manual completion.",
    inputSchema: structuredDataRepairInputSchema,
    outputSchema: structuredDataRepairOutputShape,
    annotations: {
      title: "Suggest missing JSON-LD for a URL",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  (args) => wrapHandler(() => structuredDataRepair(args)),
);

registerPrompts(server);
registerResources(server);

const transport = new StdioServerTransport();
await server.connect(transport);
log.info(
  "server ready on stdio",
  {
    version: SERVER_VERSION,
    log_level: log.level(),
    tools: [
      "citations.check",
      "citations.predict",
      "citations.trend",
      "citations.provenance",
      "citations.evidence",
      "citations.freshness",
      "domain.am_i_cited",
      "domain.cited_for",
      "domain.cited_for_diff",
      "panel.track",
      "panel.run",
      "competitors.compare",
      "competitors.compete",
      "competitors.canonical_set",
      "signals.ai_overview",
      "signals.answer_box",
      "signals.wikipedia",
      "signals.gsc_gap",
      "signals.bing_gap",
      "audit.sitemap",
      "audit.sitemap_map",
      "audit.crawler_access",
      "audit.schema",
      "audit.llms_txt",
      "audit.structured_data",
    ],
    prompts: [
      "audit.citation_readiness",
      "audit.competitor_snapshot",
      "audit.crawler_checkup",
      "audit.gap_analysis",
      "audit.sitemap_coverage",
    ],
    resources: [
      "citation://cache/summary",
      "citation://panels",
      "citation://docs/llms-txt",
      "citation://docs/ai-crawlers",
      "citation://domain/{domain}/cited-for",
    ],
  },
);
