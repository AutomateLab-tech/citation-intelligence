import { envKey } from "../lib/config.js";
import { fetchJson, ToolFetchError } from "../lib/fetch.js";
import type { AdapterResult, Citation } from "../types.js";

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
};

export async function geminiSearch(
  query: string,
  maxResults: number,
): Promise<AdapterResult> {
  const key = envKey("GEMINI_API_KEY");
  if (!key) {
    throw new ToolFetchError({
      type: "missing_key",
      engine: "gemini",
      env_var: "GEMINI_API_KEY",
      message:
        "Set GEMINI_API_KEY to use the Gemini engine. Get a key at https://aistudio.google.com/apikey.",
    });
  }

  // System prompt approximates Gemini consumer app behavior: search-first with source attribution.
  const body = JSON.stringify({
    system_instruction: {
      parts: [{ text: "You are a search assistant. Answer with inline citations. List each source URL you used." }],
    },
    contents: [{ parts: [{ text: query }] }],
    tools: [{ google_search: {} }],
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetchJson<GeminiResponse>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  const citations: Citation[] = [];
  const seen = new Set<string>();
  const textParts: string[] = [];

  for (const cand of res.candidates ?? []) {
    for (const p of cand.content?.parts ?? []) {
      if (p.text) textParts.push(p.text);
    }
    for (const chunk of cand.groundingMetadata?.groundingChunks ?? []) {
      const u = chunk.web?.uri;
      if (!u || seen.has(u)) continue;
      seen.add(u);
      citations.push({
        url: u,
        title: chunk.web?.title,
        rank: citations.length + 1,
      });
      if (citations.length >= maxResults) break;
    }
  }

  return { citations, raw_answer: textParts.join("\n") || undefined };
}
