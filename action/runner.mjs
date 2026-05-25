#!/usr/bin/env node
// Runs inside the Docker image built from the repo Dockerfile.
// Calls amICited() directly from compiled dist — no MCP server overhead.

import { appendFileSync } from "fs";

// Remap INPUT_* env vars to the names the tools check for.
const keyMap = {
  PERPLEXITY_API_KEY: process.env.INPUT_PERPLEXITY_API_KEY,
  ANTHROPIC_API_KEY:  process.env.INPUT_ANTHROPIC_API_KEY,
  OPENAI_API_KEY:     process.env.INPUT_OPENAI_API_KEY,
  GEMINI_API_KEY:     process.env.INPUT_GEMINI_API_KEY,
  SERPAPI_KEY:        process.env.INPUT_SERPAPI_KEY,
};
for (const [k, v] of Object.entries(keyMap)) {
  if (v?.trim()) process.env[k] = v.trim();
}

const domain         = (process.env.INPUT_DOMAIN   || "").trim();
const queries        = (process.env.INPUT_QUERIES  || "").split("\n").map(q => q.trim()).filter(Boolean);
const engine         = (process.env.INPUT_ENGINE   || "auto").trim();
const failIfNotCited =  process.env.INPUT_FAIL_IF_NOT_CITED === "true";

if (!domain) {
  console.error("::error::Input 'domain' is required");
  process.exit(1);
}
if (!queries.length) {
  console.error("::error::Input 'queries' must contain at least one non-empty line");
  process.exit(1);
}

const { amICited } = await import("/app/dist/tools/am-i-cited.js");

console.log(`\nCitation Intelligence — checking '${domain}'`);
console.log(`Engine: ${engine}  |  Queries: ${queries.length}`);
queries.forEach((q, i) => console.log(`  ${i + 1}. ${q}`));
console.log();

const result = await amICited({ domain, queries, engine });

let cited        = false;
let citationRate = 0;

if (result.mode === "multi_engine") {
  cited        = (result.consensus?.queries_cited_by_all ?? 0) > 0;
  citationRate =  result.consensus?.consensus_rate        ?? 0;
} else {
  cited        = (result.summary?.queries_cited ?? 0) > 0;
  citationRate =  result.summary?.citation_rate  ?? 0;
}

console.log(`Cited: ${cited}  |  Citation rate: ${(citationRate * 100).toFixed(1)}%`);
console.log(JSON.stringify(result, null, 2));

const outputFile = process.env.GITHUB_OUTPUT;
if (outputFile) {
  appendFileSync(outputFile, `cited=${cited}\n`);
  appendFileSync(outputFile, `citation_rate=${citationRate}\n`);
  const encoded = JSON.stringify(result);
  appendFileSync(outputFile, `result<<EOF\n${encoded}\nEOF\n`);
}

if (failIfNotCited && !cited) {
  console.error(`::error::${domain} was not cited for any of the provided queries.`);
  process.exit(1);
}
