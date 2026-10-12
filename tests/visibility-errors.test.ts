import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/tools/check-citations.js", () => ({ checkCitations: vi.fn() }));
vi.mock("../src/tools/am-i-cited.js", () => ({ amICited: vi.fn() }));
vi.mock("../src/lib/panels.js", () => ({ loadPanel: vi.fn(), appendSnapshot: vi.fn() }));
import { checkCitations } from "../src/tools/check-citations.js";
import { amICited } from "../src/tools/am-i-cited.js";
import { appendSnapshot, loadPanel } from "../src/lib/panels.js";
import { visibilityReport } from "../src/tools/visibility-report.js";
import { runPanel } from "../src/tools/run-panel.js";
import { ToolFetchError } from "../src/lib/fetch.js";

const input = { domain: "example.com", queries: ["query"], engine: "perplexity" as const, max_results: 5, include_markdown: true };
describe("failed citation observations", () => {
  beforeEach(() => vi.resetAllMocks());
  it("preserves missing-key errors instead of fabricating zero citations", async () => {
    const error = new ToolFetchError({ type: "missing_key", engine: "perplexity", message: "Missing provider key" });
    vi.mocked(checkCitations).mockRejectedValue(error);
    await expect(visibilityReport(input)).rejects.toBe(error);
  });
  it("preserves a different fetch failure even after a successful query", async () => {
    vi.mocked(checkCitations).mockResolvedValueOnce({ engine: "perplexity", citations: [], raw_answer: "No source", query: "one", fetched_at: "2026-10-12", cached: false, surface: "consumer_scrape", interpretation_note: "fixture" });
    const error = new Error("Provider timeout");
    vi.mocked(checkCitations).mockRejectedValueOnce(error);
    await expect(visibilityReport({ ...input, queries: ["one", "two"] })).rejects.toBe(error);
  });
  it("keeps a successful observation without a target citation as a real zero", async () => {
    vi.mocked(checkCitations).mockResolvedValue({ engine: "perplexity", citations: [{ url: "https://other.example/page", rank: 1 }], raw_answer: "Recorded answer", query: "query", fetched_at: "2026-10-12", cached: false, surface: "consumer_scrape", interpretation_note: "fixture" });
    const report = await visibilityReport(input);
    expect(report.summary?.citation_rate).toBe(0);
    expect(report.top_domains?.length).toBe(1);
    expect(report.per_query?.[0].cited).toBe(false);
  });
  it("does not persist a panel snapshot without a successful engine", async () => {
    vi.mocked(loadPanel).mockResolvedValue({ name: "fixture", domain: "example.com", queries: ["query"], created_at: "2026-10-12", updated_at: "2026-10-12" });
    vi.mocked(amICited).mockResolvedValue({ mode: "multi_engine", per_engine: [], engines: [] } as never);
    await expect(runPanel({ name: "fixture", engine: "auto" })).rejects.toBeInstanceOf(ToolFetchError);
    expect(appendSnapshot).not.toHaveBeenCalled();
  });
  it("uses the successful engine rather than an earlier failed engine", async () => {
    vi.mocked(loadPanel).mockResolvedValue({ name: "fixture", domain: "example.com", queries: ["query"], created_at: "2026-10-12", updated_at: "2026-10-12" });
    vi.mocked(amICited).mockResolvedValue({ mode: "multi_engine", per_engine: [{ engine: "perplexity", ok: false, results: [] }, { engine: "claude", ok: true, results: [{ query: "query", cited: true, matching_urls: ["https://example.com/"] }] }] } as never);
    vi.mocked(appendSnapshot).mockResolvedValue("fixture-receipt");
    const report = await runPanel({ name: "fixture", engine: "auto" });
    expect(report.snapshot?.engine).toBe("claude");
    expect(report.snapshot?.summary.citation_rate).toBe(1);
  });
});
