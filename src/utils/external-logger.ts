/**
 * External structured logger — sends logs to the golem-logger service.
 * Buffers lines and flushes every 5 seconds to reduce HTTP calls.
 * Silent on failure — never crashes the app.
 */

const LOGGER_URL = (process.env.LOGGER_URL || "").replace(/\/$/, "");
const LOGGER_TOKEN = process.env.LOGGER_TOKEN || "";
const ENABLED = Boolean(LOGGER_TOKEN) && Boolean(LOGGER_URL);
const FLUSH_INTERVAL_MS = 5_000;
const SOURCE = "golem-agent";

type Level = "INFO" | "WARN" | "ERROR";

interface BufferedEntry {
  level: Level;
  line: string;
  tags: Record<string, string>;
}

const buffer: BufferedEntry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

function startFlushTimer(): void {
  if (timer || !ENABLED) return;
  timer = setInterval(flush, FLUSH_INTERVAL_MS);
  if (timer.unref) timer.unref(); // don't keep process alive for logging
}

function append(level: Level, line: string, tags: Record<string, string> = {}): void {
  if (!ENABLED) return;
  buffer.push({ level, line, tags });
  startFlushTimer();
}

export async function flush(): Promise<void> {
  if (buffer.length === 0) return;

  // Group by level + tags key for batched sends
  const batches = new Map<string, { level: Level; tags: Record<string, string>; lines: string[] }>();
  for (const entry of buffer.splice(0)) {
    const key = `${entry.level}:${JSON.stringify(entry.tags)}`;
    if (!batches.has(key)) {
      batches.set(key, { level: entry.level, tags: entry.tags, lines: [] });
    }
    batches.get(key)!.lines.push(entry.line);
  }

  for (const batch of batches.values()) {
    try {
      await fetch(`${LOGGER_URL}/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LOGGER_TOKEN}`,
          "User-Agent": "golem-agent/1.0",
        },
        body: JSON.stringify({
          source: SOURCE,
          tags: batch.tags,
          level: batch.level,
          lines: batch.lines,
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Never let logging failures break the app
    }
  }
}

// Public API
export const logger = {
  info(line: string, tags?: Record<string, string>): void {
    append("INFO", line, tags);
  },
  warn(line: string, tags?: Record<string, string>): void {
    append("WARN", line, tags);
  },
  error(line: string, tags?: Record<string, string>): void {
    append("ERROR", line, tags);
  },
  flush,
};
