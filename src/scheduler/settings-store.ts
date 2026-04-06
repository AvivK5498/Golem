import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cross-runtime DB compat (better-sqlite3 / bun:sqlite)
function getDatabaseClass(): any {
  if (typeof Bun !== "undefined") {
    return require("bun:sqlite").Database;
  }
  return require("better-sqlite3");
}

/**
 * Simple persistent key-value store per agent.
 * Used for runtime settings like active model tier.
 */
export class SettingsStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  constructor(dbPath: string) {
    const Database = getDatabaseClass();
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        agent_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent_id, key)
      )
    `);
  }

  get(agentId: string, key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE agent_id = ? AND key = ?").get(agentId, key);
    return row ? (row as { value: string }).value : null;
  }

  set(agentId: string, key: string, value: string): void {
    this.db.prepare(
      "INSERT INTO settings (agent_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (agent_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).run(agentId, key, value, Date.now());
  }

  delete(agentId: string, key: string): void {
    this.db.prepare("DELETE FROM settings WHERE agent_id = ? AND key = ?").run(agentId, key);
  }

  /** Get all settings for an agent as a key-value map. */
  getAll(agentId: string): Map<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM settings WHERE agent_id = ?").all(agentId) as Array<{ key: string; value: string }>;
    return new Map(rows.map(r => [r.key, r.value]));
  }

  /** Set multiple keys at once (single transaction). */
  setMany(agentId: string, entries: Record<string, string>): void {
    const stmt = this.db.prepare(
      "INSERT INTO settings (agent_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (agent_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    );
    const now = Date.now();
    const tx = this.db.transaction(() => {
      for (const [key, value] of Object.entries(entries)) {
        stmt.run(agentId, key, value, now);
      }
    });
    tx();
  }

  /** Set a key only if it doesn't already exist (for seeding defaults). */
  setIfMissing(agentId: string, key: string, value: string): void {
    this.db.prepare(
      "INSERT OR IGNORE INTO settings (agent_id, key, value, updated_at) VALUES (?, ?, ?, ?)",
    ).run(agentId, key, value, Date.now());
  }

  /** Get a JSON-parsed value, or null if not set. */
  getJson<T>(agentId: string, key: string): T | null {
    const raw = this.get(agentId, key);
    if (raw === null) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  }

  /** Set a value as JSON string. */
  setJson(agentId: string, key: string, value: unknown): void {
    this.set(agentId, key, JSON.stringify(value));
  }
}
