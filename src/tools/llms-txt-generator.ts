import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchText } from "../lib/fetch.js";

export const llmsTxtGeneratorInputSchema = {
  sitemap_url: z
    .string()
    .url()
    .describe("URL of sitemap.xml (or sitemap index). Nested sitemaps are followed."),
  site_title: z
    .string()
    .min(1)
    .describe("Site title - top H1 in the generated llms.txt file."),
  site_description: z
    .string()
    .optional()
    .describe("One-paragraph site description placed under the H1. Optional but strongly recommended."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe("Max URLs to include. Truncated after sitemap parse, before title fetch."),
  fetch_titles: z
    .boolean()
    .default(false)
    .describe("If true, fetch each URL to extract <title> for richer links. Slower (one HEAD-ish GET per URL). Default false uses the URL path as the link text."),
};

const inputSchema = z.object(llmsTxtGeneratorInputSchema);

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

function pathLabel(url: string): string {
  try {
    const u = new URL(url);
    const seg = u.pathname.replace(/\/$/, "").split("/").filter(Boolean).pop() ?? u.hostname;
    return seg.replace(/[-_]/g, " ").replace(/\.[a-z0-9]+$/i, "");
  } catch {
    return url;
  }
}

async function fetchTitle(url: string): Promise<string | undefined> {
  try {
    const { text, status } = await fetchText(url, { timeoutMs: 10_000 });
    if (status >= 400) return undefined;
    const $ = cheerio.load(text);
    const t = $("title").first().text().trim();
    return t || undefined;
  } catch {
    return undefined;
  }
}

function groupBySection(urls: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const url of urls) {
    let section = "Pages";
    try {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length === 0) section = "Home";
      else section = parts[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    } catch {
      // ignore
    }
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section)!.push(url);
  }
  return groups;
}

export async function llmsTxtGenerator(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);

  const allUrls = await parseSitemap(parsed.sitemap_url);
  const urls = allUrls.slice(0, parsed.limit);

  const titleMap = new Map<string, string>();
  if (parsed.fetch_titles) {
    await Promise.all(
      urls.map(async (url) => {
        const t = await fetchTitle(url);
        if (t) titleMap.set(url, t);
      }),
    );
  }

  const lines: string[] = [];
  lines.push(`# ${parsed.site_title}`);
  lines.push("");
  if (parsed.site_description) {
    lines.push(`> ${parsed.site_description}`);
    lines.push("");
  }

  const groups = groupBySection(urls);
  // Stable order: Home first, then alphabetical.
  const sectionNames = [...groups.keys()].sort((a, b) => {
    if (a === "Home") return -1;
    if (b === "Home") return 1;
    return a.localeCompare(b);
  });

  for (const section of sectionNames) {
    lines.push(`## ${section}`);
    lines.push("");
    for (const url of groups.get(section)!) {
      const label = titleMap.get(url) ?? pathLabel(url);
      lines.push(`- [${label}](${url})`);
    }
    lines.push("");
  }

  const content = lines.join("\n").trimEnd() + "\n";

  return {
    sitemap_url: parsed.sitemap_url,
    fetched_at: new Date().toISOString(),
    total_urls_in_sitemap: allUrls.length,
    urls_included: urls.length,
    titles_fetched: titleMap.size,
    sections: sectionNames.length,
    content,
    note:
      "Markdown follows the llms.txt spec (https://llmstxt.org). Save as /llms.txt at site root. Re-run after content changes.",
  };
}
