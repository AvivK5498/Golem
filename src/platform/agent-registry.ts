import { type AgentRegistryConfig } from "./schemas.js";
import { type AgentStore } from "./agent-store.js";

/**
 * AgentRegistry — in-memory cache of agent configs loaded from AgentStore (SQLite).
 * Replaces the old filesystem-based approach.
 */
export class AgentRegistry {
  private configs: Map<string, AgentRegistryConfig> = new Map();
  private instances: Map<string, unknown> = new Map();

  constructor(private store: AgentStore) {}

  /** Load all enabled agents from the store into memory. */
  loadAll(migrateDir: string = "agents"): void {
    // First, migrate any filesystem agents that aren't in SQLite yet
    this.store.migrateFromFilesystem(migrateDir);

    const configs = this.store.getAllEnabled();
    for (const config of configs) {
      this.configs.set(config.id, config);
      console.log(`[registry] loaded agent "${config.id}"`);
    }
    console.log(`[registry] ${this.configs.size} agents loaded`);
  }

  getAll(): AgentRegistryConfig[] {
    return [...this.configs.values()];
  }

  get(id: string): AgentRegistryConfig | undefined {
    return this.configs.get(id);
  }

  getPersona(id: string): string | null {
    return this.store.getPersona(id);
  }

  getMemoryTemplate(id: string): string | null {
    return this.store.getMemoryTemplate(id);
  }

  getSubAgents(id: string): Record<string, unknown> | null {
    return this.store.getSubAgents(id);
  }

  /** Register a new agent (or update existing) — persists to SQLite AND updates in-memory cache. */
  register(id: string, config: AgentRegistryConfig, extras?: {
    persona?: string | null;
    memoryTemplate?: string | null;
    subAgents?: Record<string, unknown> | null;
  }): void {
    this.store.upsert(id, config, extras);
    this.configs.set(id, config);
    console.log(`[registry] registered agent "${id}"`);
  }

  /** Unregister an agent — removes from SQLite AND in-memory cache. */
  unregister(id: string): void {
    this.store.delete(id);
    this.configs.delete(id);
    this.instances.delete(id);
    console.log(`[registry] unregistered agent "${id}"`);
  }

  /** Get the underlying store for direct access. */
  getStore(): AgentStore {
    return this.store;
  }

  registerInstance(id: string, agent: unknown): void {
    this.instances.set(id, agent);
  }

  getInstance(id: string): unknown {
    return this.instances.get(id);
  }
}
