# Contributing

Bug reports and PRs welcome.

## Dev setup

```bash
git clone https://github.com/AutomateLab-tech/citation-intelligence
cd citation-intelligence
npm install
npm run build
```

Run the server locally with `npm start`. For development with hot reload: `npm run dev`.

## Project layout

```
src/
  index.ts                  # MCP server entry, registers all 5 tools
  types.ts                  # shared types
  lib/
    config.ts               # env vars, cache paths
    cache.ts                # local JSON cache
    fetch.ts                # undici wrapper with timeouts + ToolFetchError
  adapters/
    perplexity.ts           # Sonar API
    serpapi.ts              # Google AI Overview
    bing.ts                 # Bing Web Search
    anthropic.ts            # Claude with web_search tool
    openai.ts               # ChatGPT via Responses API
    gemini.ts               # Gemini with google_search grounding
    predictors.ts           # Wikipedia, GitHub, Reddit, schema.org, llms.txt
  tools/
    check-citations.ts
    am-i-cited.ts
    ai-overview.ts
    cited-for.ts
    predict-citation.ts
```

## Adding an engine

1. Create `src/adapters/<engine>.ts` returning an `AdapterResult`.
2. Add it to the `Engine` type in `src/types.ts`.
3. Wire it into `runEngine` and `pickAutoEngine` in `src/tools/check-citations.ts`.
4. Add a smoke test in `tests/`.

## Tests

```bash
npm test
```

Smoke tests live in `tests/smoke.test.ts`. They run with no API keys configured and verify each tool returns either a sane result or a structured `missing_key` error.

## Style

- No em-dashes. Use `-`.
- All logging goes to stderr (`console.error`). stdout is reserved for JSON-RPC.
- Errors flow through `ToolFetchError` so the MCP layer can serialize a typed `ToolError`.
