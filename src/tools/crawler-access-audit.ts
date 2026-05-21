import { z } from "zod";
import robotsParserDefault from "robots-parser";
import { fetchText } from "../lib/fetch.js";
import { log } from "../lib/log.js";

// robots-parser ships a broken index.d.ts that emits both `declare module` and
// `export default` - TS resolves it to a namespace without call signatures.
// Cast through unknown to recover the documented function signature.
type RobotsLike = {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
};
const robotsParser = robotsParserDefault as unknown as (
  url: string,
  robotstxt: string,
) => RobotsLike;

export const crawlerAccessAuditInputSchema = {
  url: z
    .string()
    .url()
    .describe("Page URL to test for AI crawler access."),
  bots: z
    .array(z.string())
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Override the default bot list. Each entry is a User-Agent token (e.g. 'GPTBot', 'ClaudeBot').",
    ),
  fetch_with_ua: z
    .boolean()
    .default(true)
    .describe(
      "If true, do a live GET as each bot's User-Agent and report status. Disable to only parse robots.txt (no extra requests).",
    ),
};

const inputSchema = z.object(crawlerAccessAuditInputSchema);

// Curated list of the AI crawlers that matter for LLM citation visibility.
// User-agent tokens are the canonical strings each operator documents.
const DEFAULT_BOTS: Array<{
  name: string;
  ua_token: string;
  ua_full: string;
  operator: string;
  purpose: string;
}> = [
  {
    name: "GPTBot",
    ua_token: "GPTBot",
    ua_full: "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)",
    operator: "OpenAI",
    purpose: "ChatGPT training data",
  },
  {
    name: "OAI-SearchBot",
    ua_token: "OAI-SearchBot",
    ua_full:
      "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)",
    operator: "OpenAI",
    purpose: "ChatGPT Search index",
  },
  {
    name: "ChatGPT-User",
    ua_token: "ChatGPT-User",
    ua_full: "Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)",
    operator: "OpenAI",
    purpose: "Real-time fetch on user prompt",
  },
  {
    name: "ClaudeBot",
    ua_token: "ClaudeBot",
    ua_full: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    operator: "Anthropic",
    purpose: "Claude training data",
  },
  {
    name: "Claude-Web",
    ua_token: "Claude-Web",
    ua_full: "Mozilla/5.0 (compatible; Claude-Web/1.0; +https://www.anthropic.com)",
    operator: "Anthropic",
    purpose: "Real-time fetch when Claude browses",
  },
  {
    name: "PerplexityBot",
    ua_token: "PerplexityBot",
    ua_full:
      "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://docs.perplexity.ai/guides/bots)",
    operator: "Perplexity",
    purpose: "Perplexity index",
  },
  {
    name: "Perplexity-User",
    ua_token: "Perplexity-User",
    ua_full:
      "Mozilla/5.0 (compatible; Perplexity-User/1.0; +https://docs.perplexity.ai/guides/bots)",
    operator: "Perplexity",
    purpose: "Real-time fetch on user query",
  },
  {
    name: "CCBot",
    ua_token: "CCBot",
    ua_full: "CCBot/2.0 (https://commoncrawl.org/faq/)",
    operator: "Common Crawl",
    purpose: "Used by many LLM training corpora",
  },
  {
    name: "Google-Extended",
    ua_token: "Google-Extended",
    ua_full: "Google-Extended",
    operator: "Google",
    purpose: "Gemini training opt-out token (robots-only, no live fetch)",
  },
  {
    name: "Applebot-Extended",
    ua_token: "Applebot-Extended",
    ua_full: "Applebot-Extended",
    operator: "Apple",
    purpose: "Apple Intelligence training opt-out (robots-only)",
  },
  {
    name: "Bytespider",
    ua_token: "Bytespider",
    ua_full: "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)",
    operator: "ByteDance",
    purpose: "Doubao/Volcengine LLM training",
  },
  {
    name: "Meta-ExternalAgent",
    ua_token: "Meta-ExternalAgent",
    ua_full:
      "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    operator: "Meta",
    purpose: "Llama training data fetch",
  },
];

// robots-only (cannot be live-tested because the operator does not actually
// fetch the URL - it's an opt-out token consumed by their pipeline).
const ROBOTS_ONLY = new Set(["Google-Extended", "Applebot-Extended"]);

function robotsUrlFor(target: string): string {
  const u = new URL(target);
  return `${u.protocol}//${u.host}/robots.txt`;
}

type BotResult = {
  name: string;
  ua_token: string;
  operator: string;
  purpose: string;
  robots_allowed: boolean | "unknown";
  robots_rule: string | null;
  fetch_status: number | null;
  fetch_ok: boolean | null;
  fetch_error: string | null;
  verdict: "allowed" | "blocked" | "robots_only_allowed" | "robots_only_blocked" | "unknown";
};

