import { z } from "zod";
import { JWT } from "google-auth-library";
import { readFile } from "node:fs/promises";
import { fetchJson } from "../lib/fetch.js";
import { amICited } from "./am-i-cited.js";
import { envKey } from "../lib/config.js";

export const gscCitationGapInputSchema = {
  domain: z
    .string()
    .min(1)
    .describe("Domain to analyze, e.g. 'automatelab.tech'. Used both for the GSC site URL and the citation check."),
  queries: z
    .array(z.string().min(1))
    .min(1)
    .max(20)
    .describe("Queries to cross-reference. 1-20 per call."),
  site_url: z
    .string()
    .optional()
    .describe("Override the GSC siteUrl. Defaults to 'sc-domain:<domain>'."),
  start_date: z
    .string()
    .describe("ISO date for GSC range start, e.g. '2026-04-01'."),
  end_date: z
    .string()
    .describe("ISO date for GSC range end, e.g. '2026-05-01'."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing", "brave", "auto"])
    .default("auto")
    .describe("AI engine for the citation check."),
  credentials_path: z
    .string()
    .optional()
    .describe("Path to GCP service account JSON. Defaults to env GOOGLE_APPLICATION_CREDENTIALS."),
};

const inputSchema = z.object(gscCitationGapInputSchema);

type GscRow = { keys?: string[]; impressions?: number; clicks?: number; position?: number; ctr?: number };

async function gscSearchAnalytics(args: {
  credentialsPath: string;
  siteUrl: string;
  startDate: string;
  endDate: string;
  queries: string[];
}): Promise<Map<string, GscRow>> {
  const raw = await readFile(args.credentialsPath, "utf8");
  const creds = JSON.parse(raw) as { client_email: string; private_key: string };
  const jwt = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  });
  const { token } = await jwt.getAccessToken();
  if (!token) throw new Error("failed to acquire GSC access token");

  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(args.siteUrl)}/searchAnalytics/query`;
  const body = JSON.stringify({
    startDate: args.startDate,
    endDate: args.endDate,
    dimensions: ["query"],
    dimensionFilterGroups: [
      {
        filters: args.queries.map((q) => ({ dimension: "query", operator: "equals", expression: q })),
        groupType: "or",
      },
    ],
    rowLimit: 1000,
  });
  const res = await fetchJson<{ rows?: GscRow[] }>(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body,
    timeoutMs: 20_000,
  });
  const map = new Map<string, GscRow>();
  for (const r of res.rows ?? []) {
    const key = r.keys?.[0];
    if (key) map.set(key.toLowerCase(), r);
  }
  return map;
}

export async function gscCitationGap(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const credentialsPath = parsed.credentials_path ?? envKey("GOOGLE_APPLICATION_CREDENTIALS");
  if (!credentialsPath) {
    return {
      error:
        "no GSC credentials path; pass credentials_path or set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON",
    };
  }

  const siteUrl = parsed.site_url ?? `sc-domain:${parsed.domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  const [gscMap, citation] = await Promise.all([
    gscSearchAnalytics({
      credentialsPath,
      siteUrl,
      startDate: parsed.start_date,
      endDate: parsed.end_date,
      queries: parsed.queries,
    }),
    amICited({ domain: parsed.domain, queries: parsed.queries, engine: parsed.engine }),
  ]);

  const rows = parsed.queries.map((q) => {
    const gsc = gscMap.get(q.toLowerCase());
    const cite = citation.results.find((r) => r.query === q);
    return {
      query: q,
      gsc: {
        impressions: gsc?.impressions ?? 0,
        clicks: gsc?.clicks ?? 0,
        position: gsc?.position,
        ctr: gsc?.ctr,
      },
      ai_cited: cite?.cited ?? false,
      ai_rank: cite?.rank,
    };
  });

  const gaps = rows
    .filter((r) => !r.ai_cited && r.gsc.impressions > 0 && (r.gsc.position ?? 999) <= 10)
    .sort((a, b) => b.gsc.impressions - a.gsc.impressions);

  return {
    domain: parsed.domain,
    site_url: siteUrl,
    range: { start: parsed.start_date, end: parsed.end_date },
    engine: citation.engine,
    rows,
    closest_wins: gaps,
  };
}
