import { z } from "zod";
import { checkCitations } from "./check-citations.js";
import { loadPanel } from "../lib/panels.js";
import { domainOfUrl, registeredDomain } from "../lib/domains.js";
import { brandSentiment, type SentimentLabel } from "../lib/sentiment.js";

// One turnkey "AI visibility report" that composes check_citations across a
// query set into the metrics AI-visibility trackers sell as a dashboard:
// mention frequency (citation rate), share of voice vs competitors, average
// rank, and sentiment. Returns both structured data and a Markdown artifact
// suitable for a public report page.

export const visibilityReportInputSchema = {
  domain: z.string().min(1).describe("The domain you are measuring visibility for (e.g. automatelab.tech)."),
  queries: z
    .array(z.string().min(1))
    .max(50)
    .optional()
    .describe("Queries to run. Provide this OR `panel`. Each is sent to the AI engine via check_citations."),
  panel: z
    .string()
    .optional()
    .describe("Name of a saved panel (see panel_track) to pull queries from. Provide this OR `queries`."),
  competitors: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("Optional competitor domains to surface explicitly in the share-of-voice table."),
  brand_terms: z
    .array(z.string().min(1))
    .max(10)
    .optional()
    .describe("Brand name variants to detect in answer text for sentiment (defaults to the domain's second-level label)."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing_serp", "brave_serp", "google_ai_mode", "auto"])
    .default("auto")
    .describe("AI engine to query. 'auto' picks the first configured key. Same selection as check_citations."),
  max_results: z.number().int().min(1).max(50).default(10).describe("Max citations to pull per query."),
  include_markdown: z.boolean().default(true).describe("If true (default), include a rendered Markdown report under `markdown`."),
};

const inputSchema = z.object(visibilityReportInputSchema);

interface PerQuery {
  query: string;
  cited: boolean;
  rank: number | null;
  sentiment: number | null;
  sentiment_label: SentimentLabel | "n/a";
  top_competitor: string | null;
}

function defaultBrandTerms(domain: string): string[] {
  const reg = registeredDomain(domain);
  const label = reg.split(".")[0];
  return [reg, label].filter(Boolean);
}

export async function visibilityReport(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const target = registeredDomain(parsed.domain);

  // Resolve query set.
  let queries = parsed.queries ?? [];
  if ((!queries || queries.length === 0) && parsed.panel) {
    const panel = await loadPanel(parsed.panel);
    if (!panel) return { error: `panel '${parsed.panel}' not found` };
    queries = panel.queries;
  }
  if (!queries || queries.length === 0) {
    return { error: "provide either queries[] or a panel name with saved queries" };
  }

  const brandTerms = parsed.brand_terms && parsed.brand_terms.length > 0 ? parsed.brand_terms : defaultBrandTerms(parsed.domain);
  const competitorSet = new Set((parsed.competitors ?? []).map((d) => registeredDomain(d)));

  const per_query: PerQuery[] = [];
  const domainCitations = new Map<string, number>(); // registered domain -> citation count
  let totalCitations = 0;
  let engineUsed = parsed.engine;
  const ranks: number[] = [];
  const sentiments: number[] = [];
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };

  for (const query of queries) {
    // An unavailable observation cannot be counted as a negative citation.
    // Preserve the typed provider/config error through the MCP handler. Abort
    // this incomplete report rather than publishing a misleading denominator.
    const res = await checkCitations({ query, engine: parsed.engine, max_results: parsed.max_results });
    engineUsed = res.engine as typeof engineUsed;

    let cited = false;
    let rank: number | null = null;
    let topCompetitor: string | null = null;

    res.citations.forEach((c, i) => {
      const dom = domainOfUrl(c.url);
      if (!dom) return;
      totalCitations++;
      domainCitations.set(dom, (domainCitations.get(dom) ?? 0) + 1);
      const position = typeof c.rank === "number" && c.rank > 0 ? c.rank : i + 1;
      if (dom === target) {
        cited = true;
        if (rank === null || position < rank) rank = position;
      } else if (topCompetitor === null) {
        topCompetitor = dom;
      }
    });

    if (rank !== null) ranks.push(rank);

    const sent = brandSentiment(res.raw_answer, [...brandTerms, target]);
    let sentimentScore: number | null = null;
    let sentimentLabel: SentimentLabel | "n/a" = "n/a";
    if (sent.mentioned) {
      sentimentScore = sent.score;
      sentimentLabel = sent.label;
      sentiments.push(sent.score);
      sentimentCounts[sent.label]++;
    }

    per_query.push({ query, cited, rank, sentiment: sentimentScore, sentiment_label: sentimentLabel, top_competitor: topCompetitor });
  }

  const queriesCited = per_query.filter((q) => q.cited).length;
  const citation_rate = per_query.length > 0 ? queriesCited / per_query.length : 0;
  const targetCitations = domainCitations.get(target) ?? 0;
  const share_of_voice = totalCitations > 0 ? targetCitations / totalCitations : 0;
  const avgRank = ranks.length > 0 ? ranks.reduce((a, b) => a + b, 0) / ranks.length : null;
  const avgSentiment = sentiments.length > 0 ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : null;

  // Top domains by share of voice, competitors flagged.
  const top_domains = [...domainCitations.entries()]
    .map(([domain, citations]) => ({
      domain,
      citations,
      share: totalCitations > 0 ? Math.round((citations / totalCitations) * 1000) / 10 : 0,
      is_target: domain === target,
      is_competitor: competitorSet.has(domain),
    }))
    .sort((a, b) => b.citations - a.citations)
    .slice(0, 15);

  const generated_at = new Date().toISOString();
  const summary = {
    domain: target,
    engine: engineUsed,
    generated_at,
    queries_total: per_query.length,
    queries_cited: queriesCited,
    citation_rate: Math.round(citation_rate * 1000) / 10, // percentage, 1 dp
    share_of_voice: Math.round(share_of_voice * 1000) / 10, // percentage, 1 dp
    average_rank: avgRank === null ? null : Math.round(avgRank * 10) / 10,
    average_sentiment: avgSentiment === null ? null : Math.round(avgSentiment * 100) / 100,
    sentiment_breakdown: sentimentCounts,
  };

  const result: {
    summary: typeof summary;
    top_domains: typeof top_domains;
    per_query: PerQuery[];
    markdown?: string;
  } = { summary, top_domains, per_query };

  if (parsed.include_markdown) {
    result.markdown = renderMarkdown(summary, top_domains, per_query);
  }
  return result;
}

