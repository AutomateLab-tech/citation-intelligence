# Surface fidelity: what each engine result actually measures

Every tool response includes an `interpretation_note` field that summarizes
this table in one sentence. Read it before drawing conclusions.

## Surface types

| Surface | What it means |
|---|---|
| `consumer_scrape` | Result proxied from a real consumer-facing AI search product. Closest to what your users see. |
| `api_proxy` | API call to a search-enabled LLM. May differ from consumer product — different model tier, no UI-level ranking, no personalization. Use as a directional signal, not ground truth. |
| `web_rank` | Traditional SERP rank. Measures whether a URL appears in search results, NOT whether an LLM cites it. |
| `static_signal` | Offline signal computed from public data. No live query. |

## Per-engine fidelity

### `google_ai_mode` — `consumer_scrape` ★★★★★

**`SERPAPI_KEY`** — SerpAPI scrapes the real Google AI Overview (the AI-generated summary at the top of google.com search results). This is pixel-accurate to what google.com desktop users see. Requires a SerpAPI key with AI Overview access enabled.

**When to use:** Best proxy for Google AI Mode citations. Use this as your benchmark if you have a `SERPAPI_KEY`.

**Caveat:** SerpAPI is a scrape of a live page, so results vary with locale, personalization, and test timing. Geographic variation can be significant.

---

### `perplexity` — `consumer_scrape` ★★★★☆

**`PERPLEXITY_API_KEY`** — `sonar-pro` API with a consumer-equivalent system prompt. Perplexity's API is the closest public API to the Perplexity.ai product.

**`interpretation_note`:** "sonar-pro API with a consumer-equivalent system prompt. Real perplexity.ai users may see sonar-reasoning-pro with multi-turn follow-ups."

**When to use:** Default `auto` engine when no `SERPAPI_KEY` is configured. Very good fidelity for Perplexity.ai citations.

**Caveat:** Perplexity.ai's consumer product uses sonar-reasoning-pro for complex queries and does multi-turn refinement. The API does one-shot queries. Citation differences are real but usually minor.

---

### `openai` — `api_proxy` ★★★☆☆

**`OPENAI_API_KEY`** — `gpt-4o-search-preview` via the Responses API with `web_search_preview` tool. This is the model OpenAI built to approximate SearchGPT behavior.

**`interpretation_note`:** "gpt-4o-search-preview API. Real chatgpt.com users get gpt-4o + SearchGPT with different ranking and UI-level re-scoring."

**When to use:** Reasonable proxy for ChatGPT web search citations. Better than `gpt-4o-mini` (the old default), worse than a direct ChatGPT product scrape.

**Caveat:** ChatGPT's consumer product applies UI-level ranking and re-scoring that the API doesn't expose. Citation behavior can differ materially for ambiguous queries. Treat as directional.

---

### `claude` — `api_proxy` ★★★☆☆

**`ANTHROPIC_API_KEY`** — `claude-sonnet-4-7` via the Anthropic Messages API with `web_search` tool enabled (max 5 uses).

**`interpretation_note`:** "claude-sonnet-4-7 API with web_search tool (max 5 uses). Real claude.ai users get a different model tier and citation UI."

**When to use:** Directional proxy for Claude.ai web search citations.

**Caveat:** Claude.ai's consumer product uses different model routing, does multi-turn refinement, and has a distinct citation UI. API results are directional — useful for relative comparisons but not for absolute "Claude cites me" claims.

---

### `gemini` — `api_proxy` ★★★☆☆

**`GEMINI_API_KEY`** — `gemini-2.5-pro` via the Generative Language API with `google_search` grounding.

**`interpretation_note`:** "gemini-2.5-pro API with google_search grounding. Real gemini.google.com uses the same grounding index but different re-ranking."

**When to use:** Directional proxy for Gemini.google.com citations.

**Caveat:** Gemini's consumer app uses the same Google Search grounding index but different re-ranking and result selection. Citation patterns are similar but not identical.

---

### `bing_serp` — `web_rank` ★★☆☆☆

**`BING_API_KEY`** — Bing Web Search API v7.

**`interpretation_note`:** "Bing Web Search API — traditional SERP rank, NOT LLM citation behavior."

**When to use:** Comparing web SERP rank against LLM citation rank for the same query. Not for "does Bing AI cite me?" questions.

**Caveat:** `am_i_cited` refuses this engine — it only measures LLM behavior. Use `check_citations` directly with `engine=bing_serp` for SERP rank data.

---

### `brave_serp` — `web_rank` ★★☆☆☆

**`BRAVE_API_KEY`** — Brave Search API.

**`interpretation_note`:** "Brave Search API — traditional SERP rank, NOT LLM citation behavior."

**When to use:** Same as `bing_serp` — SERP rank comparison only.

**Caveat:** Same as `bing_serp`. Free tier: 2000 queries/month; built-in 1.1 s delay between calls to avoid 429.

---

## Honest use of this data

1. **Never report API-proxy results as "ChatGPT/Claude/Gemini cites you"** without the `interpretation_note` caveat. The API and the consumer product behave differently.

2. **Prefer `google_ai_mode` + `perplexity`** when you want results closest to real consumer behavior.

3. **Use `citation_provenance` for multi-engine consensus.** A URL with `engine_count=4` (cited by 4 of 5 engines) is a strong signal. `engine_count=1` is engine-specific and may not generalize.

4. **Use `am_i_cited` with `engine=auto`** to get the full picture for your domain in one call.

5. **Watch for recency bias.** LLM search engines favor recently-indexed content. Compare results across different days before concluding something is or isn't cited.
