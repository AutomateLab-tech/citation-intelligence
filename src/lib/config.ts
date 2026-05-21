import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR =
  process.env.CITATION_CONFIG_DIR ??
  join(homedir(), ".config", "citation-intelligence");

export const CACHE_FILE = join(CONFIG_DIR, "cache.json");

export const CACHE_TTL_DAYS = Number(
  process.env.CITATION_CACHE_TTL_DAYS ?? "7",
);

export const AI_OVERVIEW_TTL_DAYS = Number(
  process.env.CITATION_AI_OVERVIEW_TTL_DAYS ?? "1",
);

export function envKey(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}
