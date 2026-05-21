import * as cheerio from "cheerio";
import { fetchJson, fetchText, ToolFetchError } from "../lib/fetch.js";

export type PredictorSignals = {
  // Domain-level
  wikipedia_linked: boolean;
  github_referenced: boolean;
  github_stars?: number;
  reddit_referenced: boolean;
  llms_txt_present: boolean;
  https: boolean;
  // Page-level structure
  schema_org_present: boolean;
  schema_types: string[];
  has_article_schema: boolean;
  has_faq_schema: boolean;
  has_howto_schema: boolean;
  has_breadcrumb_schema: boolean;
  canonical_clean: boolean;
  // Page-level content
  word_count: number;
  reading_time_minutes: number;
  h1_count: number;
  h2_count: number;
  h2_question_count: number;
  table_of_contents_present: boolean;
  image_count: number;
  internal_link_count: number;
  external_link_count: number;
  authority_link_count: number;
  // Page-level metadata
  title_length: number;
  meta_description_length: number;
  has_open_graph: boolean;
  has_twitter_card: boolean;
  date_modified_iso?: string;
  last_modified_days_ago?: number;
};

const AUTHORITY_DOMAINS = [
  "wikipedia.org",
  "github.com",
  "arxiv.org",
  "developer.mozilla.org",
  "w3.org",
  "ietf.org",
  "schema.org",
  "nih.gov",
  "nasa.gov",
  "who.int",
];

function isAuthorityHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h.endsWith(".gov") || h.endsWith(".edu")) return true;
  return AUTHORITY_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

async function checkWikipedia(domain: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({
      action: "query",
      list: "exturlusage",
      euquery: domain,
      eulimit: "1",
      format: "json",
      origin: "*",
    });
    const res = await fetchJson<{
      query?: { exturlusage?: Array<unknown> };
    }>(`https://en.wikipedia.org/w/api.php?${params.toString()}`, {
      timeoutMs: 8_000,
    });
    return (res.query?.exturlusage?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function checkGithubStars(
  url: string,
): Promise<{ referenced: boolean; stars?: number }> {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") {
      const params = new URLSearchParams({
        q: u.hostname,
        per_page: "1",
      });
      const res = await fetchJson<{ total_count?: number }>(
        `https://api.github.com/search/code?${params.toString()}`,
        {
          headers: { accept: "application/vnd.github+json" },
          timeoutMs: 8_000,
        },
      );
      return { referenced: (res.total_count ?? 0) > 0 };
    }
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return { referenced: false };
    const repo = `${parts[0]}/${parts[1]}`;
    const res = await fetchJson<{ stargazers_count?: number }>(
      `https://api.github.com/repos/${repo}`,
      {
        headers: { accept: "application/vnd.github+json" },
        timeoutMs: 8_000,
      },
    );
    return { referenced: true, stars: res.stargazers_count };
  } catch {
    return { referenced: false };
  }
}

