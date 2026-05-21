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

| Tool | Purpose |
|---|---|
| `check_citations` | URLs cited by Perplexity / Claude / ChatGPT / Gemini / Bing for a query |
| `am_i_cited` | Presence + rank for a domain across a query cluster |
| `ai_overview` | Google AI Overview presence + cited sources |
| `cited_for` | Queries the domain has been cited for, from local cache |
| `predict_citation` | Citation likelihood from public signals - no LLM fired |

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
- **predict_citation runs with zero keys** - it scores citation likelihood from public signals (Wikipedia, schema.org, llms.txt, GitHub) without firing any LLM.

## Privacy

- All API calls go from your machine directly to the vendor (Anthropic, OpenAI, Google, Perplexity, Bing, SerpAPI).
- No proxy. No analytics. No telemetry by default.
- API keys are read from environment variables on the MCP process - never logged, never persisted.
- Cache file lives at `~/.config/citation-intelligence/cache.json`. Delete it any time.

## Environment variables

| Var | Purpose | Free tier? |
|---|---|---|
| `PERPLEXITY_API_KEY` | check_citations (Perplexity) | Yes |
| `SERPAPI_KEY` | ai_overview | 100/month free |
| `BING_API_KEY` | check_citations (Bing) | Yes |
| `ANTHROPIC_API_KEY` | check_citations (Claude) | Paid only |
| `OPENAI_API_KEY` | check_citations (ChatGPT) | Paid only |
| `GEMINI_API_KEY` | check_citations (Gemini) | Yes |
| `CITATION_CACHE_TTL_DAYS` | Cache TTL for citation_check entries (default 7) | n/a |
| `CITATION_AI_OVERVIEW_TTL_DAYS` | Cache TTL for ai_overview entries (default 1) | n/a |
| `CITATION_CONFIG_DIR` | Override config dir (default `~/.config/citation-intelligence`) | n/a |

## Example: am I cited?

```
You: For the queries "best AI citation tracker", "MCP for AI search", "self-hosted GEO tool",
     is automatelab.tech cited?

(agent invokes am_i_cited)

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

(agent invokes predict_citation)

Result:
{
  "url": "https://example.com/blog/post",
  "score": 55,
  "grade": "C",
  "signals": {
    "wikipedia_linked": false,
    "schema_org_present": true,
    "schema_types": ["Article"],
    "llms_txt_present": false,
    "github_referenced": false,
    "reddit_referenced": true,
    "canonical_clean": true,
    "https": true
  },
  "fixes": [
    { "signal": "wikipedia_linked", "suggestion": "...", "estimated_lift": "high" },
    { "signal": "llms_txt_present", "suggestion": "...", "estimated_lift": "medium" }
  ]
}
```

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
