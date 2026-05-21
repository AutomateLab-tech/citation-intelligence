import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.js";
import { citedForDomain } from "../lib/cache.js";
import { log } from "../lib/log.js";

export const sitemapCitationMapInputSchema = {
  sitemap_url: z
    .string()
    .url()
    .describe("URL of sitemap.xml (or a sitemap index). Nested sitemaps are followed."),
  domain: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Domain to look up citations for. If omitted, inferred from the sitemap host.",
    ),
  since: z
    .string()
    .optional()
    .describe("ISO date floor; only count citations recorded on or after this date."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .default(500)
    .describe("Max sitemap URLs to consider."),
};

const inputSchema = z.object(sitemapCitationMapInputSchema);

async function parseSitemap(url: string, depth = 0): Promise<string[]> {
  if (depth > 2) return [];
  const { text } = await fetchText(url, { timeoutMs: 15_000 });
  const $ = cheerio.load(text, { xmlMode: true });
  const childSitemaps = $("sitemap > loc")
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean);
  if (childSitemaps.length > 0) {
    const nested = await Promise.all(childSitemaps.map((s) => parseSitemap(s, depth + 1)));
    return nested.flat();
  }
  return $("url > loc")
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean);
}

function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = "";
    let p = parsed.pathname.replace(/\/+$/, "") || "/";
    parsed.pathname = p;
    return parsed.toString().toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

export async function sitemapCitationMap(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  log.debug("sitemap_citation_map start", { sitemap_url: parsed.sitemap_url });

  const inferredDomain =
    parsed.domain ?? (() => {
      try {
        return new URL(parsed.sitemap_url).hostname;
      } catch {
        return "";
      }
    })();
  if (!inferredDomain) {
    return {
      sitemap_url: parsed.sitemap_url,
      total_urls: 0,
      mapped: 0,
      unmapped: 0,
      message: "could not infer domain from sitemap_url and no domain provided",
    };
  }

  const urls = (await parseSitemap(parsed.sitemap_url)).slice(0, parsed.limit);
  if (urls.length === 0) {
    return {
      sitemap_url: parsed.sitemap_url,
      domain: inferredDomain,
      total_urls: 0,
      mapped: 0,
      unmapped: 0,
      message: "no URLs found in sitemap",
    };
  }

  const citations = await citedForDomain(
    inferredDomain,
    parsed.since,
    undefined,
    100_000,
  );

  // Bucket cached citations by normalized URL.
  const byUrl = new Map<
    string,
    {
      queries: Set<string>;
      engines: Set<string>;
      last_seen: string;
      raw_urls: Set<string>;
    }
  >();
  for (const c of citations) {
    const norm = normalizeUrl(c.url);
    let entry = byUrl.get(norm);
    if (!entry) {
      entry = {
        queries: new Set<string>(),
        engines: new Set<string>(),
        last_seen: c.fetched_at,
        raw_urls: new Set<string>(),
      };
      byUrl.set(norm, entry);
    }
    entry.queries.add(c.query);
    entry.engines.add(c.engine);
    entry.raw_urls.add(c.url);
    if (c.fetched_at > entry.last_seen) entry.last_seen = c.fetched_at;
  }

  type MappedRow = {
    url: string;
    citation_count: number;
    unique_queries: number;
    engines: string[];
    last_seen: string;
    sample_queries: string[];
  };
  type UnmappedRow = { url: string };

  const mapped: MappedRow[] = [];
  const unmapped: UnmappedRow[] = [];

  for (const u of urls) {
    const norm = normalizeUrl(u);
    const hit = byUrl.get(norm);
    if (!hit) {
      unmapped.push({ url: u });
      continue;
    }
    const sampleQueries = [...hit.queries].slice(0, 5);
    mapped.push({
      url: u,
      citation_count: citations.filter((c) => normalizeUrl(c.url) === norm).length,
      unique_queries: hit.queries.size,
      engines: [...hit.engines].sort(),
      last_seen: hit.last_seen,
      sample_queries: sampleQueries,
    });
  }

  mapped.sort((a, b) => b.citation_count - a.citation_count || b.unique_queries - a.unique_queries);

  // Bucket sitemap URLs that aren't mapped, ranked by traffic potential isn't
  // available here - emit deterministically (alphabetical, top first).
  unmapped.sort((a, b) => a.url.localeCompare(b.url));

  return {
    sitemap_url: parsed.sitemap_url,
    domain: inferredDomain,
    since: parsed.since,
    fetched_at: new Date().toISOString(),
    total_urls: urls.length,
    mapped: mapped.length,
    unmapped: unmapped.length,
    coverage_pct: urls.length === 0 ? 0 : Math.round((mapped.length / urls.length) * 1000) / 10,
    citations_in_cache: citations.length,
    mapped_urls: mapped,
    unmapped_urls: unmapped.slice(0, 200),
    note:
      "mapped_urls = sitemap URLs that appear in the citation cache. unmapped_urls = sitemap URLs the cache has never seen cited (next-action candidates). Coverage_pct = mapped / total_urls. Cache must be primed first via check_citations or run_panel.",
  };
}