async function checkReddit(domain: string): Promise<boolean> {
  try {
    const res = await fetchJson<{ data?: { children?: Array<unknown> } }>(
      `https://www.reddit.com/search.json?q=site%3A${encodeURIComponent(domain)}&limit=1`,
      {
        headers: { "user-agent": "citation-intelligence-mcp/0.1 (+research)" },
        timeoutMs: 8_000,
      },
    );
    return (res.data?.children?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

async function checkLlmsTxt(origin: string): Promise<boolean> {
  try {
    const { status, text } = await fetchText(`${origin}/llms.txt`, {
      timeoutMs: 8_000,
    });
    return status === 200 && text.length > 0;
  } catch {
    return false;
  }
}

function extractDateModified(
  $: cheerio.CheerioAPI,
  jsonLdNodes: unknown[],
): string | undefined {
  for (const node of jsonLdNodes) {
    if (!node || typeof node !== "object") continue;
    const obj = node as Record<string, unknown>;
    const dm = obj.dateModified ?? obj.datePublished;
    if (typeof dm === "string") return dm;
  }
  const meta =
    $('meta[property="article:modified_time"]').attr("content") ??
    $('meta[name="last-modified"]').attr("content") ??
    $('meta[property="article:published_time"]').attr("content") ??
    $("time[datetime]").first().attr("datetime");
  return meta || undefined;
}

function daysSince(iso: string): number | undefined {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

export async function collectSignals(url: string): Promise<PredictorSignals> {
  const u = new URL(url);
  const domain = u.hostname;
  const origin = `${u.protocol}//${u.hostname}`;

  let pageHtml = "";
  try {
    const { text, status } = await fetchText(url, { timeoutMs: 15_000 });
    if (status >= 400) {
      throw new ToolFetchError({
        type: "fetch_error",
        url,
        status,
        message: `URL returned HTTP ${status} - cannot score a non-existent page.`,
      });
    }
    pageHtml = text;
  } catch (err) {
    if (err instanceof ToolFetchError) throw err;
    pageHtml = "";
  }

  const $ = pageHtml ? cheerio.load(pageHtml) : null;

  const schemaTypes = new Set<string>();
  const jsonLdNodes: unknown[] = [];
  if ($) {
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).text());
        const collect = (node: unknown): void => {
          if (Array.isArray(node)) {
            node.forEach(collect);
            return;
          }
          if (node && typeof node === "object") {
            jsonLdNodes.push(node);
            const t = (node as Record<string, unknown>)["@type"];
            if (typeof t === "string") schemaTypes.add(t);
            else if (Array.isArray(t))
              t.forEach((x) => typeof x === "string" && schemaTypes.add(x));
            for (const v of Object.values(node as Record<string, unknown>)) {
              collect(v);
            }
          }
        };
        collect(json);
      } catch {
        // ignore malformed JSON-LD
      }
    });
    $("[itemtype]").each((_, el) => {
      const t = $(el).attr("itemtype");
      if (t) {
        const last = t.split("/").pop();
        if (last) schemaTypes.add(last);
      }
    });
  }

  let canonicalClean = false;
  if ($) {
    const canonicals = $('link[rel="canonical"]')
      .toArray()
      .map((el) => $(el).attr("href") ?? "");
    canonicalClean = canonicals.length === 1 && canonicals[0].length > 0;
  }

  let wordCount = 0;
  let h1Count = 0;
  let h2Count = 0;
  let h2QuestionCount = 0;
  let imageCount = 0;
  let internalLinkCount = 0;
  let externalLinkCount = 0;
  let authorityLinkCount = 0;
  let titleLength = 0;
  let metaDescriptionLength = 0;
  let hasOpenGraph = false;
  let hasTwitterCard = false;
  let tocPresent = false;

  if ($) {
    const mainText = $("main, article").first().text() || $("body").text();
    wordCount = mainText.trim().split(/\s+/).filter(Boolean).length;

    h1Count = $("h1").length;
    h2Count = $("h2").length;
    $("h2").each((_, el) => {
      const t = $(el).text().trim();
      if (t.endsWith("?")) h2QuestionCount += 1;
    });

    imageCount = $("img").length;

    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      try {
        const linkUrl = new URL(href, url);
        if (linkUrl.hostname === domain) {
          internalLinkCount += 1;
        } else {
          externalLinkCount += 1;
          if (isAuthorityHost(linkUrl.hostname)) authorityLinkCount += 1;
        }
      } catch {
        // skip malformed
      }
    });

    titleLength = ($("title").first().text() || "").trim().length;
    metaDescriptionLength = ($('meta[name="description"]').attr("content") || "").trim().length;

    hasOpenGraph = $('meta[property^="og:"]').length > 0;
    hasTwitterCard = $('meta[name^="twitter:"]').length > 0;

    const tocSelectors = [
      ".toc",
      "#toc",
      ".table-of-contents",
      "#table-of-contents",
      "nav[aria-label*='table' i]",
      "nav[aria-label*='contents' i]",
    ];
    tocPresent = tocSelectors.some((s) => $(s).length > 0);
  }

  const dateModifiedIso = $ ? extractDateModified($, jsonLdNodes) : undefined;
  const lastModifiedDaysAgo = dateModifiedIso ? daysSince(dateModifiedIso) : undefined;
  const readingTimeMinutes = Math.max(1, Math.round(wordCount / 220));

  const hasArticleSchema = ["Article", "BlogPosting", "NewsArticle", "TechArticle"].some((t) =>
    schemaTypes.has(t),
  );
  const hasFaqSchema = schemaTypes.has("FAQPage") || schemaTypes.has("Question");
  const hasHowtoSchema = schemaTypes.has("HowTo");
  const hasBreadcrumbSchema = schemaTypes.has("BreadcrumbList");

  const [wiki, gh, reddit, llms] = await Promise.all([
    checkWikipedia(domain),
    checkGithubStars(url),
    checkReddit(domain),
    checkLlmsTxt(origin),
  ]);

  return {
    wikipedia_linked: wiki,
    github_referenced: gh.referenced,
    github_stars: gh.stars,
    reddit_referenced: reddit,
    llms_txt_present: llms,
    https: u.protocol === "https:",
    schema_org_present: schemaTypes.size > 0,
    schema_types: [...schemaTypes],
    has_article_schema: hasArticleSchema,
    has_faq_schema: hasFaqSchema,
    has_howto_schema: hasHowtoSchema,
    has_breadcrumb_schema: hasBreadcrumbSchema,
    canonical_clean: canonicalClean,
    word_count: wordCount,
    reading_time_minutes: readingTimeMinutes,
    h1_count: h1Count,
    h2_count: h2Count,
    h2_question_count: h2QuestionCount,
    table_of_contents_present: tocPresent,
    image_count: imageCount,
    internal_link_count: internalLinkCount,
    external_link_count: externalLinkCount,
    authority_link_count: authorityLinkCount,
    title_length: titleLength,
    meta_description_length: metaDescriptionLength,
    has_open_graph: hasOpenGraph,
    has_twitter_card: hasTwitterCard,
    date_modified_iso: dateModifiedIso,
    last_modified_days_ago: lastModifiedDaysAgo,
  };
}