function renderMarkdown(
  s: { domain: string; engine: string; generated_at: string; queries_total: number; queries_cited: number; citation_rate: number; share_of_voice: number; average_rank: number | null; average_sentiment: number | null; sentiment_breakdown: { positive: number; neutral: number; negative: number } },
  topDomains: Array<{ domain: string; citations: number; share: number; is_target: boolean; is_competitor: boolean }>,
  perQuery: PerQuery[],
): string {
  const lines: string[] = [];
  lines.push(`# AI visibility report: ${s.domain}`);
  lines.push("");
  lines.push(`> Engine: ${s.engine} · Generated: ${s.generated_at.slice(0, 10)} · ${s.queries_total} queries`);
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push(`- **Citation rate (mention frequency):** ${s.citation_rate}% (${s.queries_cited}/${s.queries_total} queries)`);
  lines.push(`- **Share of voice:** ${s.share_of_voice}% of all cited sources`);
  lines.push(`- **Average rank when cited:** ${s.average_rank === null ? "n/a" : s.average_rank}`);
  lines.push(`- **Average sentiment:** ${s.average_sentiment === null ? "n/a" : s.average_sentiment} (pos ${s.sentiment_breakdown.positive} / neu ${s.sentiment_breakdown.neutral} / neg ${s.sentiment_breakdown.negative})`);
  lines.push("");
  lines.push("## Share of voice");
  lines.push("");
  lines.push("| Domain | Citations | Share | |");
  lines.push("|---|---|---|---|");
  for (const d of topDomains) {
    const tag = d.is_target ? "**you**" : d.is_competitor ? "competitor" : "";
    lines.push(`| ${d.domain} | ${d.citations} | ${d.share}% | ${tag} |`);
  }
  lines.push("");
  lines.push("## Per-query");
  lines.push("");
  lines.push("| Query | Cited | Rank | Sentiment |");
  lines.push("|---|---|---|---|");
  for (const q of perQuery) {
    lines.push(`| ${q.query.replace(/\|/g, "\\|")} | ${q.cited ? "yes" : "no"} | ${q.rank ?? "-"} | ${q.sentiment_label === "n/a" ? "-" : q.sentiment_label} |`);
  }
  lines.push("");
  return lines.join("\n");
}
