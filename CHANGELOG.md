# Changelog

## 0.1.0 - 2026-05-21

Initial release.

- `check_citations(query, engine?, max_results?)` - URLs cited by Perplexity, Claude, ChatGPT, Gemini, or Bing
- `am_i_cited(domain, queries[], engine?)` - presence and rank for a domain across a query cluster
- `ai_overview(query, location?, hl?)` - Google AI Overview presence and cited sources (SerpAPI)
- `cited_for(domain, since?, engine?, limit?)` - queries the domain was cited for, from local cache
- `predict_citation(url)` - 0-100 citation likelihood from public signals (Wikipedia, schema.org, llms.txt, GitHub, Reddit, canonical, HTTPS)
- Local JSON cache at `~/.config/citation-intelligence/cache.json`
- BYO API key passthrough; nothing stored remotely