export async function crawlerAccessAudit(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  log.debug("crawler_access_audit start", { url: parsed.url });

  const robotsUrl = robotsUrlFor(parsed.url);
  let robotsBody: string | null = null;
  let robotsStatus: number | null = null;
  let robotsError: string | null = null;
  try {
    const r = await fetchText(robotsUrl, { timeoutMs: 15_000 });
    robotsStatus = r.status;
    robotsBody = r.status < 400 ? r.text : "";
  } catch (err) {
    robotsError = err instanceof Error ? err.message : String(err);
    robotsBody = "";
  }

  const robots = robotsParser(robotsUrl, robotsBody ?? "");

  const botList = parsed.bots
    ? parsed.bots.map((token) => {
        const known = DEFAULT_BOTS.find(
          (b) => b.name.toLowerCase() === token.toLowerCase() || b.ua_token === token,
        );
        return (
          known ?? {
            name: token,
            ua_token: token,
            ua_full: token,
            operator: "unknown",
            purpose: "user-supplied bot",
          }
        );
      })
    : DEFAULT_BOTS;

  const results: BotResult[] = await Promise.all(
    botList.map(async (bot): Promise<BotResult> => {
      let allowed: boolean | "unknown" = "unknown";
      try {
        const a = robots.isAllowed(parsed.url, bot.ua_token);
        if (typeof a === "boolean") allowed = a;
      } catch {
        allowed = "unknown";
      }
      const rule = (() => {
        try {
          // robots-parser exposes the matched rule via getMatchingLineNumber, but
          // not all versions expose it. Keep it simple: report the User-Agent
          // group we matched if any disallow line exists for this bot.
          if (!robotsBody) return null;
          const re = new RegExp(
            `(^|\\n)User-agent:\\s*${bot.ua_token}([\\s\\S]*?)(?=\\n\\s*User-agent:|$)`,
            "i",
          );
          const m = robotsBody.match(re);
          if (!m) return null;
          const block = m[2]
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => /^(allow|disallow|crawl-delay):/i.test(line))
            .join(" | ");
          return block || null;
        } catch {
          return null;
        }
      })();

      const isRobotsOnly = ROBOTS_ONLY.has(bot.name);
      if (isRobotsOnly || !parsed.fetch_with_ua) {
        const verdict: BotResult["verdict"] =
          allowed === true
            ? isRobotsOnly
              ? "robots_only_allowed"
              : "allowed"
            : allowed === false
              ? isRobotsOnly
                ? "robots_only_blocked"
                : "blocked"
              : "unknown";
        return {
          name: bot.name,
          ua_token: bot.ua_token,
          operator: bot.operator,
          purpose: bot.purpose,
          robots_allowed: allowed,
          robots_rule: rule,
          fetch_status: null,
          fetch_ok: null,
          fetch_error: null,
          verdict,
        };
      }

      // live UA test
      let status: number | null = null;
      let err: string | null = null;
      try {
        const r = await fetchText(parsed.url, {
          method: "GET",
          headers: { "user-agent": bot.ua_full },
          timeoutMs: 15_000,
        });
        status = r.status;
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      const fetchOk = status !== null && status < 400;
      const verdict: BotResult["verdict"] =
        allowed === false
          ? "blocked"
          : fetchOk
            ? "allowed"
            : allowed === true
              ? "blocked"
              : "unknown";
      return {
        name: bot.name,
        ua_token: bot.ua_token,
        operator: bot.operator,
        purpose: bot.purpose,
        robots_allowed: allowed,
        robots_rule: rule,
        fetch_status: status,
        fetch_ok: fetchOk,
        fetch_error: err,
        verdict,
      };
    }),
  );

  const summary = {
    total: results.length,
    allowed: results.filter((r) => r.verdict === "allowed" || r.verdict === "robots_only_allowed").length,
    blocked: results.filter((r) => r.verdict === "blocked" || r.verdict === "robots_only_blocked").length,
    unknown: results.filter((r) => r.verdict === "unknown").length,
  };

  return {
    url: parsed.url,
    robots_url: robotsUrl,
    robots_status: robotsStatus,
    robots_present: !!(robotsBody && robotsBody.length > 0),
    robots_error: robotsError,
    fetched_at: new Date().toISOString(),
    bots: results,
    summary,
    note:
      "verdict combines robots.txt parsing with a live GET using each bot's User-Agent (unless fetch_with_ua=false or the bot is opt-out-token only, like Google-Extended). 'blocked' = robots.txt forbids OR the page 4xx/5xx'd under that UA.",
  };
}
