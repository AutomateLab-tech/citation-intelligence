// Stderr logger. stdout is reserved for JSON-RPC transport.
// Level controlled by CITATION_LOG_LEVEL env var: debug | info | warn | error (default: info).

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const raw = (process.env.CITATION_LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

const TAG = "[citation-intelligence]";

function emit(level: LogLevel, msg: string, extra?: unknown): void {
  if (LEVELS[level] < LEVELS[resolveLevel()]) return;
  const line = extra === undefined ? `${TAG} ${level}: ${msg}` : `${TAG} ${level}: ${msg} ${safeJson(extra)}`;
  process.stderr.write(line + "\n");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  debug: (msg: string, extra?: unknown) => emit("debug", msg, extra),
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
  level: resolveLevel,
};
