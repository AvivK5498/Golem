import Database from "better-sqlite3";

export interface Client {
  id: number;
  jid: string;
  name: string;
  business_context: string | null;
  followup_days: number;
  last_interaction_at: number | null;
  status: string;  // 'active' | 'inactive' | 'lead'
  notes: string | null;
  created_at: number;
  platform: string | null; // 'telegram' | null
}

export class ClientStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jid TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        business_context TEXT,
        followup_days INTEGER DEFAULT 14,
        last_interaction_at INTEGER,
        status TEXT DEFAULT 'active',
        notes TEXT,
        created_at INTEGER DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_clients_jid ON clients(jid);
      CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
    `);

    // Migration: add platform column for multi-platform support
    try {
      this.db.exec(`ALTER TABLE clients ADD COLUMN platform TEXT DEFAULT 'telegram'`);
    } catch {
      // Column already exists — ignore
    }

    // Composite unique index for jid+platform
    try {
      this.db.exec(`CREATE UNIQUE INDEX idx_clients_jid_platform ON clients(jid, platform)`);
    } catch {
      // Index already exists — ignore
    }
  }

  addClient(jid: string, name: string, context?: string, followupDays?: number, platform = 'telegram'): Client {
    const stmt = this.db.prepare(`
      INSERT INTO clients (jid, name, business_context, followup_days, platform)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(jid, name, context ?? null, followupDays ?? 14, platform);

    return this.getClientByJid(jid, platform)!;
  }

  listClients(status?: string): Client[] {
    let query = 'SELECT * FROM clients';
    const params: string[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Client[];
  }

  updateClient(
    jid: string,
    fields: Partial<Pick<Client, 'name' | 'business_context' | 'followup_days' | 'status' | 'notes'>>
  ): Client | null {
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (fields.name !== undefined) {
      updates.push('name = ?');
      values.push(fields.name);
    }
    if (fields.business_context !== undefined) {
      updates.push('business_context = ?');
      values.push(fields.business_context);
    }
    if (fields.followup_days !== undefined) {
      updates.push('followup_days = ?');
      values.push(fields.followup_days);
    }
    if (fields.status !== undefined) {
      updates.push('status = ?');
      values.push(fields.status);
    }
    if (fields.notes !== undefined) {
      updates.push('notes = ?');
      values.push(fields.notes);
    }

    if (updates.length === 0) {
      return this.getClientByJid(jid);
    }

    values.push(jid);

    const stmt = this.db.prepare(`
      UPDATE clients
      SET ${updates.join(', ')}
      WHERE jid = ?
    `);

    stmt.run(...values);

    return this.getClientByJid(jid);
  }

  getOverdueFollowups(): Client[] {
    const now = Date.now();
    const stmt = this.db.prepare(`
      SELECT * FROM clients
      WHERE status = 'active'
        AND last_interaction_at IS NOT NULL
        AND (last_interaction_at + (followup_days * 86400000)) < ?
      ORDER BY last_interaction_at ASC
    `);

    return stmt.all(now) as Client[];
  }

  getClientByJid(jid: string, platform?: string): Client | null {
    if (platform) {
      const stmt = this.db.prepare('SELECT * FROM clients WHERE jid = ? AND platform = ?');
      const result = stmt.get(jid, platform);
      return result ? (result as Client) : null;
    }
    const stmt = this.db.prepare('SELECT * FROM clients WHERE jid = ?');
    const result = stmt.get(jid);
    return result ? (result as Client) : null;
  }

  updateLastInteraction(jid: string): void {
    const stmt = this.db.prepare(`
      UPDATE clients
      SET last_interaction_at = ?
      WHERE jid = ?
    `);

    stmt.run(Date.now(), jid);
  }

  isClient(jid: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM clients WHERE jid = ? LIMIT 1');
    return stmt.get(jid) !== undefined;
  }

  close(): void {
    this.db.close();
  }
}
