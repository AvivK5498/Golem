/**
 * AgentStore — SQLite-backed storage for agent definitions.
 * Replaces the filesystem-based agents/{id}/config.yaml approach.
 *
 * Each agent's full configuration (identity, transport, LLM, memory,
 * tools, skills, persona, sub-agents) is stored in a single table.
 * Complex fields (tools, skills, memory config, sub-agents) are stored as JSON.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { AgentRegistryConfigSchema, type AgentRegistryConfig } from "./schemas.js";
import { logger } from "../utils/external-logger.js";

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDatabaseClass(): any {
  if (typeof Bun !== "undefined") {
    return require("bun:sqlite").Database;
  }
  return require("better-sqlite3");
}

export interface AgentRecord {
  id: string;
  config_json: string;   // Full AgentRegistryConfig as JSON
  persona: string | null;
  memory_template: string | null;
  sub_agents_json: string | null; // { agents: {}, defaults: {} } as JSON
  created_at: number;
  updated_at: number;
}

export class AgentStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any;

  constructor(dbPath: string) {
    const Database = getDatabaseClass();
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.initSchema();
  }

  private initSchema(): void {
    // DDL must succeed — let it throw if the database is broken
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        persona TEXT,
        memory_template TEXT,
        sub_agents_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Migration: ensure all agents have tier/override in their LLM config
    try {
      const rows = this.db.prepare("SELECT id, config_json FROM agents").all() as { id: string; config_json: string }[];
      for (const row of rows) {
        const config = JSON.parse(row.config_json);
        if (config.llm && !config.llm.tier) {
          config.llm.tier = "low";
          config.llm.override = config.llm.override ?? null;
          const parseResult = AgentRegistryConfigSchema.safeParse(config);
          if (parseResult.success) {
            this.db.prepare("UPDATE agents SET config_json = ? WHERE id = ?").run(JSON.stringify(parseResult.data), row.id);
          }
        }
      }
    } catch { /* migration is best-effort */ }
  }

  // ── CRUD ────────────────────────────────────────────────

  /** Insert or update an agent definition. */
  upsert(id: string, config: AgentRegistryConfig, extras?: {
    persona?: string | null;
    memoryTemplate?: string | null;
    subAgents?: Record<string, unknown> | null;
  }): void {
    const now = Date.now();
    const existing = this.get(id);
    if (existing) {
      this.db.prepare(`
        UPDATE agents SET config_json = ?, persona = ?, memory_template = ?, sub_agents_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(config),
        extras?.persona ?? existing.persona,
        extras?.memoryTemplate ?? existing.memory_template,
        extras?.subAgents ? JSON.stringify(extras.subAgents) : existing.sub_agents_json,
        now,
        id,
      );
    } else {
      this.db.prepare(`
        INSERT INTO agents (id, config_json, persona, memory_template, sub_agents_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        JSON.stringify(config),
        extras?.persona ?? null,
        extras?.memoryTemplate ?? null,
        extras?.subAgents ? JSON.stringify(extras.subAgents) : null,
        now,
        now,
      );
    }
  }

  /** Get a raw agent record by ID. */
  get(id: string): AgentRecord | null {
    return this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as AgentRecord | null;
  }

  /** Get parsed agent config by ID. Returns null if not found. */
  getConfig(id: string): AgentRegistryConfig | null {
    const row = this.get(id);
    if (!row) return null;
    try {
      return AgentRegistryConfigSchema.parse(JSON.parse(row.config_json));
    } catch (err) {
      console.error(`[agent-store] failed to parse config for "${id}":`, err);
      return null;
    }
  }

  /** Get all agent configs (including disabled). */
  getAll(): AgentRecord[] {
    return this.db.prepare("SELECT * FROM agents ORDER BY created_at ASC").all() as AgentRecord[];
  }

  /** Get all enabled agent configs, parsed. */
  getAllEnabled(): AgentRegistryConfig[] {
    const rows = this.getAll();
    const configs: AgentRegistryConfig[] = [];
    for (const row of rows) {
      try {
        const config = AgentRegistryConfigSchema.parse(JSON.parse(row.config_json));
        if (config.enabled) {
          configs.push(config);
        }
      } catch (err) {
        console.error(`[agent-store] skipping agent "${row.id}": ${err}`);
      }
    }
    return configs;
  }

  /** Get persona text for an agent. */
  getPersona(id: string): string | null {
    const row = this.get(id);
    return row?.persona ?? null;
  }

  /** Get memory template for an agent. */
  getMemoryTemplate(id: string): string | null {
    const row = this.get(id);
    return row?.memory_template ?? null;
  }

  /** Get sub-agents definition for an agent. */
  getSubAgents(id: string): Record<string, unknown> | null {
    const row = this.get(id);
    if (!row?.sub_agents_json) return null;
    try {
      return JSON.parse(row.sub_agents_json);
    } catch { return null; }
  }

  /**
   * Update the config JSON for an agent, merging provided fields with the
   * existing config. This is a shallow merge for top-level keys plus a
   * shallow merge for `transport`, `llm`, and `memory` nested objects —
   * partial updates don't wipe out fields that weren't included.
   */
  updateConfig(id: string, partial: Partial<AgentRegistryConfig>): void {
    const existing = this.getConfig(id);
    if (!existing) {
      // No existing config — write partial as-is (this path only fires if the
      // caller creates an agent via updateConfig, which is unusual)
      this.db.prepare("UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(partial), Date.now(), id);
      return;
    }
    const merged: AgentRegistryConfig = {
      ...existing,
      ...partial,
      transport: { ...existing.transport, ...(partial.transport || {}) },
      llm: { ...existing.llm, ...(partial.llm || {}) },
      memory: {
        ...existing.memory,
        ...(partial.memory || {}),
        workingMemory: {
          ...(existing.memory?.workingMemory || {}),
          ...((partial.memory?.workingMemory) || {}),
        },
      },
    } as AgentRegistryConfig;
    this.db.prepare("UPDATE agents SET config_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(merged), Date.now(), id);
  }

  /** Update persona text. */
  updatePersona(id: string, persona: string): void {
    this.db.prepare("UPDATE agents SET persona = ?, updated_at = ? WHERE id = ?")
      .run(persona, Date.now(), id);
  }

  /** Update memory template. */
  updateMemoryTemplate(id: string, template: string): void {
    this.db.prepare("UPDATE agents SET memory_template = ?, updated_at = ? WHERE id = ?")
      .run(template, Date.now(), id);
  }

  /** Update sub-agents JSON. */
  updateSubAgents(id: string, subAgents: Record<string, unknown>): void {
    this.db.prepare("UPDATE agents SET sub_agents_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(subAgents), Date.now(), id);
  }

  /** Delete an agent. */
  delete(id: string): boolean {
    const result = this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    return result.changes > 0;
  }

  /** Check if an agent exists. */
  exists(id: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM agents WHERE id = ?").get(id);
    return !!row;
  }

  /** Count agents. */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM agents").get() as { count: number };
    return row.count;
  }

  // ── Migration from filesystem ──────────────────────────

  /**
   * Migrate agents from the filesystem (agents/{id}/config.yaml) to this SQLite store.
   * Only migrates agents that don't already exist in the store.
   * Call this once at startup for backwards compatibility.
   */
  migrateFromFilesystem(agentsDir: string = "agents"): number {
    const resolvedDir = path.resolve(agentsDir);
    if (!fs.existsSync(resolvedDir)) return 0;

    let migrated = 0;
    const dirs = fs.readdirSync(resolvedDir, { withFileTypes: true }).filter(d => d.isDirectory());

    for (const dir of dirs) {
      const configPath = path.join(resolvedDir, dir.name, "config.yaml");
      if (!fs.existsSync(configPath)) continue;

      try {
        const raw = fs.readFileSync(configPath, "utf-8");
        const parsed = YAML.parse(raw);
        const config = AgentRegistryConfigSchema.parse(parsed);

        // Skip if already in SQLite
        if (this.exists(config.id)) continue;

        // Read optional files
        const personaPath = path.join(resolvedDir, dir.name, "persona.md");
        const memoryPath = path.join(resolvedDir, dir.name, "memory-template.md");
        const subAgentsPath = path.join(resolvedDir, dir.name, "sub-agents.yaml");

        const persona = fs.existsSync(personaPath) ? fs.readFileSync(personaPath, "utf-8") : null;
        const memoryTemplate = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, "utf-8") : null;
        let subAgents: Record<string, unknown> | null = null;
        if (fs.existsSync(subAgentsPath)) {
          try {
            subAgents = YAML.parse(fs.readFileSync(subAgentsPath, "utf-8"));
          } catch { /* skip invalid sub-agents */ }
        }

        this.upsert(config.id, config, { persona, memoryTemplate, subAgents });
        migrated++;
        console.log(`[agent-store] migrated agent "${config.id}" from filesystem`);
        logger.info(`migrated agent "${config.id}" from filesystem to SQLite`, { agent: config.id });
      } catch (err) {
        console.error(`[agent-store] failed to migrate "${dir.name}":`, err);
      }
    }

    if (migrated > 0) {
      console.log(`[agent-store] migrated ${migrated} agents from filesystem to SQLite`);
    }
    return migrated;
  }
}
