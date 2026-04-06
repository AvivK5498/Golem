import { createRequire } from "node:module";
import { CronExpressionParser } from "cron-parser";
import { logger } from "../utils/external-logger.js";
const require = createRequire(import.meta.url);

// Support both better-sqlite3 (Node/tsx) and bun:sqlite (Bun tests)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-runtime DB compat (better-sqlite3 / bun:sqlite)
function getDatabaseClass(): any {
  if (typeof Bun !== "undefined") {
    return require("bun:sqlite").Database;
  }
  return require("better-sqlite3");
}

export interface CronJob {
  id: number;
  agent_id: string;
  name: string;
  description: string;
  cron_expr: string;
  task_kind: string;
  target_jid: string | null;
  platform: string | null;
  paused: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  once: number;
}

export class CronStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-runtime DB compat (better-sqlite3 / bun:sqlite)
  private db: any;

  constructor(dbPath: string) {
    const Database = getDatabaseClass();
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS crons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        cron_expr TEXT NOT NULL,
        task_kind TEXT NOT NULL DEFAULT 'reminder',
        target_jid TEXT,
        platform TEXT,
        paused INTEGER DEFAULT 0,
        next_run_at INTEGER,
        last_run_at INTEGER,
        created_at INTEGER DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_crons_next_run ON crons(next_run_at);
      CREATE INDEX IF NOT EXISTS idx_crons_paused ON crons(paused);
    `);

    // Migration: add agent_id column if missing
    const columns = this.db.prepare("PRAGMA table_info(crons)").all();
    const hasAgentId = columns.some((c: { name: string }) => c.name === "agent_id");
    if (!hasAgentId) {
      this.db.exec("ALTER TABLE crons ADD COLUMN agent_id TEXT");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_crons_agent ON crons(agent_id, next_run_at)");
      console.log("[cron-store] migrated: added agent_id column");
    }
    // Migration: add once column if missing
    const hasOnce = columns.some((c: { name: string }) => c.name === "once");
    if (!hasOnce) {
      this.db.exec("ALTER TABLE crons ADD COLUMN once INTEGER DEFAULT 0");
    }

  }

  addCron(agentId: string, params: {
    name: string;
    description: string;
    cronExpr: string;
    taskKind?: string;
    targetJid?: string;
    platform?: string;
    once?: boolean;
    timezone?: string;
  }): CronJob {
    // Calculate next run time from cron expression in the specified timezone
    const tz = params.timezone || "Asia/Jerusalem";
    let nextRunAt: number | null = null;
    try {
      nextRunAt = CronExpressionParser.parse(params.cronExpr, { tz }).next().getTime();
    } catch {
      // Invalid cron — leave next_run_at null (won't fire until fixed)
    }

    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO crons (agent_id, name, description, cron_expr, task_kind, target_jid, platform, next_run_at, created_at, once)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      agentId,
      params.name,
      params.description,
      params.cronExpr,
      params.taskKind || "agent_turn",
      params.targetJid || null,
      params.platform || null,
      nextRunAt,
      now,
      params.once ? 1 : 0,
    );

    const newId = result.lastInsertRowid as number;
    logger.info(`cron created: "${params.name}" (${params.cronExpr})`, { cronId: String(newId), cronName: params.name, agent: agentId });

    return {
      id: newId,
      agent_id: agentId,
      name: params.name,
      description: params.description,
      cron_expr: params.cronExpr,
      task_kind: params.taskKind || "agent_turn",
      target_jid: params.targetJid || null,
      platform: params.platform || null,
      paused: 0,
      next_run_at: nextRunAt,
      last_run_at: null,
      created_at: now,
      once: params.once ? 1 : 0,
    };
  }

  getCron(agentId: string, id: number): CronJob | null {
    const stmt = this.db.prepare(`SELECT * FROM crons WHERE agent_id = ? AND id = ?`);
    return (stmt.get(agentId, id) as CronJob | undefined) ?? null;
  }

  /** Get a cron by ID regardless of agent (IDs are globally unique). */
  getCronById(id: number): CronJob | null {
    const stmt = this.db.prepare(`SELECT * FROM crons WHERE id = ?`);
    return (stmt.get(id) as CronJob | undefined) ?? null;
  }

  listCrons(agentId?: string): CronJob[] {
    if (agentId) {
      const stmt = this.db.prepare(`SELECT * FROM crons WHERE agent_id = ? ORDER BY created_at DESC`);
      return stmt.all(agentId) as CronJob[];
    }
    const stmt = this.db.prepare(`SELECT * FROM crons ORDER BY created_at DESC`);
    return stmt.all() as CronJob[];
  }

  updateCron(agentId: string, id: number, fields: {
    name?: string;
    description?: string;
    cron_expr?: string;
    task_kind?: string;
    paused?: boolean;
    next_run_at?: number | null;
  }): boolean {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.name !== undefined) { sets.push("name = ?"); values.push(fields.name); }
    if (fields.description !== undefined) { sets.push("description = ?"); values.push(fields.description); }
    if (fields.cron_expr !== undefined) {
      sets.push("cron_expr = ?");
      values.push(fields.cron_expr);
      // Recalculate next_run_at when cron_expr changes (unless explicitly provided)
      if (fields.next_run_at === undefined) {
        try {
          const nextRunAt = CronExpressionParser.parse(fields.cron_expr, { tz: "UTC" }).next().getTime();
          sets.push("next_run_at = ?");
          values.push(nextRunAt);
        } catch {
          sets.push("next_run_at = ?");
          values.push(null);
        }
      }
    }
    if (fields.task_kind !== undefined) { sets.push("task_kind = ?"); values.push(fields.task_kind); }
    if (fields.paused !== undefined) { sets.push("paused = ?"); values.push(fields.paused ? 1 : 0); }
    if (fields.next_run_at !== undefined) { sets.push("next_run_at = ?"); values.push(fields.next_run_at); }
    if (sets.length === 0) return false;
    values.push(agentId, id);
    const stmt = this.db.prepare(`UPDATE crons SET ${sets.join(", ")} WHERE agent_id = ? AND id = ?`);
    const changed = stmt.run(...values).changes > 0;
    if (changed) {
      logger.info(`cron updated: id=${id}`, { cronId: String(id), cronName: fields.name || "", agent: agentId });
    }
    return changed;
  }

  deleteCron(agentId: string, id: number): boolean {
    const stmt = this.db.prepare(`DELETE FROM crons WHERE agent_id = ? AND id = ?`);
    const deleted = stmt.run(agentId, id).changes > 0;
    if (deleted) {
      logger.info(`cron deleted: id=${id}`, { cronId: String(id), agent: agentId });
    }
    return deleted;
  }

  pauseCron(agentId: string, id: number): boolean {
    const stmt = this.db.prepare(`UPDATE crons SET paused = 1 WHERE agent_id = ? AND id = ?`);
    return stmt.run(agentId, id).changes > 0;
  }

  resumeCron(agentId: string, id: number): boolean {
    const stmt = this.db.prepare(`UPDATE crons SET paused = 0 WHERE agent_id = ? AND id = ?`);
    return stmt.run(agentId, id).changes > 0;
  }

  /** Called by TaskTimer after a cron fires — uses id alone since cron is already identified */
  markRun(id: number, nextRunAt: number): void {
    const stmt = this.db.prepare(`
      UPDATE crons SET last_run_at = ?, next_run_at = ? WHERE id = ?
    `);
    stmt.run(Date.now(), nextRunAt, id);
  }

  /** Get all crons due to fire for a specific agent */
  getDueCrons(agentId: string): CronJob[] {
    const stmt = this.db.prepare(`
      SELECT * FROM crons
      WHERE agent_id = ? AND next_run_at <= ? AND paused = 0
      ORDER BY next_run_at ASC
    `);
    return stmt.all(agentId, Date.now()) as CronJob[];
  }

  close(): void {
    this.db.close();
  }
}
