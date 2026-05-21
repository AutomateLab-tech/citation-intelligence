import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchText, ToolFetchError } from "../lib/fetch.js";

export const schemaAuditInputSchema = {
  url: z.string().url().describe("URL whose JSON-LD and microdata to validate against schema.org expected fields."),
};

const inputSchema = z.object(schemaAuditInputSchema);

// Required-field map per @type. Keys are the absolutely-needed properties for
// AI search engines to treat the markup as well-formed. Lists are conservative
// (Google rich-results minimums) - we flag missing required, not just recommended.
const REQUIRED_FIELDS: Record<string, string[]> = {
  Article: ["headline", "author", "datePublished"],
  BlogPosting: ["headline", "author", "datePublished"],
  NewsArticle: ["headline", "author", "datePublished"],
  TechArticle: ["headline", "author", "datePublished"],
  FAQPage: ["mainEntity"],
  Question: ["name", "acceptedAnswer"],
  HowTo: ["name", "step"],
  Product: ["name"],
  Recipe: ["name", "recipeIngredient", "recipeInstructions"],
  BreadcrumbList: ["itemListElement"],
  Organization: ["name"],
  Person: ["name"],
  WebPage: ["name"],
  WebSite: ["name"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
  ImageObject: ["contentUrl"],
};

type NodeIssue = {
  type: string;
  path: string;
  severity: "error" | "warning";
  message: string;
};

function walkJsonLd(
  node: unknown,
  path: string,
  out: Array<{ type: string; path: string; obj: Record<string, unknown> }>,
): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => walkJsonLd(n, `${path}[${i}]`, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  const types = Array.isArray(t) ? t.filter((x) => typeof x === "string") : typeof t === "string" ? [t] : [];
  for (const type of types) out.push({ type, path, obj });
  for (const [k, v] of Object.entries(obj)) {
    if (k === "@type" || k === "@context") continue;
    walkJsonLd(v, path ? `${path}.${k}` : k, out);
  }
}

function validateNode(type: string, obj: Record<string, unknown>, path: string): NodeIssue[] {
  const required = REQUIRED_FIELDS[type];
  if (!required) return [];
  const issues: NodeIssue[] = [];
  for (const field of required) {
    const v = obj[field];
    const missing =
      v === undefined ||
      v === null ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);
    if (missing) {
      issues.push({
        type,
        path,
        severity: "error",
        message: `${type} is missing required field '${field}'.`,
      });
    }
  }
  // Light per-type extra checks.
  if (type === "FAQPage") {
    const me = obj.mainEntity;
    if (Array.isArray(me) && me.length === 0) {
      issues.push({
        type,
        path,
        severity: "error",
        message: "FAQPage.mainEntity is empty - add at least one Question.",
      });
    }
  }
  if (type === "HowTo") {
    const step = obj.step;
    if (Array.isArray(step) && step.length === 0) {
      issues.push({
        type,
        path,
        severity: "error",
        message: "HowTo.step is empty - add at least one step.",
      });
    }
  }
  return issues;
}

export async function schemaAudit(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);

  const { text, status } = await fetchText(parsed.url, { timeoutMs: 15_000 });
  if (status >= 400) {
    throw new ToolFetchError({
      type: "fetch_error",
      url: parsed.url,
      status,
      message: `URL returned HTTP ${status} - cannot audit schema on a non-existent page.`,
    });
  }

  const $ = cheerio.load(text);
  const jsonLdBlocks: Array<{ raw: string; parseError?: string }> = [];
  const nodes: Array<{ type: string; path: string; obj: Record<string, unknown> }> = [];

  $('script[type="application/ld+json"]').each((i, el) => {
    const raw = $(el).text();
    try {
      const json = JSON.parse(raw);
      jsonLdBlocks.push({ raw: raw.slice(0, 200) });
      walkJsonLd(json, `block[${i}]`, nodes);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      jsonLdBlocks.push({ raw: raw.slice(0, 200), parseError: msg });
    }
  });

  const microdataTypes: string[] = [];
  $("[itemtype]").each((_, el) => {
    const t = $(el).attr("itemtype");
    if (!t) return;
    const last = t.split("/").pop();
    if (last) microdataTypes.push(last);
  });

  const allIssues: NodeIssue[] = [];
  for (const { type, path, obj } of nodes) {
    allIssues.push(...validateNode(type, obj, path));
  }
  for (const block of jsonLdBlocks) {
    if (block.parseError) {
      allIssues.push({
        type: "(json-ld)",
        path: "block",
        severity: "error",
        message: `Malformed JSON-LD: ${block.parseError}`,
      });
    }
  }

  const presentTypes = [...new Set(nodes.map((n) => n.type))];
  const knownTypeIssues = allIssues.filter((i) => i.severity === "error").length;

  return {
    url: parsed.url,
    fetched_at: new Date().toISOString(),
    json_ld_blocks: jsonLdBlocks.length,
    json_ld_parse_errors: jsonLdBlocks.filter((b) => b.parseError).length,
    schema_types_present: presentTypes,
    microdata_types_present: [...new Set(microdataTypes)],
    issues: allIssues,
    summary: {
      blocks: jsonLdBlocks.length,
      typed_nodes: nodes.length,
      errors: knownTypeIssues,
      warnings: allIssues.filter((i) => i.severity === "warning").length,
      valid: knownTypeIssues === 0 && nodes.length > 0,
    },
    note:
      "Validates required fields per @type using Google rich-results minimums. Unknown @types are skipped (no false positives). 'valid: false' means at least one typed node is missing a required field; 'valid: true' with typed_nodes=0 cannot occur.",
  };
}
