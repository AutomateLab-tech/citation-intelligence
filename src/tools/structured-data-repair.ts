import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchText, ToolFetchError } from "../lib/fetch.js";

export const structuredDataRepairInputSchema = {
  url: z
    .string()
    .url()
    .describe(
      "URL to inspect for missing JSON-LD. The page is fetched and its content signals are used to suggest schema types.",
    ),
};

const inputSchema = z.object(structuredDataRepairInputSchema);

// Detect @types already present in any JSON-LD block on the page.
function extractPresentTypes(html: string): Set<string> {
  const $ = cheerio.load(html);
  const present = new Set<string>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).text()) as unknown;
      collectTypes(json, present);
    } catch {
      // ignore malformed blocks
    }
  });
  return present;
}

function collectTypes(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectTypes(n, out));
    return;
  }
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  const types = Array.isArray(t)
    ? t.filter((x): x is string => typeof x === "string")
    : typeof t === "string"
      ? [t]
      : [];
  for (const type of types) out.add(type);
  for (const v of Object.values(obj)) collectTypes(v, out);
}

type Template = {
  type: string;
  signal: string;
  template: Record<string, unknown>;
};

function buildBlogPostingTemplate(
  $: cheerio.CheerioAPI,
  url: string,
): Record<string, unknown> {
  const headline =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim() ||
    "FILL: Article headline";
  const description =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "FILL: Article description";
  const datePublished =
    $('meta[property="article:published_time"]').attr("content") ||
    $('time[datetime]').first().attr("datetime") ||
    "FILL: 2025-01-01T00:00:00Z";
  const author =
    $('meta[name="author"]').attr("content") ||
    $('[rel="author"]').first().text().trim() ||
    "FILL: Author Name";
  const image =
    $('meta[property="og:image"]').attr("content") || "FILL: https://…/image.jpg";

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline,
    description,
    url,
    datePublished,
    author: { "@type": "Person", name: author },
    image,
  };
}

function buildFaqTemplate(
  $: cheerio.CheerioAPI,
  pairs: Array<{ q: string; a: string }>,
): Record<string, unknown> {
  const mainEntity = pairs.slice(0, 5).map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  }));
  if (mainEntity.length === 0) {
    mainEntity.push({
      "@type": "Question",
      name: "FILL: Question text?",
      acceptedAnswer: { "@type": "Answer", text: "FILL: Answer text." },
    });
  }
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
  };
}

function buildHowToTemplate(
  steps: string[],
  $: cheerio.CheerioAPI,
): Record<string, unknown> {
  const name =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim() ||
    "FILL: How-to title";
  const stepItems =
    steps.length > 0
      ? steps.slice(0, 10).map((text, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          text: text.trim(),
        }))
      : [
          { "@type": "HowToStep", position: 1, text: "FILL: Step 1 instructions." },
          { "@type": "HowToStep", position: 2, text: "FILL: Step 2 instructions." },
        ];
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    step: stepItems,
  };
}

function buildBreadcrumbTemplate(
  url: string,
  $: cheerio.CheerioAPI,
): Record<string, unknown> {
  const parsed = new URL(url);
  const parts = parsed.pathname.replace(/\/$/, "").split("/").filter(Boolean);
  const itemListElement = [
    {
      "@type": "ListItem",
      position: 1,
      name: $('meta[property="og:site_name"]').attr("content") || "Home",
      item: `${parsed.protocol}//${parsed.host}/`,
    },
    ...parts.map((seg, i) => ({
      "@type": "ListItem",
      position: i + 2,
      name:
        seg
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()) || "FILL: Section name",
      item: `${parsed.protocol}//${parsed.host}/${parts.slice(0, i + 1).join("/")}/`,
    })),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement,
  };
}

function buildOrganizationTemplate(
  $: cheerio.CheerioAPI,
  url: string,
): Record<string, unknown> {
  const parsed = new URL(url);
  const name =
    $('meta[property="og:site_name"]').attr("content") ||
    $("title").text().trim() ||
    "FILL: Organization name";
  const logo =
    $('link[rel="icon"][type="image/png"]').attr("href") ||
    $('link[rel="apple-touch-icon"]').attr("href") ||
    "FILL: https://…/logo.png";
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name,
    url: `${parsed.protocol}//${parsed.host}/`,
    logo,
    sameAs: ["FILL: https://twitter.com/…", "FILL: https://linkedin.com/company/…"],
  };
}

