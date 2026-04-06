import { createRequire } from "node:module";
import crypto from "node:crypto";

const require = createRequire(import.meta.url);


// Support both better-sqlite3 (Node/tsx) and bun:sqlite (Bun tests)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDatabaseClass(): any {
  if (typeof Bun !== "undefined") {
    return require("bun:sqlite").Database;
  }
  return require("better-sqlite3");
}

export interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  input: string; // JSON string
  result: string | null;
  error: string | null;
  target_jid: string;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  attempt: number;
  max_attempts: number;
  timeout_ms: number;
  platform: string | null;
  agent_id: string | null;
}

export class JobQueue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  constructor(dbPath: string) {
    const Database = getDatabaseClass();
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        input TEXT NOT NULL,
        result TEXT,
        error TEXT,
        target_jid TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        attempt INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        timeout_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs(type, status);
    `);

    // Migration: add platform column for multi-platform support
    try {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN platform TEXT`);
    } catch {
      // Column already exists — ignore
    }

    // Migration: add agent_id column for multi-agent routing
    try {
      this.db.exec(`ALTER TABLE jobs ADD COLUMN agent_id TEXT`);
    } catch {
      // Column already exists — ignore
    }
  }

  enqueue(
    type: string,
    input: unknown,
    targetJid: string,
    agentId: string,
    opts: { timeoutMs: number; maxAttempts?: number },
    platform?: string
  ): string {
    const id = crypto.randomUUID();
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO jobs (id, type, status, input, target_jid, created_at, timeout_ms, max_attempts, platform, agent_id)
      VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      type,
      JSON.stringify(input),
      targetJid,
      now,
      opts.timeoutMs,
      opts.maxAttempts ?? 3,
      platform ?? null,
      agentId ?? null
    );

    return id;
  }

  dequeueForType(type: string, limit: number): Job[] {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'queued' AND type = ?
      ORDER BY created_at ASC
      LIMIT ?
    `);

    return stmt.all(type, limit) as Job[];
  }

  markRunning(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE jobs SET status = 'running', started_at = ?
      WHERE id = ?
    `);
    stmt.run(Date.now(), id);
  }

  markCompleted(id: string, result: unknown): void {
    const stmt = this.db.prepare(`
      UPDATE jobs SET status = 'completed', result = ?, completed_at = ?
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(result), Date.now(), id);
  }

  markFailed(id: string, error: string): void {
    const stmt = this.db.prepare(`
      UPDATE jobs SET status = 'failed', error = ?, completed_at = ?
      WHERE id = ?
    `);
    stmt.run(error, Date.now(), id);
  }

  requeueForRetry(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE jobs SET status = 'queued', attempt = attempt + 1, started_at = NULL
      WHERE id = ?
    `);
    stmt.run(id);
  }

  getRunningCount(type?: string): number {
    if (type) {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM jobs WHERE status = 'running' AND type = ?
      `);
      const row = stmt.get(type) as { count: number };
      return row.count;
    }
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM jobs WHERE status = 'running'
    `);
    const row = stmt.get() as { count: number };
    return row.count;
  }

  getQueuedCount(type?: string): number {
    if (type) {
      const stmt = this.db.prepare(`
        SELECT COUNT(*) as count FROM jobs WHERE status = 'queued' AND type = ?
      `);
      const row = stmt.get(type) as { count: number };
      return row.count;
    }
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM jobs WHERE status = 'queued'
    `);
    const row = stmt.get() as { count: number };
    return row.count;
  }

  listAll(limit = 100): Job[] {
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as Job[];
  }

  /** Check if there's an active (queued or running) job of this type with matching input. */
  hasActiveJob(type: string, inputMatch: (input: unknown) => boolean): boolean {
    const stmt = this.db.prepare(`
      SELECT input FROM jobs WHERE type = ? AND status IN ('queued', 'running')
    `);
    const rows = stmt.all(type) as Array<{ input: string }>;
    return rows.some((row) => {
      try { return inputMatch(JSON.parse(row.input)); } catch { return false; }
    });
  }

  hasRecentJob(type: string, withinMs: number, inputMatch: (input: unknown) => boolean): boolean {
    const cutoff = Date.now() - withinMs;
    const stmt = this.db.prepare(`
      SELECT input FROM jobs WHERE type = ? AND status = 'completed' AND completed_at > ?
    `);
    const rows = stmt.all(type, cutoff) as Array<{ input: string }>;
    return rows.some((row) => {
      try { return inputMatch(JSON.parse(row.input)); } catch { return false; }
    });
  }

  getRunningJobs(): Job[] {
    const stmt = this.db.prepare(`SELECT * FROM jobs WHERE status = 'running'`);
    return stmt.all() as Job[];
  }

  getTimedOutJobs(): Job[] {
    const now = Date.now();
    const stmt = this.db.prepare(`
      SELECT * FROM jobs
      WHERE status = 'running' AND (started_at + timeout_ms) < ?
    `);
    return stmt.all(now) as Job[];
  }

  cleanup(maxAgeDays: number): void {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const stmt = this.db.prepare(`
      DELETE FROM jobs
      WHERE status IN ('completed', 'failed') AND completed_at < ?
    `);
    stmt.run(cutoff);
  }

  close(): void {
    this.db.close();
  }
}
