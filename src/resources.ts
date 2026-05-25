// MCP resources surfaced by this server. Each resource returns cache state
// the client can read or subscribe to without firing tool calls.

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { CONFIG_DIR, CACHE_FILE } from "./lib/config.js";
import { citedForDomain } from "./lib/cache.js";

type ReadResourceResult = {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text: string;
  }>;
};

function asJson(uri: string, value: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function loadCacheSummary(): Promise<{
  cache_file: string;
  exists: boolean;
  size_bytes: number;
  entries_total: number;
  by_type: Record<string, number>;
  by_engine: Record<string, number>;
  unique_queries: number;
  unique_urls: number;
  oldest_fetched_at: string | null;
  newest_fetched_at: string | null;
}> {
  let size = 0;
  let exists = false;
  try {
    const s = await stat(CACHE_FILE);
    size = s.size;
    exists = true;
  } catch {
    // missing cache file - return empty summary
  }
  let entries: Array<{
    type?: string;
    engine?: string;
    query?: string;
    fetched_at?: string;
    citations?: Array<{ url?: string }>;
    sources?: Array<{ url?: string }>;
  }> = [];
  if (exists) {
    try {
      const raw = await readFile(CACHE_FILE, "utf8");
      const parsed = JSON.parse(raw) as { entries?: typeof entries };
      entries = parsed.entries ?? [];
    } catch {
      // ignore corrupt cache
    }
  }
  const byType: Record<string, number> = {};
  const byEngine: Record<string, number> = {};
  const queries = new Set<string>();
  const urls = new Set<string>();
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const e of entries) {
    if (e.type) byType[e.type] = (byType[e.type] ?? 0) + 1;
    if (e.engine) byEngine[e.engine] = (byEngine[e.engine] ?? 0) + 1;
    if (e.query) queries.add(e.query.toLowerCase());
    for (const c of e.citations ?? []) if (c.url) urls.add(c.url);
    for (const c of e.sources ?? []) if (c.url) urls.add(c.url);
    if (e.fetched_at) {
      if (!oldest || e.fetched_at < oldest) oldest = e.fetched_at;
      if (!newest || e.fetched_at > newest) newest = e.fetched_at;
    }
  }
  return {
    cache_file: CACHE_FILE,
    exists,
    size_bytes: size,
    entries_total: entries.length,
    by_type: byType,
    by_engine: byEngine,
    unique_queries: queries.size,
    unique_urls: urls.size,
    oldest_fetched_at: oldest,
    newest_fetched_at: newest,
  };
}

async function loadPanelsList(): Promise<{
  config_dir: string;
  panels: Array<{ name: string; queries: number; domain?: string; updated_at?: string }>;
  snapshots_by_panel: Record<string, number>;
}> {
  const panelDir = join(CONFIG_DIR, "panels");
  const snapshotDir = join(CONFIG_DIR, "snapshots");
  const panels: Array<{
    name: string;
    queries: number;
    domain?: string;
    updated_at?: string;
  }> = [];
  try {
    const files = await readdir(panelDir);
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const name = f.slice(0, -5);
      try {
        const raw = await readFile(join(panelDir, f), "utf8");
        const p = JSON.parse(raw) as {
          queries?: string[];
          domain?: string;
          updated_at?: string;
        };
        panels.push({
          name,
          queries: p.queries?.length ?? 0,
          domain: p.domain,
          updated_at: p.updated_at,
        });
      } catch {
        panels.push({ name, queries: 0 });
      }
    }
  } catch {
    // panels dir doesn't exist yet
  }
  const snapshotsByPanel: Record<string, number> = {};
  try {
    const panelDirs = await readdir(snapshotDir);
    for (const p of panelDirs) {
      try {
        const files = await readdir(join(snapshotDir, p));
        snapshotsByPanel[p] = files.filter((f) => f.endsWith(".json")).length;
      } catch {
        // skip
      }
    }
  } catch {
    // snapshots dir doesn't exist yet
  }
  return {
    config_dir: CONFIG_DIR,
    panels,
    snapshots_by_panel: snapshotsByPanel,
  };
}