export function scoreSignals(s: PredictorSignals): {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
} {
  let score = 0;

  // Domain authority (max 25)
  if (s.wikipedia_linked) score += 10;
  if (s.github_referenced) score += 5;
  if ((s.github_stars ?? 0) >= 100) score += 3;
  if (s.reddit_referenced) score += 5;
  if (s.llms_txt_present) score += 2;

  // Structured data (max 20)
  if (s.has_article_schema) score += 6;
  if (s.has_faq_schema) score += 6;
  if (s.has_howto_schema) score += 4;
  if (s.has_breadcrumb_schema) score += 2;
  if (s.schema_org_present && !s.has_article_schema && !s.has_faq_schema && !s.has_howto_schema)
    score += 2;

  // Content depth (max 20)
  if (s.word_count >= 2500) score += 10;
  else if (s.word_count >= 1500) score += 7;
  else if (s.word_count >= 800) score += 4;
  else if (s.word_count >= 300) score += 1;
  if (s.h2_count >= 5) score += 4;
  else if (s.h2_count >= 2) score += 2;
  if (s.h2_question_count >= 2) score += 4;
  else if (s.h2_question_count >= 1) score += 2;
  if (s.table_of_contents_present) score += 2;

  // Link graph (max 12)
  if (s.authority_link_count >= 3) score += 6;
  else if (s.authority_link_count >= 1) score += 3;
  if (s.external_link_count >= 5) score += 3;
  else if (s.external_link_count >= 1) score += 1;
  if (s.internal_link_count >= 5) score += 3;
  else if (s.internal_link_count >= 1) score += 1;

  // Freshness (max 8)
  if (s.last_modified_days_ago !== undefined) {
    if (s.last_modified_days_ago <= 90) score += 8;
    else if (s.last_modified_days_ago <= 365) score += 5;
    else if (s.last_modified_days_ago <= 730) score += 2;
  }

  // Metadata hygiene (max 10)
  if (s.canonical_clean) score += 3;
  if (s.h1_count === 1) score += 2;
  if (s.title_length >= 20 && s.title_length <= 70) score += 2;
  if (s.meta_description_length >= 70 && s.meta_description_length <= 200) score += 2;
  if (s.has_open_graph) score += 1;

  // Transport (max 5)
  if (s.https) score += 5;

  score = Math.min(100, score);
  const grade =
    score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";
  return { score, grade };
}

