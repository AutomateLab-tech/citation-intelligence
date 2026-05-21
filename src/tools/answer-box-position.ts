import { z } from "zod";
import { checkCitations } from "./check-citations.js";
import { log } from "../lib/log.js";

export const answerBoxPositionInputSchema = {
  query: z.string().min(1).describe("Search query whose AI answer to measure citation positions on."),
  engine: z
    .enum(["perplexity", "claude", "openai", "gemini", "bing", "brave", "auto"])
    .default("auto")
    .describe("AI engine to query. Engines without raw_answer (Bing, Brave) return position 'unknown'."),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe("Max citations to locate."),
};

const inputSchema = z.object(answerBoxPositionInputSchema);

type Position = "early" | "middle" | "late" | "unknown";

function bucket(charIndex: number, total: number): Position {
  if (total === 0) return "unknown";
  const ratio = charIndex / total;
  if (ratio < 1 / 3) return "early";
  if (ratio < 2 / 3) return "middle";
  return "late";
}

// Find earliest mention of a URL in the answer text. Matches by exact URL,
// by URL without protocol, and by hostname+path-first-segment - whichever
// catches first. Returns char index or -1.
function findFirstMention(url: string, text: string): number {
  if (!text) return -1;
  const candidates = new Set<string>();
  candidates.add(url);
  candidates.add(url.replace(/^https?:\/\//, ""));
  candidates.add(url.replace(/^https?:\/\/(www\.)?/, ""));
  try {
    const u = new URL(url);
    candidates.add(u.hostname);
    candidates.add(u.hostname.replace(/^www\./, ""));
  } catch {
    // ignore
  }
  let best = -1;
  for (const c of candidates) {
    if (!c) continue;
    const idx = text.indexOf(c);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

export async function answerBoxPosition(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  log.debug("answer_box_position start", { query: parsed.query });

  const res = await checkCitations({
    query: parsed.query,
    engine: parsed.engine,
    max_results: parsed.max_results,
  });

  const raw = res.raw_answer ?? "";
  const total = raw.length;

  const positions = res.citations.map((c) => {
    const idx = findFirstMention(c.url, raw);
    return {
      url: c.url,
      rank: c.rank,
      title: c.title,
      first_mention_char: idx >= 0 ? idx : null,
      position: idx >= 0 ? bucket(idx, total) : ("unknown" as Position),
    };
  });

  const counts = {
    early: positions.filter((p) => p.position === "early").length,
    middle: positions.filter((p) => p.position === "middle").length,
    late: positions.filter((p) => p.position === "late").length,
    unknown: positions.filter((p) => p.position === "unknown").length,
  };

  return {
    query: parsed.query,
    engine: res.engine,
    fetched_at: new Date().toISOString(),
    answer_chars: total,
    citations_total: res.citations.length,
    positions,
    buckets: counts,
    note:
      "position bins the answer into thirds (early <33%, middle <66%, late >=66%). 'unknown' means the URL was not found in raw_answer or the engine didn't return a raw answer (e.g. Bing, Brave).",
  };
}