const LLMS_TXT_PRIMER = [
  "# llms.txt — what it is",
  "",
  "Proposed by llmstxt.org. A markdown file at /llms.txt that orients LLM",
  "crawlers to your site: H1 title, short blurb, then sectioned link lists.",
  "Distinct from robots.txt (gates) and sitemap.xml (URL enumeration) - it",
  "tells the model *what's important*, not just *what exists*.",
  "",
  "## Mainstream signal status",
  "",
  "- OpenAI, Anthropic, Perplexity: no public statement of consumption.",
  "- Adopters use it as a documentation / discoverability nudge.",
  "- Generally harmless to ship; benefit > zero, cost ~ zero.",
  "",
  "## How this server helps",
  "",
  "- `llms_txt_generator` builds a draft from your sitemap.",
  "- `audit_sitemap` ranks pages by citation-readiness before you include them.",
  "- `predict_citation` scores any URL on the public signals (llms.txt is one).",
  "",
  "## Spec",
  "",
  "https://llmstxt.org",
].join("\n");

const CRAWLERS_PRIMER = [
  "# AI crawlers cheatsheet",
  "",
  "## Training/index bots (robots.txt gate)",
  "",
  "- GPTBot — OpenAI ChatGPT training",
  "- OAI-SearchBot — ChatGPT Search index",
  "- ClaudeBot — Anthropic training",
  "- PerplexityBot — Perplexity index",
  "- CCBot — Common Crawl (feeds many LLM corpora)",
  "- Google-Extended — robots-only opt-out token for Gemini training",
  "- Applebot-Extended — robots-only opt-out for Apple Intelligence",
  "- Bytespider — ByteDance Doubao",
  "- Meta-ExternalAgent — Llama",
  "",
  "## Real-time fetch bots (UA gate)",
  "",
  "- ChatGPT-User — OpenAI on-prompt fetch",
  "- Claude-Web — Anthropic on-prompt fetch",
  "- Perplexity-User — Perplexity on-query fetch",
  "",
  "## Audit",
  "",
  "Use `audit.crawler_access` to verify these can each fetch a URL. Use the",
  "`audit.crawler_checkup` prompt for an LLM-driven write-up.",
].join("\n");

export function registerResources(server: McpServer): void {
  server.registerResource(
    "cache_summary",
    "citation://cache/summary",
    {
      title: "Citation cache summary",
      description:
        "Aggregate counts of cached entries by type, engine, unique queries, and unique URLs. Read-only view of the local citation cache.",
      mimeType: "application/json",
    },
    async (uri) => {
      const summary = await loadCacheSummary();
      return asJson(uri.toString(), summary);
    },
  );

  server.registerResource(
    "panels_list",
    "citation://panels",
    {
      title: "Saved panels",
      description:
        "List of saved query panels and per-panel snapshot counts. Mirrors panel.track action=list with snapshot context.",
      mimeType: "application/json",
    },
    async (uri) => {
      const panels = await loadPanelsList();
      return asJson(uri.toString(), panels);
    },
  );

  server.registerResource(
    "llms_txt_primer",
    "citation://docs/llms-txt",
    {
      title: "llms.txt primer",
      description:
        "What llms.txt is, what it isn't, and how this server's tools help build one. Short markdown primer.",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "text/markdown",
          text: LLMS_TXT_PRIMER,
        },
      ],
    }),
  );

  server.registerResource(
    "crawlers_primer",
    "citation://docs/ai-crawlers",
    {
      title: "AI crawlers cheatsheet",
      description:
        "Quick reference for the AI crawlers `audit.crawler_access` checks, grouped by training vs real-time fetch.",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "text/markdown",
          text: CRAWLERS_PRIMER,
        },
      ],
    }),
  );

  server.registerResource(
    "cited_for_domain",
    new ResourceTemplate("citation://domain/{domain}/cited-for", {
      list: undefined,
    }),
    {
      title: "Citations for a domain",
      description:
        "Cached citations for {domain}. Returns the most recent 200 entries. Same source as domain.cited_for tool, surfaced as a resource for clients that subscribe.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const domainVar = variables.domain;
      const domain = Array.isArray(domainVar) ? domainVar[0] : domainVar;
      const safe = typeof domain === "string" ? domain : "";
      const results = safe
        ? await citedForDomain(safe, undefined, undefined, 200)
        : [];
      return asJson(uri.toString(), {
        domain: safe,
        results,
        total: results.length,
        source: "local_cache",
      });
    },
  );
}
