import { ToolFetchError } from "../lib/fetch.js";
import type { AdapterResult } from "../types.js";

// The Bing Web Search API that backed this adapter was retired by Microsoft on
// 2025-08-11, so bing_serp can no longer return results. We keep the export and
// signature so check-citations.ts's switch still compiles, but fail clearly and
// immediately. For Bing rank data, use the signals.bing_gap tool, which calls
// the Bing Webmaster Tools API (BING_WEBMASTER_API_KEY) instead.
export async function bingSearch(
  _query: string,
  _maxResults: number,
): Promise<AdapterResult> {
  throw new ToolFetchError({
    type: "invalid_input",
    field: "engine",
    message:
      "The Bing Web Search API (bing_serp) was retired on 2025-08-11. " +
      "Use the signals.bing_gap tool (BING_WEBMASTER_API_KEY) for Bing Webmaster rank data instead.",
  });
}
