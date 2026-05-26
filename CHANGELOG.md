# Changelog

## 0.9.2 - 2026-05-26

Two adapter regressions blocking real queries:
- OpenAI adapter sent `system` as a top-level Responses-API parameter; the API renamed it to `instructions`, so every call returned `400 Unknown parameter: 'system'`. Switched to `instructions`. Affects `check_citations` (engine=auto when only `OPENAI_API_KEY` is set, or engine=openai explicitly), `canonical_competitor_set`, and any downstream tool that fans through OpenAI.
- `check_citations` output schema required `raw_answer: string | null`, but the `brave_serp` and `bing_serp` adapters (web_rank engines) legitimately omit `raw_answer` because SERP responses have no synthesized answer text. Calls succeeded upstream and citations landed in the local cache, but the tool returned `MCP error -32602: Invalid structured content ... raw_answer Required`. Schema is now `string | null | undefined`, with the description updated to call out that web_rank engines don't produce a raw answer.

## 0.6.0 - 2026-05-21

Four new tools, a seventh engine, plus MCP prompts and resources surfaces.

New tools:
- `citation_evidence(query, engine?, max_results?, context_chars?)` - extract the cited snippet from each citation's location in `raw_answer`. Returns context window + nearest quoted span or containing sentence per citation. Tells you *why* an engine cited a URL, not just *that* it did.
- `crawler_access_audit(url, bots?, fetch_with_ua?)` - verify GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-Web, PerplexityBot, Perplexity-User, CCBot, Google-Extended, Applebot-Extended, Bytespider, and Meta-ExternalAgent can fetch a URL. Parses robots.txt and does a live GET under each bot's User-Agent. Surfaces both robots.txt blocks and UA-based gating.
- `sitemap_citation_map(sitemap_url, domain?, since?, limit?)` - cross-reference a sitemap with the citation cache. Inverse of `audit_sitemap`: reports which URLs have actually been cited, by which engines and queries, vs which are unmapped. Requires the cache to be primed first.
- `canonical_competitor_set(query, engines?, top_n?, max_results?, exclude_domains?)` - fan a query across engines and aggregate citations by registered domain. Returns top competitor domains ranked by cross-engine consensus, with per-engine breakdown.

New engine:
- `google_ai_mode` adapter via SerpAPI's `google_ai_mode` endpoint (distinct from `ai_overview`). Wired into `check_citations` and downstream tools.

MCP surfaces beyond tools (Stage 3 / AL-566):
- **Prompts** - 5 server-side prompt templates the client can offer end users:
  - `audit_citation_readiness(url)` - chains predict_citation + schema_audit
  - `competitor_snapshot(query, your_url?)` - chains canonical_competitor_set + compete_for_query
  - `ai_crawler_checkup(url)` - runs crawler_access_audit and writes a remediation list
  - `citation_gap_analysis(domain, days?)` - drives gsc_citation_gap and suggests next editorial moves
  - `sitemap_coverage_review(sitemap_url)` - runs sitemap_citation_map and recommends priorities
- **Resources** - cache views clients can read without firing tools:
  - `citation://cache/summary` - entry counts by type/engine, unique queries/URLs, oldest/newest
  - `citation://panels` - saved panels + per-panel snapshot counts
  - `citation://docs/llms-txt` - llms.txt primer (markdown)
  - `citation://docs/ai-crawlers` - AI crawlers cheatsheet (markdown)
  - `citation://domain/{domain}/cited-for` - dynamic resource template: citations for `{domain}` from the local cache

Compatibility:
- `Engine` type now includes `google_ai_mode`. All tools that previously took an `engine` enum accept it; the downstream tools (`am_i_cited`, `run_panel`) extend their enum to match.
- New dep: `robots-parser@3.0.1` for `crawler_access_audit`.

## 0.5.1 - 2026-05-21

- Switch OpenAI adapter default model to `gpt-4o-mini` (was `gpt-4.1-mini`). Removed the `OPENAI_MODEL` env override - the model is now hardcoded. Citations come from the `web_search_preview` tool, not model reasoning, so the smaller model has no impact on citation quality.

## 0.5.0 - 2026-05-21

Four new tools, a sixth search engine, and a per-host fetch gate.

