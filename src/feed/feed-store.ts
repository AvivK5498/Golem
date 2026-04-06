import { createRequire } from "node:module";
import { logger } from "../utils/external-logger.js";
const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-runtime DB compat (better-sqlite3 / bun:sqlite)
function getDatabaseClass(): any {
  if (typeof Bun !== "undefined") {
    return require("bun:sqlite").Database;
  }
  return require("better-sqlite3");
}

export interface FeedEntry {
  id: number;
  agent_id: string;
  timestamp: number;
  source: string;       // 'direct' | 'cron' | 'heartbeat'
  source_name: string | null;
  input: string;
  output: string | null;
  sub_agent: string | null;
  status: string;       // 'delivered' | 'suppressed' | 'error'
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  platform: string | null;
}

const MAX_TEXT_LENGTH = 500;

function truncate(text: string | undefined | null, maxLen = MAX_TEXT_LENGTH): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}

export class FeedStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private insertStmt: any;

  constructor(dbPath: string) {
    const Database = getDatabaseClass();
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.initSchema();
    this.insertStmt = this.db.prepare(`
      INSERT INTO feed (agent_id, timestamp, source, source_name, input, output, sub_agent, status, tokens_in, tokens_out, latency_ms, platform)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'direct',
        source_name TEXT,
        input TEXT NOT NULL,
        output TEXT,
        sub_agent TEXT,
        status TEXT NOT NULL DEFAULT 'delivered',
        tokens_in INTEGER,
        tokens_out INTEGER,
        latency_ms INTEGER,
        platform TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_feed_timestamp ON feed(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_feed_status ON feed(status);
    `);

    // Migration: add agent_id column if missing
    const columns = this.db.prepare("PRAGMA table_info(feed)").all();
    const hasAgentId = columns.some((c: { name: string }) => c.name === "agent_id");
    if (!hasAgentId) {
      this.db.exec("ALTER TABLE feed ADD COLUMN agent_id TEXT");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_feed_agent ON feed(agent_id, timestamp)");
      console.log("[feed-store] migrated: added agent_id column");
    }
  }

  log(agentId: string, entry: {
    source?: string;
    sourceName?: string;
    input: string;
    output?: string;
    subAgent?: string;
    status?: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    platform?: string;
  }): void {
    try {
      this.insertStmt.run(
        agentId,
        Date.now(),
        entry.source || "direct",
        entry.sourceName || null,
        truncate(entry.input),
        truncate(entry.output),
        entry.subAgent || null,
        entry.status || "delivered",
        entry.tokensIn || null,
        entry.tokensOut || null,
        entry.latencyMs || null,
        entry.platform || null,
      );
    } catch (err) {
      console.warn(`[feed] failed to log entry: ${err instanceof Error ? err.message : String(err)}`);
      logger.error(`feed-store insert failed: ${err instanceof Error ? err.message : String(err)}`, { agent: agentId });
    }
  }

  list(agentId: string, opts: { limit?: number; status?: string; since?: number } = {}): FeedEntry[] {
    const limit = opts.limit || 50;
    const allAgents = agentId === "all";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (!allAgents) { conditions.push("agent_id = ?"); params.push(agentId); }
    if (opts.status && opts.status !== "all") { conditions.push("status = ?"); params.push(opts.status); }
    if (opts.since) { conditions.push("timestamp >= ?"); params.push(opts.since); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    return this.db.prepare(
      `SELECT * FROM feed ${where} ORDER BY timestamp DESC LIMIT ?`
    ).all(...params, limit) as FeedEntry[];
  }

  counts(agentId: string, since?: number): { total: number; delivered: number; suppressed: number; error: number } {
    const allAgents = agentId === "all";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (!allAgents) { conditions.push("agent_id = ?"); params.push(agentId); }
    if (since) { conditions.push("timestamp >= ?"); params.push(since); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END), 0) as delivered,
        COALESCE(SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END), 0) as suppressed,
        COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as error
      FROM feed
      ${where}
    `).get(...params) as { total: number; delivered: number; suppressed: number; error: number };
    return row;
  }

  tokenSummary(agentId: string, since?: number): { totalIn: number; totalOut: number; count: number } {
    const allAgents = agentId === "all";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (!allAgents) { conditions.push("agent_id = ?"); params.push(agentId); }
    if (since) { conditions.push("timestamp >= ?"); params.push(since); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(tokens_in), 0) as totalIn,
        COALESCE(SUM(tokens_out), 0) as totalOut,
        COUNT(*) as count
      FROM feed
      ${where}
    `).get(...params) as { totalIn: number; totalOut: number; count: number };
    return row;
  }
}
