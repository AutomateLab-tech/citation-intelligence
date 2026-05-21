import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CACHE_FILE, CACHE_TTL_DAYS, AI_OVERVIEW_TTL_DAYS } from "./config.js";
import type { Citation, Engine } from "../types.js";

type CitationEntry = {
  type: "citation_check";
  engine: Engine;
  query: string;
  fetched_at: string;
  citations: Citation[];
  raw_answer?: string;
};

type AiOverviewEntry = {
  type: "ai_overview";
  query: string;
  location?: string;
  hl?: string;
  fetched_at: string;
  ai_overview_present: boolean;
  ai_overview_text?: string;
  sources: Citation[];
};

export type CacheEntry = CitationEntry | AiOverviewEntry;

type CacheFile = {
  version: 1;
  entries: CacheEntry[];
};

const EMPTY: CacheFile = { version: 1, entries: [] };

let memory: CacheFile | null = null;

async function load(): Promise<CacheFile> {
  if (memory) return memory;
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      memory = { ...EMPTY };
    } else {
      memory = parsed;
    }
  } catch {
    memory = { ...EMPTY };
  }
  return memory;
}

async function persist(): Promise<void> {
  if (!memory) return;
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  await writeFile(CACHE_FILE, JSON.stringify(memory, null, 2), "utf8");
}

function isFresh(fetched_at: string, ttlDays: number): boolean {
  const t = Date.parse(fetched_at);
  if (Number.isNaN(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs < ttlDays * 86_400_000;
}

export async function getCitations(
  query: string,
  engine: Engine,
): Promise<CitationEntry | null> {
  const cache = await load();
  const hit = cache.entries.find(
    (e): e is CitationEntry =>
      e.type === "citation_check" &&
      e.engine === engine &&
      e.query.toLowerCase() === query.toLowerCase(),
  );
  if (!hit) return null;
  if (!isFresh(hit.fetched_at, CACHE_TTL_DAYS)) return null;
  return hit;
}

export async function putCitations(entry: CitationEntry): Promise<void> {
  const cache = await load();
  cache.entries = cache.entries.filter(
    (e) =>
      !(
        e.type === "citation_check" &&
        e.engine === entry.engine &&
        e.query.toLowerCase() === entry.query.toLowerCase()
      ),
  );
  cache.entries.push(entry);
  await persist();
}

export async function getAiOverview(
  query: string,
  location: string | undefined,
  hl: string | undefined,
): Promise<AiOverviewEntry | null> {
  const cache = await load();
  const hit = cache.entries.find(
    (e): e is AiOverviewEntry =>
      e.type === "ai_overview" &&
      e.query.toLowerCase() === query.toLowerCase() &&
      (e.location ?? "") === (location ?? "") &&
      (e.hl ?? "") === (hl ?? ""),
  );
  if (!hit) return null;
  if (!isFresh(hit.fetched_at, AI_OVERVIEW_TTL_DAYS)) return null;
  return hit;
}

export async function putAiOverview(entry: AiOverviewEntry): Promise<void> {
  const cache = await load();
  cache.entries = cache.entries.filter(
    (e) =>
      !(
        e.type === "ai_overview" &&
        e.query.toLowerCase() === entry.query.toLowerCase() &&
        (e.location ?? "") === (entry.location ?? "") &&
        (e.hl ?? "") === (entry.hl ?? "")
      ),
  );
  cache.entries.push(entry);
  await persist();
}

export async function citedForDomain(
  domain: string,
  since: string | undefined,
  engineFilter: string | undefined,
  limit: number,
): Promise<
  Array<{
    query: string;
    engine: Engine;
    rank: number;
    fetched_at: string;
    url: string;
  }>
> {
  const cache = await load();
  const sinceMs = since ? Date.parse(since) : 0;
  const out: Array<{
    query: string;
    engine: Engine;
    rank: number;
    fetched_at: string;
    url: string;
  }> = [];
  const needle = domain.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
  for (const e of cache.entries) {
    if (e.type !== "citation_check") continue;
    if (engineFilter && e.engine !== engineFilter) continue;
    if (sinceMs && Date.parse(e.fetched_at) < sinceMs) continue;
    for (const c of e.citations) {
      try {
        const u = new URL(c.url);
        if (u.hostname.toLowerCase().endsWith(needle)) {
          out.push({
            query: e.query,
            engine: e.engine,
            rank: c.rank,
            fetched_at: e.fetched_at,
            url: c.url,
          });
        }
      } catch {
        // skip malformed URLs
      }
    }
  }
  out.sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));
  return out.slice(0, limit);
}
