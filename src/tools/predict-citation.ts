import { z } from "zod";
import {
  collectSignals,
  scoreSignals,
  suggestFixes,
} from "../adapters/predictors.js";
import { ToolFetchError } from "../lib/fetch.js";

export const predictCitationInputSchema = {
  url: z.string().url().describe("URL to score for citation likelihood. Must be absolute http(s)."),
};

const inputSchema = z.object(predictCitationInputSchema);

export async function predictCitation(input: z.infer<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);

  try {
    new URL(parsed.url);
  } catch {
    throw new ToolFetchError({
      type: "invalid_input",
      field: "url",
      message: `Not a valid URL: ${parsed.url}`,
    });
  }

  const signals = await collectSignals(parsed.url);
  const { score, grade } = scoreSignals(signals);
  const fixes = suggestFixes(signals);

  return {
    url: parsed.url,
    fetched_at: new Date().toISOString(),
    score,
    grade,
    signals,
    fixes,
  };
}
