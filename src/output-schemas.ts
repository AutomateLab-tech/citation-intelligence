// Output schemas mirroring the result interfaces in tools/*.ts.
// Used by registerTool so MCP clients can type-check tool responses.
// Each schema captures the key top-level fields; runtime extras pass through.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

/** A single URL cited by an AI engine. */
const citationSchema = z.object({
  url: z.string().describe("Cited URL."),
  rank: z.number().describe("1-based citation rank."),
  title: z.string().optional().describe("Page title as returned by the engine."),
  snippet: z.string().optional().describe("Short excerpt the engine surfaced."),
});

/** Per-query result from amICited. */
const perQueryResultSchema = z.object({
  query: z.string(),
  cited: z.boolean().describe("Whether the domain was cited for this query."),
  rank: z.number().optional().describe("1-based rank of the first matching citation."),
  matching_urls: z.array(z.string()).describe("Matching citation URLs found."),
});

/** Summary stats used in amICited and runPanel. */
const citationSummarySchema = z.object({
  queries_total: z.number(),
  queries_cited: z.number(),
  citation_rate: z.number().describe("Fraction of queries where domain was cited (0-1)."),
  average_rank: z.number().optional().describe("Average rank across cited queries."),
});

// ---------------------------------------------------------------------------
// check_citations
// ---------------------------------------------------------------------------

