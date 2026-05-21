// Smoke tests for Citation Intelligence MCP tools.
// Run with: npm test
// Most adapter tests are skipped if their API key is not set.

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point cache at a throwaway dir so the user's real cache isn't touched.
const tmpDir = mkdtempSync(join(tmpdir(), "citation-intel-test-"));
process.env["CITATION_CONFIG_DIR"] = tmpDir;

import { checkCitations } from "../src/tools/check-citations.js";
import { amICited } from "../src/tools/am-i-cited.js";
import { aiOverview } from "../src/tools/ai-overview.js";
import { citedFor } from "../src/tools/cited-for.js";
import { predictCitation } from "../src/tools/predict-citation.js";
import { ToolFetchError } from "../src/lib/fetch.js";

const hasPerplexity = Boolean(process.env["PERPLEXITY_API_KEY"]);
const hasSerpApi = Boolean(process.env["SERPAPI_KEY"]);

describe("check_citations input validation", () => {
  it("rejects empty query", async () => {
    await expect(
      checkCitations({ query: "", engine: "auto", max_results: 10 }),
    ).rejects.toBeDefined();
  });

  it("returns no_engine_available when no keys set", async () => {
    // Strip all engine keys for this test
    const saved: Record<string, string | undefined> = {};
    for (const k of [
      "PERPLEXITY_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "BING_API_KEY",
    ]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    try {
      await expect(
        checkCitations({ query: "test", engine: "auto", max_results: 10 }),
      ).rejects.toBeInstanceOf(ToolFetchError);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v !== undefined) process.env[k] = v;
      }
    }
  });
});

describe.skipIf(!hasPerplexity)("check_citations with Perplexity", () => {
  it("returns citations for a query", async () => {
    const res = await checkCitations({
      query: "model context protocol",
      engine: "perplexity",
      max_results: 5,
    });
    expect(res.engine).toBe("perplexity");
    expect(Array.isArray(res.citations)).toBe(true);
  });
});

describe("am_i_cited input validation", () => {
  it("rejects empty queries array", async () => {
    await expect(
      amICited({ domain: "example.com", queries: [], engine: "auto" }),
    ).rejects.toBeDefined();
  });
});

describe.skipIf(!hasSerpApi)("ai_overview with SerpAPI", () => {
  it("returns a structured result", async () => {
    const res = await aiOverview({ query: "what is mcp", hl: "en" });
    expect(typeof res.ai_overview_present).toBe("boolean");
    expect(Array.isArray(res.sources)).toBe(true);
  });
});

describe("cited_for", () => {
  it("returns empty for an unknown domain on a fresh cache", async () => {
    const res = await citedFor({ domain: "nope-no-such-domain.invalid", limit: 50 });
    expect(res.total).toBe(0);
    expect(res.results).toEqual([]);
  });
});

describe("predict_citation", () => {
  it("scores a URL with reachable signals", async () => {
    const res = await predictCitation({ url: "https://example.com" });
    expect(typeof res.score).toBe("number");
    expect(res.score).toBeGreaterThanOrEqual(0);
    expect(res.score).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"]).toContain(res.grade);
    expect(typeof res.signals.https).toBe("boolean");
  }, 30_000);

  it("rejects an invalid URL", async () => {
    await expect(predictCitation({ url: "not-a-url" })).rejects.toBeDefined();
  });
});