export function suggestFixes(
  s: PredictorSignals,
): Array<{ signal: string; suggestion: string; estimated_lift: "low" | "medium" | "high" }> {
  const fixes: Array<{
    signal: string;
    suggestion: string;
    estimated_lift: "low" | "medium" | "high";
  }> = [];

  if (!s.has_article_schema && !s.has_faq_schema && !s.has_howto_schema) {
    fixes.push({
      signal: "schema_specific",
      suggestion:
        "Add JSON-LD with Article, FAQPage, or HowTo schema. Generic schema is not enough - LLMs prefer typed content.",
      estimated_lift: "high",
    });
  }
  if (!s.has_faq_schema && s.h2_question_count >= 2) {
    fixes.push({
      signal: "has_faq_schema",
      suggestion:
        "Page already has question-style H2s. Wrap them in FAQPage JSON-LD - high-leverage win.",
      estimated_lift: "high",
    });
  }
  if (s.word_count < 800) {
    fixes.push({
      signal: "word_count",
      suggestion: `Page is ${s.word_count} words. Citation-worthy pages average 1500+. Expand depth, examples, edge cases.`,
      estimated_lift: "high",
    });
  }
  if (s.h2_question_count === 0 && s.word_count >= 500) {
    fixes.push({
      signal: "h2_question_count",
      suggestion:
        "Reframe at least 2 H2s as questions users actually ask. Question-shaped headings get cited in Q&A answers.",
      estimated_lift: "medium",
    });
  }
  if (s.authority_link_count === 0) {
    fixes.push({
      signal: "authority_link_count",
      suggestion:
        "Cite 1-3 authoritative sources (Wikipedia, GitHub, .gov, .edu, MDN, arXiv). LLMs treat outbound authority links as topical signal.",
      estimated_lift: "medium",
    });
  }
  if (s.last_modified_days_ago !== undefined && s.last_modified_days_ago > 365) {
    fixes.push({
      signal: "freshness",
      suggestion: `Last modified ${s.last_modified_days_ago} days ago. Refresh dates, examples, and bump dateModified - freshness biases AI retrieval.`,
      estimated_lift: "medium",
    });
  }
  if (s.last_modified_days_ago === undefined) {
    fixes.push({
      signal: "freshness",
      suggestion:
        "No dateModified detected. Add JSON-LD dateModified or article:modified_time meta - lets engines verify freshness.",
      estimated_lift: "low",
    });
  }
  if (!s.has_breadcrumb_schema) {
    fixes.push({
      signal: "has_breadcrumb_schema",
      suggestion:
        "Add BreadcrumbList JSON-LD. Cheap to ship, helps engines understand site hierarchy.",
      estimated_lift: "low",
    });
  }
  if (!s.table_of_contents_present && s.h2_count >= 4) {
    fixes.push({
      signal: "table_of_contents_present",
      suggestion:
        "Add a visible table of contents. Long pages without TOC are harder for chunkers to segment cleanly.",
      estimated_lift: "low",
    });
  }
  if (!s.llms_txt_present) {
    fixes.push({
      signal: "llms_txt_present",
      suggestion: "Publish /llms.txt at the site root. Tells AI crawlers what to index.",
      estimated_lift: "medium",
    });
  }
  if (!s.canonical_clean) {
    fixes.push({
      signal: "canonical_clean",
      suggestion:
        "Set exactly one <link rel=\"canonical\"> per page. Conflicting canonicals split citation weight.",
      estimated_lift: "medium",
    });
  }
  if (s.h1_count !== 1) {
    fixes.push({
      signal: "h1_count",
      suggestion: `Page has ${s.h1_count} H1s. Use exactly one - it anchors the topic for chunkers.`,
      estimated_lift: "low",
    });
  }
  if (s.title_length === 0 || s.title_length > 70) {
    fixes.push({
      signal: "title_length",
      suggestion: "Keep <title> between 20-70 chars. Too long gets truncated, too short loses context.",
      estimated_lift: "low",
    });
  }
  if (s.meta_description_length === 0) {
    fixes.push({
      signal: "meta_description_length",
      suggestion: "Add a 70-200 char meta description - often quoted verbatim in AI answer snippets.",
      estimated_lift: "low",
    });
  }
  if (!s.has_open_graph) {
    fixes.push({
      signal: "has_open_graph",
      suggestion: "Add Open Graph tags (og:title, og:description, og:image). Used by social previews and some AI parsers.",
      estimated_lift: "low",
    });
  }
  if (!s.https) {
    fixes.push({
      signal: "https",
      suggestion: "Serve over HTTPS. Non-HTTPS URLs are de-prioritized by every engine.",
      estimated_lift: "high",
    });
  }
  if (!s.reddit_referenced) {
    fixes.push({
      signal: "reddit_referenced",
      suggestion:
        "Reddit mentions correlate with Perplexity and ChatGPT citations. Earn organic mentions in relevant subs.",
      estimated_lift: "low",
    });
  }
  if (!s.github_referenced) {
    fixes.push({
      signal: "github_referenced",
      suggestion:
        "Get the URL referenced from a GitHub repo README or issue. GitHub is heavily mined by LLM training and search.",
      estimated_lift: "medium",
    });
  }
  return fixes;
}
