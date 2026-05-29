// Bing Webmaster Tools (BWT) adapter - site-level query stats for the
// signals.bing_gap tool. Bing's index backs Copilot, ChatGPT, and Perplexity
// grounding, so a Bing rank gap is an LLM-citation gap.
//
// Auth: BING_WEBMASTER_API_KEY. Generate it in Bing Webmaster Tools ->
//   Settings -> API Access. One key per user covers all verified sites.
// Site: the verified https origin exactly as Bing stores it, WITH a trailing
//   slash (e.g. https://example.com/). Bing has no sc-domain: form.
//
// Transport: we call the POX (XML) endpoint, not JSON. The
//   /webmaster/api.svc/json/ route returns HTTP 503 from many networks, while
//   /webmaster/api.svc/pox/ serves the identical data as XML. The default
//   non-browser app UA on fetchText is REQUIRED here: the BWT edge serves a 503
//   HTML page to browser-like / curl UAs on this path; a plain app UA gets 200.
//
// A QueryStats row = { Query, Impressions, Clicks, AvgImpressionPosition,
//   AvgClickPosition, Date }. Rows are a WEEKLY time series: one row per query
//   per Date. We sum clicks/impressions and impression-weight the position
//   across the window. Dates are ISO 8601 (e.g. "2026-05-22T00:00:00").

import { envKey } from "../lib/config.js";
import { fetchText, ToolFetchError } from "../lib/fetch.js";

const BWT_BASE = "https://ssl.bing.com/webmaster/api.svc/pox";

export type BingQueryStat = {
  query: string;
  impressions: number;
  clicks: number;
  position: number;
};

// Decode the five predefined XML entities plus numeric character refs. &amp; is
// decoded last so an already-escaped "&amp;lt;" doesn't get double-decoded.
function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagText(block: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block);
  return m ? decodeXml(m[1]) : "";
}

type Agg = { clicks: number; impressions: number; posWeighted: number };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Pure parse + aggregate. Collapses the flat POX
// <ArrayOfQueryStats><QueryStats>...</QueryStats>...</> weekly time series into
// one row per query: sum impressions + clicks, impression-weight the position.
// Exported separately so it can be unit-tested without a live key.
export function summarizeBingQueryStats(xml: string): BingQueryStat[] {
  const byQuery = new Map<string, Agg>();
  const re = /<QueryStats>([\s\S]*?)<\/QueryStats>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const query = tagText(b, "Query");
    const impressions = Number(tagText(b, "Impressions")) || 0;
    const clicks = Number(tagText(b, "Clicks")) || 0;
    const avgPos = Number(tagText(b, "AvgImpressionPosition")) || 0;
    const a = byQuery.get(query) ?? { clicks: 0, impressions: 0, posWeighted: 0 };
    a.clicks += clicks;
    a.impressions += impressions;
    a.posWeighted += avgPos * impressions;
    byQuery.set(query, a);
  }
  return Array.from(byQuery.entries())
    .map(([query, a]) => ({
      query,
      impressions: a.impressions,
      clicks: a.clicks,
      position: a.impressions > 0 ? round1(a.posWeighted / a.impressions) : 0,
    }))
    .sort((x, y) => y.impressions - x.impressions);
}

// Fetch the verified site's top queries from BWT. siteUrl is the verified https
// origin with a trailing slash (e.g. https://example.com/). Retries on 503/502/
// 429 (the edge throws intermittent 503s) up to 3 times with linear backoff.
export async function fetchBingQueryStats(siteUrl: string): Promise<BingQueryStat[]> {
  const apikey = envKey("BING_WEBMASTER_API_KEY");
  if (!apikey) {
    throw new ToolFetchError({
      type: "missing_key",
      engine: "bing_serp",
      env_var: "BING_WEBMASTER_API_KEY",
      message:
        "Set BING_WEBMASTER_API_KEY to use the Bing Webmaster engine. " +
        "Generate a key at https://www.bing.com/webmasters (Settings -> API Access).",
    });
  }

  const params = new URLSearchParams({ apikey, siteUrl });
  const url = `${BWT_BASE}/GetQueryStats?${params.toString()}`;

  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text, status } = await fetchText(url, {
      headers: { accept: "application/xml" },
    });
    if (status >= 200 && status < 300) {
      return summarizeBingQueryStats(text);
    }
    lastStatus = status;
    if (status !== 503 && status !== 502 && status !== 429) break;
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  throw new ToolFetchError({
    type: "fetch_error",
    url,
    status: lastStatus,
    message: `Bing Webmaster GetQueryStats: HTTP ${lastStatus}`,
  });
}