New tools:
- `schema_audit(url)` - deep schema.org validation. Walks every JSON-LD block, checks required fields per `@type` (Article needs `headline`+`author`+`datePublished`, FAQPage needs `mainEntity`, HowTo needs `step`, etc.), and reports malformed JSON-LD. Returns issues list and valid/invalid verdict.
- `llms_txt_generator(sitemap_url, site_title, ...)` - generate an `llms.txt` (https://llmstxt.org spec) from a sitemap. Groups URLs by top-level path; optional `fetch_titles=true` pulls `<title>` for richer link text.
- `answer_box_position(query, engine?, max_results?)` - bin each cited URL's first mention in `raw_answer` into early/middle/late thirds. Surfaces whether your URL is cited up-front or buried.
- `citation_provenance(query, engines?, max_results?)` - fan a query out across multiple engines and report per-URL cross-engine consensus. Returns `consensus_urls` (URLs cited by ALL engines) and `engine_count` per URL.

New engine:
- `brave` adapter via Brave Web Search API (`BRAVE_API_KEY`; free tier 2000/month). `engine` enum on `check_citations` extended.

Infrastructure:
- Per-host concurrency + rate-limit middleware in `lib/fetch.ts`. Env: `CITATION_MAX_CONCURRENT_PER_HOST` (default 4), `CITATION_MIN_INTERVAL_MS_PER_HOST` (default 0). 429 responses logged.
- `OPENAI_MODEL` env var lets callers override the default `gpt-4.1-mini` model on the OpenAI adapter (citations come from the `web_search_preview` tool, so cheaper models cost less without losing citation quality).

## 0.4.0 - 2026-05-21

Three new tools + observability + test coverage.

New tools:
- `compete_for_query(query, your_url, engine?, max_competitors?)` - end-to-end competitive snapshot. Calls `check_citations` to find what an AI cites, then runs `compare_domains` on your URL vs the top cited competitors. Returns your score, average competitor score, and the gap.
- `citation_freshness_score(query, engine?, max_results?)` - scores how recent the pages cited for a query are. 0-100 recency_score with 365-day halflife, plus per-URL freshness bucket (fresh/current/stale/ancient/unknown). Surfaces queries where AI cites old content.
- `cited_for_diff(domain, baseline_until, current_since?, engine?)` - diff of `cited_for` between two time windows. Returns queries gained and lost. Cache-only, no API spend.

Observability:
- New `CITATION_LOG_LEVEL` env var (`debug` / `info` / `warn` / `error`, default `info`) controls stderr verbosity.
- Centralized `lib/log.ts` stderr logger; all tool logging routes through it.
- Startup line now includes resolved log level and full tool list.

Coverage:
- Smoke tests extended to all v0.2.0 tools (track_queries, run_panel, citation_trend, compare_domains, wikipedia_mentions, audit_sitemap) and the three new v0.4.0 tools.
- Log-level resolution covered by tests.

Internal: server `version` constant in `src/index.ts` was stale at `0.1.0`; now tracks `package.json`.

## 0.3.0 - 2026-05-21

Page-level scoring rewrite. `predict_citation` now discriminates between thin pages and deep articles on the same domain.

New signals on `predict_citation`:
- Content depth: `word_count`, `reading_time_minutes`, `h1_count`, `h2_count`, `h2_question_count`, `table_of_contents_present`, `image_count`
- Structured data (split out): `has_article_schema`, `has_faq_schema`, `has_howto_schema`, `has_breadcrumb_schema`
- Link graph: `internal_link_count`, `external_link_count`, `authority_link_count` (counts links to wikipedia, github, .gov, .edu, arxiv, MDN, etc.)
- Metadata hygiene: `title_length`, `meta_description_length`, `has_open_graph`, `has_twitter_card`
- Freshness: `date_modified_iso`, `last_modified_days_ago` (parsed from JSON-LD `dateModified`, `article:modified_time`, or `<time datetime>`)

`scoreSignals` rebalanced across six buckets: domain authority (25), structured data (20), content depth (20), link graph (12), freshness (8), metadata hygiene (10), transport (5).

`suggestFixes` adds actionable advice for thin content, missing FAQ schema when question H2s exist, stale freshness, missing authority links, missing TOC on long pages.

## 0.2.0 - 2026-05-21

7 new tools for editorial workflows + bulk audits.

- `track_queries(name, queries[], domain?, action)` - save / load / list named query panels
- `run_panel(name, domain?, engine?)` - run a panel through am_i_cited and snapshot to disk
- `citation_trend(panel, since?)` - time-series report of citation rate + per-query gained/lost deltas
- `compare_domains(urls[])` - side-by-side predict_citation across 2-10 URLs
- `wikipedia_mentions(domain, limit?, lang?)` - list Wikipedia articles referencing the domain
- `audit_sitemap(sitemap_url, limit?, concurrency?)` - bulk predict_citation across every URL in a sitemap
- `gsc_citation_gap(domain, queries[], start_date, end_date, ...)` - join GSC performance with AI citation status to surface "ranks in Google but invisible in AI" queries

Adds `google-auth-library` dependency for service-account auth in `gsc_citation_gap`.

## 0.1.0 - 2026-05-21

Initial release.

- `check_citations(query, engine?, max_results?)` - URLs cited by Perplexity, Claude, ChatGPT, Gemini, or Bing
- `am_i_cited(domain, queries[], engine?)` - presence and rank for a domain across a query cluster
- `ai_overview(query, location?, hl?)` - Google AI Overview presence and cited sources (SerpAPI)
- `cited_for(domain, since?, engine?, limit?)` - queries the domain was cited for, from local cache
- `predict_citation(url)` - 0-100 citation likelihood from public signals (Wikipedia, schema.org, llms.txt, GitHub, Reddit, canonical, HTTPS)
- Local JSON cache at `~/.config/citation-intelligence/cache.json`
- BYO API key passthrough; nothing stored remotely
