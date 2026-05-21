import * as cheerio from "cheerio";
import { fetchJson, fetchText } from "../lib/fetch.js";

export type PredictorSignals = {
  wikipedia_linked: boolean;
  schema_org_present: boolean;
  schema_types: string[];
  llms_txt_present: boolean;
  github_referenced: boolean;
  github_stars?: number;
  reddit_referenced: boolean;
  canonical_clean: boolean;
  https: boolean;
};

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

export async function collectSignals(url: string): Promise<PredictorSignals> {
  const u = new URL(url);
  const domain = u.hostname;
  const origin = `${u.protocol}//${u.hostname}`;

  let pageHtml = "";
  try {
    const { text } = await fetchText(url, { timeoutMs: 15_000 });
    pageHtml = text;
  } catch {
    pageHtml = "";
  }

  const $ = pageHtml ? cheerio.load(pageHtml) : null;

  const schemaTypes = new Set<string>();
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

  const [wiki, gh, reddit, llms] = await Promise.all([
    checkWikipedia(domain),
    checkGithubStars(url),
    checkReddit(domain),
    checkLlmsTxt(origin),
  ]);

  return {
    wikipedia_linked: wiki,
    schema_org_present: schemaTypes.size > 0,
    schema_types: [...schemaTypes],
    llms_txt_present: llms,
    github_referenced: gh.referenced,
    github_stars: gh.stars,
    reddit_referenced: reddit,
    canonical_clean: canonicalClean,
    https: u.protocol === "https:",
  };
}

export function scoreSignals(s: PredictorSignals): {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
} {
  let score = 0;
  if (s.wikipedia_linked) score += 20;
  if (s.schema_org_present) score += 20;
  if (s.schema_types.length >= 2) score += 5;
  if (s.llms_txt_present) score += 10;
  if (s.github_referenced) score += 10;
  if ((s.github_stars ?? 0) >= 100) score += 5;
  if (s.reddit_referenced) score += 10;
  if (s.canonical_clean) score += 10;
  if (s.https) score += 10;
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
  if (!s.wikipedia_linked)
    fixes.push({
      signal: "wikipedia_linked",
      suggestion:
        "Get the domain referenced from at least one Wikipedia article. Wikipedia citations are the single strongest signal for LLM training corpora.",
      estimated_lift: "high",
    });
  if (!s.schema_org_present)
    fixes.push({
      signal: "schema_org_present",
      suggestion:
        "Add JSON-LD with Article or FAQPage schema. LLM crawlers parse structured data first.",
      estimated_lift: "high",
    });
  if (!s.llms_txt_present)
    fixes.push({
      signal: "llms_txt_present",
      suggestion:
        "Publish /llms.txt at the site root. Tells AI crawlers what to index.",
      estimated_lift: "medium",
    });
  if (!s.canonical_clean)
    fixes.push({
      signal: "canonical_clean",
      suggestion:
        "Set exactly one <link rel=\"canonical\"> per page. Conflicting canonicals split citation weight.",
      estimated_lift: "medium",
    });
  if (!s.github_referenced)
    fixes.push({
      signal: "github_referenced",
      suggestion:
        "Get the URL referenced from a GitHub repo README or issue. GitHub is heavily mined by LLM training and search.",
      estimated_lift: "medium",
    });
  if (!s.reddit_referenced)
    fixes.push({
      signal: "reddit_referenced",
      suggestion:
        "Reddit mentions correlate with Perplexity and ChatGPT citations. Earn organic mentions in relevant subs.",
      estimated_lift: "low",
    });
  if (!s.https)
    fixes.push({
      signal: "https",
      suggestion: "Serve over HTTPS. Non-HTTPS URLs are de-prioritized by every engine.",
      estimated_lift: "high",
    });
  return fixes;
}