export const checkCitationsOutputShape = {
  query: z.string().describe("The query that was executed."),
  engine: z.string().describe("Engine used for this response."),
  surface: z.string().describe("Engine surface type: consumer_scrape, api_proxy, or web_rank."),
  interpretation_note: z.string().describe("Guidance on how to interpret results from this engine."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp of the fetch."),
  citations: z.array(citationSchema).describe("Cited URLs ordered by rank."),
  raw_answer: z.string().nullable().describe("Raw answer text from the engine, if available."),
  cached: z.boolean().describe("Whether the result was served from the local cache."),
} as const;

// ---------------------------------------------------------------------------
// am_i_cited
// ---------------------------------------------------------------------------

export const amICitedOutputShape = {
  domain: z.string().describe("The domain that was checked."),
  mode: z.enum(["single_engine", "multi_engine"]).describe("Whether one or multiple engines were queried."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  // single-engine fields (present when mode=single_engine)
  engine: z.string().optional().describe("Engine used (single_engine mode only)."),
  surface: z.string().optional().describe("Engine surface type (single_engine mode only)."),
  results: z.array(perQueryResultSchema).optional().describe("Per-query results (single_engine mode)."),
  summary: citationSummarySchema.optional().describe("Aggregate summary (single_engine mode)."),
  // multi-engine fields (present when mode=multi_engine)
  engines: z.array(z.object({
    engine: z.string(),
    surface: z.string().optional(),
    ok: z.boolean(),
    queries_cited: z.number().optional(),
    citation_rate: z.number().optional(),
  })).optional().describe("Per-engine summary rows (multi_engine mode)."),
  per_engine: z.array(z.record(z.string(), z.unknown())).optional().describe("Full per-engine detail (multi_engine mode)."),
  consensus: z.record(z.string(), z.unknown()).optional().describe("Cross-engine consensus stats (multi_engine mode)."),
} as const;

// ---------------------------------------------------------------------------
// ai_overview
// ---------------------------------------------------------------------------

export const aiOverviewOutputShape = {
  query: z.string().describe("The query checked."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  ai_overview_present: z.boolean().describe("Whether Google returned an AI Overview for this query."),
  ai_overview_text: z.string().nullable().describe("AI Overview text, if present."),
  sources: z.array(z.object({
    url: z.string(),
    title: z.string().optional(),
  })).describe("URLs cited in the AI Overview."),
  cached: z.boolean().describe("Whether the result was served from local cache."),
} as const;

// ---------------------------------------------------------------------------
// cited_for
// ---------------------------------------------------------------------------

export const citedForOutputShape = {
  domain: z.string().describe("Domain that was looked up."),
  since: z.string().optional().describe("ISO date floor applied, if any."),
  engine_filter: z.string().optional().describe("Engine filter applied, if any."),
  results: z.array(z.object({
    query: z.string(),
    engine: z.string(),
    rank: z.number(),
    url: z.string(),
    fetched_at: z.string(),
  })).describe("Cache entries where this domain was cited."),
  total: z.number().describe("Total entries returned."),
  source: z.literal("local_cache").describe("Always 'local_cache' — no external calls made."),
} as const;

// ---------------------------------------------------------------------------
// predict_citation
// ---------------------------------------------------------------------------

export const predictCitationOutputShape = {
  url: z.string().describe("URL that was scored."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  score: z.number().min(0).max(100).describe("0-100 citation likelihood score."),
  grade: z.string().describe("Letter grade (A-F) derived from the score."),
  signals: z.record(z.string(), z.unknown()).describe("Per-signal boolean/numeric values used to compute the score."),
  fixes: z.array(z.object({
    signal: z.string(),
    suggestion: z.string(),
  })).describe("Ranked list of concrete improvements to raise the score."),
} as const;

// ---------------------------------------------------------------------------
// track_queries
// ---------------------------------------------------------------------------

export const trackQueriesOutputShape = {
  // action=save
  saved: z.boolean().optional().describe("True when action=save succeeded."),
  panel: z.record(z.string(), z.unknown()).optional().describe("The panel object that was saved or loaded."),
  // action=list
  panels: z.array(z.unknown()).optional().describe("All panel names (action=list)."),
  // error case
  error: z.string().optional().describe("Error message when the panel was not found."),
} as const;

// ---------------------------------------------------------------------------
// run_panel
// ---------------------------------------------------------------------------

export const runPanelOutputShape = {
  saved_to: z.string().describe("Absolute file path of the snapshot that was written."),
  snapshot: z.object({
    panel: z.string(),
    domain: z.string(),
    engine: z.string(),
    taken_at: z.string(),
    per_query: z.array(perQueryResultSchema),
    summary: citationSummarySchema,
  }).describe("The snapshot that was appended."),
} as const;

// ---------------------------------------------------------------------------
// citation_trend
// ---------------------------------------------------------------------------

export const citationTrendOutputShape = {
  panel: z.string().describe("Panel name."),
  domain: z.string().optional().describe("Domain tracked by the panel."),
  snapshots: z.number().describe("Number of snapshots available."),
  first_taken_at: z.string().optional().describe("Timestamp of the oldest snapshot."),
  last_taken_at: z.string().optional().describe("Timestamp of the newest snapshot."),
  series: z.array(z.object({
    taken_at: z.string(),
    engine: z.string(),
    queries_total: z.number(),
    queries_cited: z.number(),
    citation_rate: z.number().describe("Citation rate at this snapshot (0-1)."),
  })).describe("Time-series of citation rates, one entry per snapshot."),
  query_deltas: z.array(z.object({
    query: z.string(),
    change: z.enum(["gained", "lost", "unchanged"]),
    first: z.boolean(),
    last: z.boolean(),
  })).describe("Per-query changes between first and last snapshot."),
} as const;

// ---------------------------------------------------------------------------
// compare_domains
// ---------------------------------------------------------------------------

export const compareDomainsOutputShape = {
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  rows: z.array(z.record(z.string(), z.unknown())).describe("Per-URL predict_citation rows (or { url, error } on failure)."),
  diverging_signals: z.array(z.object({
    signal: z.string().describe("Signal name where URLs differ."),
    per_url: z.array(z.object({ url: z.string(), value: z.boolean() })),
  })).describe("Signals where at least one URL differs from the others."),
} as const;

// ---------------------------------------------------------------------------
// wikipedia_mentions
// ---------------------------------------------------------------------------

export const wikipediaMentionsOutputShape = {
  domain: z.string().describe("Domain that was searched."),
  lang: z.string().describe("Wikipedia language subdomain used."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  total: z.number().describe("Number of Wikipedia articles referencing this domain."),
  mentions: z.array(z.object({
    article_title: z.string().optional().describe("Wikipedia article title."),
    article_url: z.string().optional().describe("Full Wikipedia article URL."),
    cited_url: z.string().optional().describe("The specific external URL referenced."),
  })).describe("List of Wikipedia articles that cite the domain."),
} as const;

// ---------------------------------------------------------------------------
// audit_sitemap
// ---------------------------------------------------------------------------

export const auditSitemapOutputShape = {
  sitemap_url: z.string().describe("The sitemap URL that was audited."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  total_urls: z.number().describe("Total URLs found in the sitemap."),
  audited: z.number().describe("Number of URLs that were scored."),
  average_score: z.number().describe("Mean predict_citation score across scored URLs."),
  worst_first: z.array(z.object({
    url: z.string(),
    score: z.number(),
    grade: z.string(),
    signals: z.record(z.string(), z.unknown()),
    top_fix: z.string().optional().describe("Top suggested fix for this URL."),
  })).describe("Up to 20 lowest-scoring URLs, worst first."),
  errors: z.array(z.object({
    url: z.string(),
    error: z.string(),
  })).describe("URLs whose audit threw an error."),
} as const;

// ---------------------------------------------------------------------------
// compete_for_query
// ---------------------------------------------------------------------------

export const competeForQueryOutputShape = {
  query: z.string().describe("The query that was tested."),
  engine: z.string().describe("Engine used for the citation fetch."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  your_url: z.string().describe("Your URL that was benchmarked."),
  your_score: z.number().nullable().describe("predict_citation score for your URL (null on error)."),
  your_in_citations: z.boolean().describe("Whether your URL appeared in the engine's citation list."),
  competitors: z.array(z.string()).describe("Competitor URLs that were compared."),
  average_competitor_score: z.number().nullable().describe("Mean score across competitor URLs."),
  score_gap: z.number().nullable().describe("your_score minus average_competitor_score."),
  comparison: z.record(z.string(), z.unknown()).nullable().describe("Full compare_domains result."),
} as const;

// ---------------------------------------------------------------------------
// citation_freshness_score
// ---------------------------------------------------------------------------

export const citationFreshnessScoreOutputShape = {
  query: z.string().describe("The query whose citations were scored."),
  engine: z.string().describe("Engine used."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  recency_score: z.number().min(0).max(100).describe("0-100 average recency weight across cited URLs (halflife=365d)."),
  average_days_old: z.number().nullable().describe("Mean age in days across URLs with a detectable dateModified."),
  buckets: z.object({
    fresh: z.number().describe("URLs modified within 180 days."),
    current: z.number().describe("URLs modified within 181-365 days."),
    stale: z.number().describe("URLs modified within 366-730 days."),
    ancient: z.number().describe("URLs older than 730 days."),
    unknown: z.number().describe("URLs with no detectable modification date."),
  }).describe("Freshness bucket distribution."),
  per_url: z.array(z.record(z.string(), z.unknown())).describe("Per-URL freshness details."),
  note: z.string().optional(),
} as const;

// ---------------------------------------------------------------------------
// cited_for_diff
// ---------------------------------------------------------------------------

export const citedForDiffOutputShape = {
  domain: z.string().describe("Domain that was diffed."),
  engine_filter: z.string().optional().describe("Engine filter applied, if any."),
  baseline_until: z.string().describe("Upper bound of the baseline window."),
  current_since: z.string().describe("Lower bound of the current window."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  counts: z.object({
    baseline_unique_queries: z.number(),
    current_unique_queries: z.number(),
    gained: z.number().describe("Queries newly cited in the current window."),
    lost: z.number().describe("Queries cited in baseline but not current."),
    unchanged: z.number().describe("Queries cited in both windows."),
  }),
  gained: z.array(z.object({
    query: z.string(),
    engine: z.string(),
    rank: z.number(),
    fetched_at: z.string(),
    url: z.string(),
  })).describe("Queries gained (newly cited) since the baseline."),
  lost: z.array(z.object({
    query: z.string(),
    engine: z.string(),
    fetched_at: z.string(),
    url: z.string(),
  })).describe("Queries lost (were cited, no longer are)."),
  unchanged_queries: z.array(z.string()).describe("Queries cited in both windows."),
  source: z.literal("local_cache"),
} as const;

// ---------------------------------------------------------------------------
// gsc_citation_gap
// ---------------------------------------------------------------------------

export const gscCitationGapOutputShape = {
  domain: z.string().describe("Domain analyzed."),
  site_url: z.string().describe("GSC siteUrl used."),
  range: z.object({ start: z.string(), end: z.string() }).describe("GSC date range."),
  engine: z.string().optional().describe("Engine used for the citation check."),
  rows: z.array(z.object({
    query: z.string(),
    gsc: z.object({
      impressions: z.number(),
      clicks: z.number(),
      position: z.number().optional(),
      ctr: z.number().optional(),
    }),
    ai_cited: z.boolean().describe("Whether the domain was cited by the AI engine for this query."),
    ai_rank: z.number().optional(),
  })).describe("Per-query GSC + AI citation cross-reference."),
  closest_wins: z.array(z.record(z.string(), z.unknown())).describe("Queries where domain ranks in Google top-10 but is not AI-cited (the editorial gap)."),
} as const;

// ---------------------------------------------------------------------------
// schema_audit
// ---------------------------------------------------------------------------

export const schemaAuditOutputShape = {
  url: z.string().describe("URL that was audited."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  json_ld_blocks: z.number().describe("Total JSON-LD blocks found."),
  json_ld_parse_errors: z.number().describe("Number of JSON-LD blocks that failed to parse."),
  schema_types_present: z.array(z.string()).describe("@type values found across all JSON-LD blocks."),
  microdata_types_present: z.array(z.string()).describe("Schema types found via microdata (itemtype)."),
  issues: z.array(z.object({
    type: z.string(),
    path: z.string(),
    severity: z.enum(["error", "warning"]),
    message: z.string(),
  })).describe("Validation issues found."),
  summary: z.object({
    blocks: z.number(),
    typed_nodes: z.number(),
    errors: z.number(),
    warnings: z.number(),
    valid: z.boolean().describe("True when no typed node is missing a required field."),
  }),
  note: z.string().optional(),
} as const;

// ---------------------------------------------------------------------------
// llms_txt_generator
// ---------------------------------------------------------------------------

export const llmsTxtGeneratorOutputShape = {
  sitemap_url: z.string().describe("Sitemap URL that was processed."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  total_urls_in_sitemap: z.number().describe("Total URLs found in the sitemap."),
  urls_included: z.number().describe("URLs included after applying the limit."),
  titles_fetched: z.number().describe("Number of pages fetched to extract <title>."),
  sections: z.number().describe("Number of top-level sections in the generated file."),
  content: z.string().describe("Generated llms.txt file content; save to /llms.txt at site root."),
  note: z.string().optional(),
} as const;

// ---------------------------------------------------------------------------
// answer_box_position
// ---------------------------------------------------------------------------

export const answerBoxPositionOutputShape = {
  query: z.string().describe("The query that was tested."),
  engine: z.string().describe("Engine used."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  answer_chars: z.number().describe("Total length of the engine's raw answer in characters."),
  citations_total: z.number().describe("Total citations returned by the engine."),
  positions: z.array(z.object({
    url: z.string(),
    rank: z.number(),
    title: z.string().optional().nullable(),
    first_mention_char: z.number().nullable().describe("Character offset of first mention in raw_answer."),
    position: z.enum(["early", "middle", "late", "unknown"]).describe("Third of the answer where the URL first appears."),
  })).describe("Per-citation position in the AI answer."),
  buckets: z.object({
    early: z.number(),
    middle: z.number(),
    late: z.number(),
    unknown: z.number(),
  }).describe("Count of citations per position bucket."),
  note: z.string().optional(),
} as const;

// ---------------------------------------------------------------------------
// citation_provenance
// ---------------------------------------------------------------------------

export const citationProvenanceOutputShape = {
  query: z.string().describe("The query that was fanned across engines."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  engines: z.array(z.object({
    engine: z.string(),
    surface: z.string().optional(),
    interpretation_note: z.string().optional(),
    ok: z.boolean(),
    citations: z.number(),
    error: z.string().optional(),
  })).describe("Per-engine run summary."),
  engines_queried: z.number(),
  engines_succeeded: z.number(),
  per_url: z.array(z.object({
    url: z.string(),
    cited_by: z.array(z.string()).describe("Engines that cited this URL."),
    engine_count: z.number().describe("Number of engines that cited this URL."),
  })).describe("All unique cited URLs sorted by cross-engine consensus (engine_count desc)."),
  consensus_urls: z.array(z.string()).describe("URLs cited by ALL succeeding engines (requires >=2 engines)."),
  summary: z.object({
    total_unique_urls: z.number(),
    consensus_count: z.number(),
    median_engines_per_url: z.number(),
  }),
  note: z.string().optional(),
} as const;

// ---------------------------------------------------------------------------
// citation_evidence
// ---------------------------------------------------------------------------

export const citationEvidenceOutputShape = {
  query: z.string().describe("The query whose answer was analyzed."),
  engine: z.string().describe("Engine used."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  raw_answer_chars: z.number().describe("Length of the engine's raw answer."),
  has_raw_answer: z.boolean().describe("Whether the engine returned a raw answer."),
  citations_total: z.number(),
  evidence_found: z.number().describe("Citations whose URL was located in the raw answer."),
  evidence: z.array(z.object({
    url: z.string(),
    rank: z.number(),
    title: z.string().optional().nullable(),
    found: z.boolean().describe("Whether the URL was found in raw_answer."),
    snippet: z.string().nullable().describe("Context window around the first mention."),
    nearby_quote: z.string().nullable().describe("Nearest quoted span or containing sentence."),
    mention_char: z.number().nullable().describe("Character offset of first mention."),
    matched: z.string().optional().describe("The candidate string that matched."),
  })).describe("Per-citation evidence extracted from the raw answer."),
  note: z.string().optional(),
} as const;

// ---------------------------------------------------------------------------
// crawler_access_audit
// ---------------------------------------------------------------------------

export const crawlerAccessAuditOutputShape = {
  url: z.string().describe("The URL that was audited."),
  robots_url: z.string().describe("robots.txt URL that was parsed."),
  robots_status: z.number().nullable().describe("HTTP status of the robots.txt fetch."),
  robots_present: z.boolean().describe("Whether a non-empty robots.txt was found."),
  robots_error: z.string().nullable().describe("Error message if robots.txt fetch failed."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  bots: z.array(z.object({
    name: z.string(),
    ua_token: z.string(),
    operator: z.string(),
    purpose: z.string(),
    robots_allowed: z.union([z.boolean(), z.literal("unknown")]),
    robots_rule: z.string().nullable(),
    fetch_status: z.number().nullable(),
    fetch_ok: z.boolean().nullable(),
    fetch_error: z.string().nullable(),
    verdict: z.enum(["allowed", "blocked", "robots_only_allowed", "robots_only_blocked", "unknown"]),
  })).describe("Per-bot access verdict combining robots.txt + live UA test."),
  summary: z.object({
    total: z.number(),
    allowed: z.number(),
    blocked: z.number(),
    unknown: z.number(),
  }),
  note: z.string().optional(),
} as const;

// ---------------------------------------------------------------------------
// sitemap_citation_map
// ---------------------------------------------------------------------------

export const sitemapCitationMapOutputShape = {
  sitemap_url: z.string().describe("The sitemap that was processed."),
  domain: z.string().describe("Domain whose citation cache was queried."),
  since: z.string().optional(),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  total_urls: z.number().describe("Total sitemap URLs considered."),
  mapped: z.number().describe("URLs found in the citation cache."),
  unmapped: z.number().describe("URLs not yet seen in the citation cache."),
  coverage_pct: z.number().describe("Percentage of sitemap URLs that have been cited (0-100)."),
  citations_in_cache: z.number().describe("Total citation cache entries for this domain."),
  mapped_urls: z.array(z.object({
    url: z.string(),
    citation_count: z.number(),
    unique_queries: z.number(),
    engines: z.array(z.string()),
    last_seen: z.string(),
    sample_queries: z.array(z.string()),
  })).describe("Sitemap URLs present in the cache, sorted by citation count desc."),
  unmapped_urls: z.array(z.object({ url: z.string() })).describe("Sitemap URLs not yet cited (up to 200)."),
  note: z.string().optional(),
} as const;

// ---------------------------------------------------------------------------
// canonical_competitor_set
// ---------------------------------------------------------------------------

export const canonicalCompetitorSetOutputShape = {
  query: z.string().describe("The query that was fanned across engines."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  engines: z.array(z.object({
    engine: z.string(),
    ok: z.boolean(),
    citations: z.number(),
    error: z.string().optional(),
  })).describe("Per-engine run summary."),
  engines_queried: z.number(),
  engines_succeeded: z.number(),
  excluded_domains: z.array(z.string()).describe("Registered domains that were filtered out."),
  total_unique_domains: z.number().describe("Total unique competitor domains found before top_n truncation."),
  top_n: z.number().describe("Maximum domains returned."),
  domains: z.array(z.object({
    domain: z.string().describe("Registered domain (eTLD+1)."),
    total_citations: z.number(),
    engine_count: z.number().describe("Number of engines that cited this domain."),
    best_rank: z.number().describe("Best (lowest) rank across all citations."),
    by_engine: z.array(z.object({
      engine: z.string(),
      citations: z.number(),
      best_rank: z.number(),
      sample_urls: z.array(z.string()),
    })),
    top_urls: z.array(z.object({ url: z.string(), count: z.number() })).describe("Most-cited URLs for this domain."),
  })).describe("Competitor domains ranked by cross-engine consensus."),
  note: z.string().optional(),
} as const;

// ---------------------------------------------------------------------------
// structured_data_repair
// ---------------------------------------------------------------------------

export const structuredDataRepairOutputShape = {
  url: z.string().describe("URL that was inspected."),
  fetched_at: z.string().describe("UTC ISO-8601 timestamp."),
  schema_types_present: z.array(z.string()).describe("@type values already present on the page."),
  signals_detected: z.record(z.string(), z.string()).describe("Content signals detected (e.g. og:type=article)."),
  suggestions: z.array(z.object({
    type: z.string().describe("Schema @type being suggested."),
    signal: z.string().describe("Content signal that triggered this suggestion."),
    ready_to_paste: z.string().describe("JSON-LD block ready to paste into <head>. Fields marked FILL: need manual completion."),
  })).describe("Schema additions suggested for this page."),
  summary: z.object({
    types_present: z.number(),
    signals_detected: z.number(),
    suggestions_count: z.number(),
  }),
  note: z.string().optional(),
} as const;
