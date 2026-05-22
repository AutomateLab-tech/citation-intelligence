import { z } from "zod";
import { checkCitations } from "./check-citations.js";
import { log } from "../lib/log.js";

export const citationEvidenceInputSchema = {
  query: z
    .string()
    .min(1)
    .describe("Search query whose AI answer to extract citation evidence from."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing_serp", "brave_serp", "google_ai_mode", "auto"])
    .default("auto")
    .describe(
      "AI engine to query. web_rank engines (bing_serp, brave_serp) lack raw_answer and return no evidence.",
    ),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("Max citations to extract evidence for."),
  context_chars: z
    .number()
    .int()
    .min(40)
    .max(800)
    .default(240)
    .describe(
      "Half-width of the snippet window around each citation mention (chars). Total snippet is up to 2x this.",
    ),
};

const inputSchema = z.object(citationEvidenceInputSchema);

function candidateMentions(url: string): string[] {
  const set = new Set<string>();
  set.add(url);
  set.add(url.replace(/^https?:\/\//, ""));
  set.add(url.replace(/^https?:\/\/(www\.)?/, ""));
  try {
    const u = new URL(url);
    set.add(u.hostname);
    set.add(u.hostname.replace(/^www\./, ""));
  } catch {
    // ignore
  }
  return [...set].filter(Boolean);
}

function findFirstMention(
  url: string,
  text: string,
): { index: number; matched: string } | null {
  if (!text) return null;
  let best: { index: number; matched: string } | null = null;
  for (const c of candidateMentions(url)) {
    const idx = text.indexOf(c);
    if (idx !== -1 && (!best || idx < best.index)) best = { index: idx, matched: c };
  }
  return best;
}

function extractWindow(
  text: string,
  centerStart: number,
  centerLen: number,
  halfWidth: number,
): { snippet: string; window_start: number; window_end: number } {
  const start = Math.max(0, centerStart - halfWidth);
  const end = Math.min(text.length, centerStart + centerLen + halfWidth);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `…${snippet}`;
  if (end < text.length) snippet = `${snippet}…`;
  return { snippet, window_start: start, window_end: end };
}

// Try to extract a quoted span if one wraps the URL mention. Falls back to
// sentence containing the mention. Otherwise empty.
function nearestQuotedOrSentence(
  text: string,
  mentionIdx: number,
): string | undefined {
  if (!text || mentionIdx < 0) return undefined;
  const QUOTE_CHARS = ['"', "“", "”", "「", "」"];
  // search backward and forward for nearest matching quote pair
  for (const q of QUOTE_CHARS) {
    const left = text.lastIndexOf(q, mentionIdx);
    if (left === -1) continue;
    const right = text.indexOf(q, mentionIdx);
    if (right === -1 || right - left > 800) continue;
    const inner = text.slice(left + 1, right).trim();
    if (inner.length >= 8) return inner;
  }
  // fallback: containing sentence
  const sentStart = Math.max(
    text.lastIndexOf(".", mentionIdx),
    text.lastIndexOf("!", mentionIdx),
    text.lastIndexOf("?", mentionIdx),
    text.lastIndexOf("\n", mentionIdx),
  );
  const sentEnd = (() => {
    const candidates = [
      text.indexOf(".", mentionIdx),
      text.indexOf("!", mentionIdx),
      text.indexOf("?", mentionIdx),
      text.indexOf("\n", mentionIdx),
    ].filter((i) => i !== -1);
    return candidates.length > 0 ? Math.min(...candidates) : text.length;
  })();
  const sent = text.slice(sentStart + 1, sentEnd + 1).trim();
  if (sent.length >= 12 && sent.length <= 600) return sent;
  return undefined;
}

export async function citationEvidence(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  log.debug("citation_evidence start", { query: parsed.query });

  const res = await checkCitations({
    query: parsed.query,
    engine: parsed.engine,
    max_results: parsed.max_results,
  });

  const raw = res.raw_answer ?? "";
  const has_raw = raw.length > 0;

  const evidence = res.citations.map((c) => {
    const mention = has_raw ? findFirstMention(c.url, raw) : null;
    if (!mention) {
      return {
        url: c.url,
        rank: c.rank,
        title: c.title,
        found: false,
        snippet: c.snippet ?? null,
        nearby_quote: null,
        mention_char: null,
      };
    }
    const { snippet } = extractWindow(
      raw,
      mention.index,
      mention.matched.length,
      parsed.context_chars,
    );
    return {
      url: c.url,
      rank: c.rank,
      title: c.title,
      found: true,
      snippet,
      nearby_quote: nearestQuotedOrSentence(raw, mention.index) ?? null,
      mention_char: mention.index,
      matched: mention.matched,
    };
  });

  return {
    query: parsed.query,
    engine: res.engine,
    fetched_at: new Date().toISOString(),
    raw_answer_chars: raw.length,
    has_raw_answer: has_raw,
    citations_total: res.citations.length,
    evidence_found: evidence.filter((e) => e.found).length,
    evidence,
    note: has_raw
      ? "snippet is a window around the first mention of the URL/hostname in the engine's raw_answer. nearby_quote tries to extract a quoted span or containing sentence."
      : "engine returned no raw_answer (Bing/Brave style listings, or empty answer). evidence is limited to whatever per-citation snippet the adapter parsed.",
  };
}
