# Citation Intelligence MCP

**A free, self-hosted MCP server that tells your agent what LLMs cite - across Perplexity, Google AI Overviews, ChatGPT, Claude, Gemini, and Bing.**

[![npm version](https://img.shields.io/npm/v/@automatelab/citation-intelligence.svg)](https://www.npmjs.com/package/@automatelab/citation-intelligence)
[![license](https://img.shields.io/npm/l/@automatelab/citation-intelligence.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@automatelab/citation-intelligence.svg)](https://nodejs.org)

## What this is

An MCP server for agents and developers who need to know which URLs get cited by AI search engines for any query. Install once, query from any MCP-compatible client (Claude Desktop, Cursor, Claude Code, Continue, Cline, n8n, LangGraph). Self-hosted, no account, no centralized backend. Bring your own API keys; nothing is stored on a remote server.

## Who this is for

Install this if you're:

- Building an agent that does research and want it to cite sources LLMs already trust
- A solo dev or indie hacker checking whether your SaaS is showing up in AI search
- A content creator confirming your articles are being cited by ChatGPT, Claude, or Perplexity
- An SEO or GEO practitioner who wants programmatic citation data without a $295-$499/mo dashboard
- Running an editorial pipeline and want citation-deficit-driven topic selection
- Comparing competitor visibility across AI engines for any niche

Do NOT install this if you want:

- A polished marketing dashboard with charts and team seats - try Profound, AthenaHQ, or Otterly.AI
- A hosted service with SLAs - this is self-hosted by design
- Citation tracking for academic papers - try citecheck
- 350M+ pre-modeled prompts - that's Ahrefs Brand Radar

## Why this exists

The AI citation tracking market is dominated by VC-funded dashboards starting at $295/mo. None ships MCP-first. If you're an agent or developer who wants citation data piped directly into your workflow - not into a SaaS login - there isn't a tool for you. This is that tool.

---

## Tools

Tools are grouped into six namespaces: `citations.*`, `domain.*`, `signals.*`, `panel.*`, `competitors.*`, `audit.*`. Names form a navigable tree — pick a namespace by the question you're asking.

**Start with `citations.provenance` or `domain.am_i_cited`.** Single-engine results (`citations.check` with a pinned engine) are directional; multi-engine consensus is the honest signal. A URL cited by 4 of 5 engines is a very different finding than one cited by 1.

### `citations.*` — query-level: who cites what, with what evidence

| Tool | Purpose |
|---|---|
| `citations.provenance` | **Recommended first tool.** Fan a query across engines; per-URL cross-engine consensus matrix. Returns `interpretation_note` per engine. |
| `citations.check` | URLs cited by Perplexity / Claude / ChatGPT / Gemini / Google AI Mode for a query; or web rank via bing_serp / brave_serp |
| `citations.evidence` | Extract the cited snippet from `raw_answer` for each citation (why, not just that) |
| `citations.predict` | Citation likelihood from public signals - no LLM fired |
| `citations.trend` | Time-series report of citation rate + per-query gained/lost deltas |
| `citations.freshness` | Recency score (halflife=365d) for the pages an engine cites |

### `domain.*` — domain-level: am I cited, what for

| Tool | Purpose |
|---|---|
| `domain.am_i_cited` | Domain citation check. With `engine=auto` (default): fans across all available LLM engines, returns per-engine breakdown + cross-engine consensus. Pin `engine=` to reduce cost. |
| `domain.cited_for` | Queries the domain has been cited for, from local cache |
| `domain.cited_for_diff` | Diff of `domain.cited_for` between two time windows for a domain |

### `signals.*` — external signals: AI Overview, Wikipedia, GSC, answer-box position

| Tool | Purpose |
|---|---|
| `signals.ai_overview` | Google AI Overview presence + cited sources |
| `signals.wikipedia` | List Wikipedia articles referencing a domain (zero keys) |
| `signals.gsc_gap` | Join Google Search Console performance with AI citation status |
| `signals.answer_box` | Bin each citation's first mention in `raw_answer` into early/middle/late thirds |

### `panel.*` — saved query panels (editorial watchlists)

| Tool | Purpose |
|---|---|
| `panel.track` | Save / load / list named query panels (editorial watchlists) |
| `panel.run` | Run a panel through `domain.am_i_cited` and snapshot to disk |

### `competitors.*` — competitive landscape per query

| Tool | Purpose |
|---|---|
| `competitors.canonical_set` | Top cited domains per query, aggregated across engines |
| `competitors.compete` | End-to-end competitive snapshot: your URL vs top cited competitors |
| `competitors.compare` | Side-by-side `citations.predict` across 2-10 URLs |

### `audit.*` — fixable on-page / on-site checks

| Tool | Purpose |
|---|---|
| `audit.schema` | Deep schema.org validation - required fields per `@type`, malformed JSON-LD |
| `audit.structured_data` | Repair-oriented schema.org diagnostics + suggested patches |
| `audit.crawler_access` | Verify GPTBot / ClaudeBot / PerplexityBot / CCBot / Google-Extended etc. can fetch a URL |
| `audit.sitemap` | Bulk `citations.predict` across every URL in a sitemap, worst-first |
| `audit.sitemap_map` | Cross-reference sitemap URLs with cached citations (inverse of `audit.sitemap`) |
| `audit.llms_txt` | Generate an `llms.txt` (https://llmstxt.org) from a sitemap |

### Prompts

Server-side prompt templates the client can offer end users (call via the MCP prompt list):

- `audit.citation_readiness(url)` - chains `citations.predict` + `audit.schema`
- `audit.competitor_snapshot(query, your_url?)` - chains `competitors.canonical_set` + `competitors.compete`
- `audit.crawler_checkup(url)` - runs `audit.crawler_access` and writes a remediation list
- `audit.gap_analysis(domain, days?)` - drives `signals.gsc_gap` and suggests next moves
- `audit.sitemap_coverage(sitemap_url)` - runs `audit.sitemap_map` and recommends priorities

### Resources

Cache views the client can read or subscribe to (no tool call required):

- `citation://cache/summary` - entry counts by type/engine, unique queries/URLs, oldest/newest
- `citation://panels` - saved panels + per-panel snapshot counts
- `citation://docs/llms-txt` - llms.txt primer (markdown)
- `citation://docs/ai-crawlers` - AI crawlers cheatsheet (markdown)
- `citation://domain/{domain}/cited-for` - dynamic template: citations for `{domain}`

## What this actually measures

Every response includes a `surface` field that tells you exactly how the data was collected. Understanding this is important before drawing conclusions.

| Surface | Engines | What it means |
|---|---|---|
| `consumer_scrape` | `perplexity`, `google_ai_mode` | Proxied through a real consumer-facing AI search product. Closest to what your users see. |
| `api_proxy` | `claude`, `openai`, `gemini` | API call to a search-enabled LLM. **May differ from consumer product behavior** — different model versions, no UI-level ranking logic, no personalization. Use as a directional proxy, not as ground truth. |
| `web_rank` | `bing_serp`, `brave_serp` | Traditional web search rank (not LLM citation). Measures whether a URL appears in SERP results, not whether an LLM cites it. |
| `static_signal` | `citations.predict`, `signals.wikipedia` | Offline signal computed from public data. No live LLM query. |

### Per-engine notes

**`perplexity` (consumer_scrape)** — Sonar Pro via the Perplexity API with a consumer-equivalent system prompt. Reasonably close to Perplexity.ai. Citations come from `search_results` in the response; the `citations` fallback contains URL-only entries without title.

**`claude` (api_proxy)** — Claude Sonnet via the Anthropic Messages API with `web_search` tool enabled. The consumer Claude.ai product uses different routing and ranking logic. Citation behavior can differ, especially for recent/time-sensitive queries.

**`openai` (api_proxy)** — `gpt-4o-search-preview` via the OpenAI Responses API. This is the model OpenAI ships to mirror SearchGPT behavior — closer to consumer than `gpt-4o-mini`, but still API-tier.

**`gemini` (api_proxy)** — Gemini 2.5 Pro via the Generative Language API with `google_search` grounding. Consumer Gemini uses the same grounding index but different re-ranking. Results are directional.

**`google_ai_mode` (consumer_scrape)** — Google AI Mode results via SerpAPI. Closest to what users see in Google Search. Requires `SERPAPI_KEY`.

**`bing_serp` / `brave_serp` (web_rank)** — Traditional SERP rank. Does NOT measure LLM citations. Use `citations.check` with these engines to compare organic web rank against LLM citation rank. `domain.am_i_cited` refuses these engines — it only measures LLM behavior.

The proxy nature of `api_proxy` engines is a feature, not a bug: it lets you run citation checks without consuming expensive consumer-product quota. Just don't report API-proxy numbers as "ChatGPT cites you" without the caveat.

Every tool response includes an `interpretation_note` field that summarizes the fidelity in one sentence. Full per-engine fidelity ratings: [docs/surface-fidelity.md](docs/surface-fidelity.md).

---

## Quick start

```bash
npx -y @automatelab/citation-intelligence
```

Requires Node 20 or later.

### Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "citation-intelligence": {
      "command": "npx",
      "args": ["-y", "@automatelab/citation-intelligence"],
      "env": {
        "PERPLEXITY_API_KEY": "pplx-...",
        "SERPAPI_KEY": "...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "OPENAI_API_KEY": "sk-...",
        "GEMINI_API_KEY": "..."
      }
    }
  }
}
```

Set only the keys you have. Any MCP client that supports stdio transport works - same `command` / `args` pattern.

## How it stays free

- **No central backend.** The server runs on your machine. Nothing is uploaded.
- **Free tier first.** SerpAPI gives 100 free Google AI Overview lookups/month. Bing Web Search has a free tier. Perplexity offers free Sonar access on signup.
- **Bring your own paid keys** if you want the premium engines (Claude, ChatGPT, Gemini). Keys pass through to the vendor and never touch any third party.
- **Local cache** at `~/.config/citation-intelligence/cache.json`. Repeated queries hit cache, not API. Default TTL: 7 days.
- **`citations.predict` runs with zero keys** - it scores citation likelihood from public signals (Wikipedia, schema.org, llms.txt, GitHub) without firing any LLM.

## Privacy

- All API calls go from your machine directly to the vendor (Anthropic, OpenAI, Google, Perplexity, Bing, SerpAPI).
- No proxy. No analytics. No telemetry by default.
- API keys are read from environment variables on the MCP process - never logged, never persisted.
- Cache file lives at `~/.config/citation-intelligence/cache.json`. Delete it any time.

## Environment variables

| Var | Purpose | Free tier? |
|---|---|---|
| `PERPLEXITY_API_KEY` | `citations.check` (perplexity — consumer_scrape) | Yes |
| `SERPAPI_KEY` | `signals.ai_overview` + `citations.check` (google_ai_mode — consumer_scrape) | 100/month free |
| `ANTHROPIC_API_KEY` | `citations.check` (claude — api_proxy) | Paid only |
| `OPENAI_API_KEY` | `citations.check` (openai — api_proxy) | Paid only |
| `GEMINI_API_KEY` | `citations.check` (gemini — api_proxy) | Yes |
| `BING_API_KEY` | `citations.check` (bing_serp — web_rank) | Yes |
| `BRAVE_API_KEY` | `citations.check` (brave_serp — web_rank) | Yes (2000/month) |
| `CITATION_CACHE_TTL_DAYS` | Cache TTL for `citations.check` entries (default 7) | n/a |
| `CITATION_AI_OVERVIEW_TTL_DAYS` | Cache TTL for `signals.ai_overview` entries (default 1) | n/a |
| `CITATION_CONFIG_DIR` | Override config dir (default `~/.config/citation-intelligence`) | n/a |

## Example: am I cited?

```
You: For the queries "best AI citation tracker", "MCP for AI search", "self-hosted GEO tool",
     is automatelab.tech cited?

(agent invokes `domain.am_i_cited`)

Result:
{
  "domain": "automatelab.tech",
  "engine": "perplexity",
  "results": [
    { "query": "best AI citation tracker",   "cited": true,  "rank": 4 },
    { "query": "MCP for AI search",          "cited": true,  "rank": 1 },
    { "query": "self-hosted GEO tool",       "cited": false, "matching_urls": [] }
  ],
  "summary": {
    "queries_total": 3,
    "queries_cited": 2,
    "citation_rate": 0.67,
    "average_rank": 2.5
  }
}
```

## Example: predict citation likelihood (no key required)

```
You: How likely is https://example.com/blog/post to be cited by AI?

(agent invokes `citations.predict`)

Result:
{
  "url": "https://example.com/blog/post",
  "score": 62,
  "grade": "C",
  "signals": {
    "wikipedia_linked": false,
    "github_referenced": false,
    "reddit_referenced": true,
    "llms_txt_present": true,
    "https": true,
    "has_article_schema": true,
    "has_faq_schema": false,
    "has_breadcrumb_schema": true,
    "canonical_clean": true,
    "word_count": 1850,
    "reading_time_minutes": 8,
    "h2_count": 7,
    "h2_question_count": 1,
    "authority_link_count": 2,
    "external_link_count": 6,
    "internal_link_count": 11,
    "last_modified_days_ago": 42,
    "has_open_graph": true
  },
  "fixes": [
    { "signal": "has_faq_schema", "suggestion": "Page already has question-style H2s. Wrap them in FAQPage JSON-LD - high-leverage win.", "estimated_lift": "high" },
    { "signal": "h2_question_count", "suggestion": "Reframe at least 2 H2s as questions users actually ask...", "estimated_lift": "medium" }
  ]
}
```

The Wikipedia signal is measured (it correlates with citation) but no "go get a Wikipedia article" suggestion is emitted - the advice would be non-actionable. Scoring is split across six buckets - domain authority, structured data, content depth, link graph, freshness, metadata - so a thin page and a deep page on the same domain get meaningfully different scores.

---

## Workflow recipes

Concrete patterns that compose the 24 tools into something useful. Costs assume ChatGPT or Perplexity at ~$0.01-0.03/query.

### 1. Weekly citation tracker

The single highest-ROI pattern. Pick 20-30 queries from your editorial backlog, snapshot weekly, watch the rate trend.

```
# One-time setup
panel.track name="editorial-watchlist" domain="example.com" action="save"
            queries=["best widget tutorial", "how to set up X", ...]

# Weekly cron (5 min, ~$0.20-0.60 per run)
panel.run name="editorial-watchlist"

# Anytime
citations.trend panel="editorial-watchlist"
```

`citations.trend` returns per-query deltas: which queries flipped from `cited: false` to `cited: true` since the first snapshot. That's your real editorial-impact metric.

### 2. Pre-publish gate

Before publishing a post, find out who owns the citation slot and whether the slot is worth competing for.

```
# 1. Is there an AI Overview to compete for?
signals.ai_overview query="<target query>"

# 2. Who is cited today?
citations.check query="<target query>"

# 3. After publish + 14 days: did the post break in?
domain.am_i_cited domain="example.com" queries=["<target query>"]
```

If `citations.check` returns 5+ strong incumbents on a low-volume query, pick a different angle. If `ai_overview_present: false`, the query has no AI surface - reconsider.

### 3. Bulk site audit

Catch site-wide structural issues across every page in one pass. Zero API spend.

```
audit.sitemap sitemap_url="https://example.com/sitemap.xml" limit=200
```

Returns `worst_first` sorted by citation-likelihood score. Surfaces missing schema, conflicting canonicals, missing `/llms.txt`, broken HTTPS.

### 4. Competitor signal gap

You're not cited; they are. Why?

```
# 1. Find the top-cited URLs for your target query
citations.check query="<query>"

# 2. Compare your URL to theirs signal-by-signal
competitors.compare urls=[
  "https://example.com/your-post",
  "https://competitor-1.com/their-post",
  "https://competitor-2.com/their-post"
]
```

`diverging_signals` is the list of where you're losing. Usually obvious once you see it - they have FAQ schema, GitHub references, Wikipedia links - you don't.

### 5. Google-rank vs AI-citation gap

The closest editorial wins are queries where you already rank in Google's top 10 but are invisible to AI. Requires a GCP service account with `webmasters.readonly` scope.

```
signals.gsc_gap
  domain="example.com"
  queries=["...editorial watchlist..."]
  start_date="2026-04-01"
  end_date="2026-05-01"
```

`closest_wins` returns queries with `position <= 10` and `ai_cited: false`, sorted by impressions desc. Push citation signals on those specific URLs first.

### 6. Wikipedia mention monitor

Wikipedia is the top-correlation signal but the advice "get on Wikipedia" is useless. So instead: watch when it happens organically.

```
signals.wikipedia domain="example.com" limit=50
```

Returns Wikipedia article URLs that already link to the domain. Re-run quarterly; the diff is your "we got a Wikipedia citation" alert.

## Schema.org

```json
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Citation Intelligence MCP",
  "applicationCategory": "DeveloperApplication",
  "operatingSystem": "Cross-platform",
  "description": "Self-hosted MCP server for querying AI citation data from Perplexity, Claude, ChatGPT, Gemini, Bing, and Google AI Overviews.",
  "offers": { "@type": "Offer", "price": "0" },
  "url": "https://github.com/AutomateLab-tech/citation-intelligence"
}
```

## Contributing

Bug reports, feature ideas, and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

Report a vulnerability via [SECURITY.md](./SECURITY.md).

## License

MIT - see [LICENSE](./LICENSE).

Built by [automatelab.tech](https://automatelab.tech)