// Heuristics to detect content signals.
function detectSignals(html: string, url: string): Map<string, string> {
  const $ = cheerio.load(html);
  const signals = new Map<string, string>();

  // BlogPosting signal: og:type=article or a byline element
  const ogType = $('meta[property="og:type"]').attr("content");
  const hasAuthor =
    $('[rel="author"], .author, .byline, [class*="author"], [class*="byline"]').length > 0;
  if (ogType === "article" || hasAuthor) {
    signals.set("BlogPosting", ogType === "article" ? "og:type=article" : "byline element found");
  }

  // FAQPage signal: heading that looks like a question followed by a paragraph
  const faqPairs: Array<{ q: string; a: string }> = [];
  $("h2, h3, h4, dt").each((_, el) => {
    const text = $(el).text().trim();
    if (text.endsWith("?") || /^(what|how|why|when|where|who|can|does|is|are|do)/i.test(text)) {
      const answer =
        $(el).next("p, dd").text().trim() ||
        $(el).next("div").find("p").first().text().trim();
      if (answer.length > 20) {
        faqPairs.push({ q: text, a: answer.slice(0, 300) });
      }
    }
  });
  if (faqPairs.length >= 2) {
    signals.set("FAQPage", `${faqPairs.length} question/answer pairs detected`);
    (signals as unknown as Map<string, unknown>).set("_faqPairs", faqPairs);
  }

  // HowTo signal: ordered list or headings with step/numbered prefix
  const olItems: string[] = [];
  $("ol > li").each((_, el) => {
    olItems.push($(el).text().trim());
  });
  const stepHeadings: string[] = [];
  $("h2, h3").each((_, el) => {
    const t = $(el).text().trim();
    if (/^step\s*\d+/i.test(t) || /^\d+[\.\)]\s/.test(t)) {
      stepHeadings.push(t);
    }
  });
  if (olItems.length >= 3) {
    signals.set("HowTo", `ordered list with ${olItems.length} items`);
    (signals as unknown as Map<string, unknown>).set("_steps", olItems);
  } else if (stepHeadings.length >= 2) {
    signals.set("HowTo", `${stepHeadings.length} step headings`);
    (signals as unknown as Map<string, unknown>).set("_steps", stepHeadings);
  }

  // BreadcrumbList signal: pathname has 2+ segments
  try {
    const parts = new URL(url).pathname.replace(/\/$/, "").split("/").filter(Boolean);
    if (parts.length >= 2) {
      signals.set("BreadcrumbList", `URL has ${parts.length + 1} path segments`);
    }
  } catch {
    // ignore
  }

  // Organization signal: root URL (homepage)
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/" || parsed.pathname === "") {
      signals.set("Organization", "homepage URL");
    }
  } catch {
    // ignore
  }

  return signals;
}

export async function structuredDataRepair(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const url = parsed.url;

  const { text, status } = await fetchText(url, { timeoutMs: 15_000 });
  if (status >= 400) {
    throw new ToolFetchError({
      type: "fetch_error",
      url,
      status,
      message: `URL returned HTTP ${status} - cannot inspect a non-existent page.`,
    });
  }

  const $ = cheerio.load(text);
  const presentTypes = extractPresentTypes(text);
  const signals = detectSignals(text, url);

  // Build suggestions for signalled types that are not already present.
  const suggestions: Template[] = [];

  if (signals.has("BlogPosting") && !presentTypes.has("BlogPosting") && !presentTypes.has("Article")) {
    suggestions.push({
      type: "BlogPosting",
      signal: signals.get("BlogPosting")!,
      template: buildBlogPostingTemplate($, url),
    });
  }

  if (signals.has("FAQPage") && !presentTypes.has("FAQPage")) {
    const faqPairs = (signals as unknown as Map<string, unknown>).get("_faqPairs") as Array<{
      q: string;
      a: string;
    }> | undefined;
    suggestions.push({
      type: "FAQPage",
      signal: signals.get("FAQPage")!,
      template: buildFaqTemplate($, faqPairs ?? []),
    });
  }

  if (signals.has("HowTo") && !presentTypes.has("HowTo")) {
    const steps = (signals as unknown as Map<string, unknown>).get("_steps") as string[] | undefined;
    suggestions.push({
      type: "HowTo",
      signal: signals.get("HowTo")!,
      template: buildHowToTemplate(steps ?? [], $),
    });
  }

  if (signals.has("BreadcrumbList") && !presentTypes.has("BreadcrumbList")) {
    suggestions.push({
      type: "BreadcrumbList",
      signal: signals.get("BreadcrumbList")!,
      template: buildBreadcrumbTemplate(url, $),
    });
  }

  if (signals.has("Organization") && !presentTypes.has("Organization")) {
    suggestions.push({
      type: "Organization",
      signal: signals.get("Organization")!,
      template: buildOrganizationTemplate($, url),
    });
  }

  const signalEntries: Record<string, string> = {};
  for (const [k, v] of signals.entries()) {
    if (!k.startsWith("_")) signalEntries[k] = v;
  }

  return {
    url,
    fetched_at: new Date().toISOString(),
    schema_types_present: [...presentTypes],
    signals_detected: signalEntries,
    suggestions: suggestions.map((s) => ({
      type: s.type,
      signal: s.signal,
      ready_to_paste: JSON.stringify(s.template, null, 2),
    })),
    summary: {
      types_present: presentTypes.size,
      signals_detected: Object.keys(signalEntries).length,
      suggestions_count: suggestions.length,
    },
    note: "Fields marked 'FILL:' require manual completion. Paste each ready_to_paste block into a <script type=\"application/ld+json\"> tag in <head>.",
  };
}
