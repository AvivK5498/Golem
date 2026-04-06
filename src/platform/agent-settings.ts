/**
 * AgentSettings — typed facade over SettingsStore for per-agent runtime config.
 *
 * Keys are namespaced strings (e.g., "llm.model", "memory.lastMessages").
 * Arrays/objects are stored as JSON strings. Numbers are parsed on read.
 * Identity fields (id, name, transport) stay in YAML — this only covers behavior.
 */
import type { SettingsStore } from "../scheduler/settings-store.js";
import type { AgentRegistryConfig } from "./schemas.js";

// ── Behavior config type ───────────────────────────────────

export interface BehaviorConfig {
  responseLength: "brief" | "balanced" | "detailed";
  agency: "execute_first" | "ask_before_acting" | "consultative";
  tone: "casual" | "balanced" | "professional";
  format: "texting" | "conversational" | "structured";
  language: "english" | "hebrew" | "auto_detect";
  customInstructions: string;
}

const BEHAVIOR_DEFAULTS: BehaviorConfig = {
  responseLength: "balanced",
  agency: "execute_first",
  tone: "balanced",
  format: "conversational",
  language: "auto_detect",
  customInstructions: "",
};

// ── Key constants ───────────────────────────────────────────

export const SETTINGS_KEYS = {
  // LLM
  LLM_MODEL: "llm.model",
  LLM_TEMPERATURE: "llm.temperature",
  LLM_MAX_STEPS: "llm.maxSteps",
  LLM_REASONING_EFFORT: "llm.reasoningEffort",
  LLM_TIERS: "llm.tiers",
  LLM_NANO_MODEL: "llm.nano.model",
  MODEL_TIER: "model_tier",

  // Memory
  MEMORY_LAST_MESSAGES: "memory.lastMessages",
  MEMORY_SEMANTIC_RECALL: "memory.semanticRecall",
  MEMORY_OBSERVATIONAL_ENABLED: "memory.observational.enabled",
  MEMORY_OBSERVATIONAL_MODEL: "memory.observational.model",
  MEMORY_OBSERVATIONAL_SCOPE: "memory.observational.scope",
  MEMORY_WORKING_MEMORY_ENABLED: "memory.workingMemory.enabled",
  MEMORY_WORKING_MEMORY_SCOPE: "memory.workingMemory.scope",

  // Access control
  ALLOWED_GROUPS: "allowedGroups",
  ADMIN_GROUPS: "adminGroups",

  // Tools & skills
  TOOLS: "tools",
  SKILLS: "skills",
  MCP_SERVERS: "mcpServers",

  // Conversation flow
  CONV_FLOW_ENABLED: "conversationFlow.enabled",
  CONV_FLOW_TYPING: "conversationFlow.typingIndicator",
  CONV_FLOW_TOOL_STATUS: "conversationFlow.toolStatusMessages",
  CONV_FLOW_LONG_RUNNING: "conversationFlow.longRunningTools",

  // Whisper
  WHISPER_ENABLED: "whisper.enabled",
  WHISPER_MODEL: "whisper.model",
  WHISPER_TIMEOUT: "whisper.timeoutMs",

  // Proactive check-ins
  PROACTIVE_ENABLED: "proactive.enabled",
  PROACTIVE_MIN_INTERVAL: "proactive.minIntervalHours",
  PROACTIVE_MAX_INTERVAL: "proactive.maxIntervalHours",
  PROACTIVE_MIN_GAP: "proactive.minGapHours",
  PROACTIVE_PROBABILITY: "proactive.probability",
  PROACTIVE_ACTIVE_START: "proactive.activeHoursStart",
  PROACTIVE_ACTIVE_END: "proactive.activeHoursEnd",
  PROACTIVE_PROMPT: "proactive.prompt",

  // Behavior
  BEHAVIOR_RESPONSE_LENGTH: "behavior.responseLength",
  BEHAVIOR_AGENCY: "behavior.agency",
  BEHAVIOR_TONE: "behavior.tone",
  BEHAVIOR_FORMAT: "behavior.format",
  BEHAVIOR_LANGUAGE: "behavior.language",
  BEHAVIOR_CUSTOM_INSTRUCTIONS: "behavior.customInstructions",
} as const;

// ── Global settings (agent_id = "__global__") ──────────────

const GLOBAL_ID = "__global__";

export const GLOBAL_SETTINGS_KEYS = {
  DEFAULT_AGENT: "global.defaultAgent",
  LLM_TIERS: "global.llm.tiers",
  LLM_NANO_MODEL: "global.llm.nanoModel",
  OBSERVABILITY_ENABLED: "global.observability.enabled",
  OBSERVABILITY_ENDPOINT: "global.observability.endpoint",
  OBSERVABILITY_PROJECT: "global.observability.projectName",
  WEBHOOKS_ENABLED: "global.webhooks.enabled",
  WEBHOOKS_TOKEN: "global.webhooks.token",
  WEBHOOKS_TUNNEL_DOMAIN: "global.webhooks.tunnelDomain",
  WHISPER_ENABLED: "global.whisper.enabled",
  WHISPER_API_KEY: "global.whisper.apiKey",
  WHISPER_ENDPOINT: "global.whisper.endpoint",
  WHISPER_MODEL: "global.whisper.model",
  WHISPER_TIMEOUT: "global.whisper.timeoutMs",
  SERVER_PORT: "global.server.port",
  RUN_COMMAND_ALLOWED_BINARIES: "global.runCommand.allowedBinaries",
} as const;

// ── AgentSettings class ─────────────────────────────────────

export class AgentSettings {
  constructor(private store: SettingsStore) {}

  /** Access the underlying SettingsStore (for webhook scenarios, etc.) */
  getStore(): SettingsStore { return this.store; }

  // ── Global settings ────────────────────────────────────

  getGlobal(key: string): string | null {
    return this.store.get(GLOBAL_ID, key);
  }

  setGlobal(key: string, value: string): void {
    this.store.set(GLOBAL_ID, key, value);
  }

  setGlobalJson(key: string, value: unknown): void {
    this.store.setJson(GLOBAL_ID, key, value);
  }

  getGlobalJson<T>(key: string): T | null {
    return this.store.getJson<T>(GLOBAL_ID, key);
  }

  /** Returns all global settings as a flat key-value map. */
  getAllGlobal(): Record<string, string> {
    const all = this.store.getAll(GLOBAL_ID);
    const obj: Record<string, string> = {};
    for (const [k, v] of all) obj[k] = v;
    return obj;
  }

  /**
   * Seed global settings from config.yaml on first run.
   * Only writes keys that don't already exist (idempotent).
   */
  seedGlobalDefaults(config: {
    defaultAgent?: string;
    llm?: { tiers?: Record<string, string>; nano?: { model: string } };
    observability?: { phoenix?: { enabled?: boolean; endpoint?: string; projectName?: string } };
    webhooks?: { enabled?: boolean; token?: string; tunnel?: { domain?: string } };
    whisper?: { enabled?: boolean; apiKey?: string; endpoint?: string; model?: string; timeoutMs?: number };
    server?: { port?: number };
  }): void {
    const s = this.store;
    const G = GLOBAL_SETTINGS_KEYS;

    if (config.defaultAgent) s.setIfMissing(GLOBAL_ID, G.DEFAULT_AGENT, config.defaultAgent);
    if (config.llm?.tiers) s.setIfMissing(GLOBAL_ID, G.LLM_TIERS, JSON.stringify(config.llm.tiers));
    if (config.llm?.nano?.model) s.setIfMissing(GLOBAL_ID, G.LLM_NANO_MODEL, config.llm.nano.model);

    const phoenix = config.observability?.phoenix;
    if (phoenix) {
      s.setIfMissing(GLOBAL_ID, G.OBSERVABILITY_ENABLED, String(phoenix.enabled ?? false));
      if (phoenix.endpoint) s.setIfMissing(GLOBAL_ID, G.OBSERVABILITY_ENDPOINT, phoenix.endpoint);
      if (phoenix.projectName) s.setIfMissing(GLOBAL_ID, G.OBSERVABILITY_PROJECT, phoenix.projectName);
    }

    const wh = config.webhooks;
    if (wh) {
      s.setIfMissing(GLOBAL_ID, G.WEBHOOKS_ENABLED, String(wh.enabled ?? false));
      if (wh.token) s.setIfMissing(GLOBAL_ID, G.WEBHOOKS_TOKEN, wh.token);
      if (wh.tunnel?.domain) s.setIfMissing(GLOBAL_ID, G.WEBHOOKS_TUNNEL_DOMAIN, wh.tunnel.domain);
    }

    const w = config.whisper;
    if (w) {
      s.setIfMissing(GLOBAL_ID, G.WHISPER_ENABLED, String(w.enabled ?? false));
      if (w.apiKey) s.setIfMissing(GLOBAL_ID, G.WHISPER_API_KEY, w.apiKey);
      if (w.endpoint) s.setIfMissing(GLOBAL_ID, G.WHISPER_ENDPOINT, w.endpoint);
      if (w.model) s.setIfMissing(GLOBAL_ID, G.WHISPER_MODEL, w.model);
      if (w.timeoutMs) s.setIfMissing(GLOBAL_ID, G.WHISPER_TIMEOUT, String(w.timeoutMs));
    }

    if (config.server?.port) s.setIfMissing(GLOBAL_ID, G.SERVER_PORT, String(config.server.port));
  }

  // ── Global convenience getters ─────────────────────────

  getDefaultAgent(): string | null {
    return this.store.get(GLOBAL_ID, GLOBAL_SETTINGS_KEYS.DEFAULT_AGENT);
  }

  getGlobalTiers(): Record<string, string> | null {
    return this.store.getJson<Record<string, string>>(GLOBAL_ID, GLOBAL_SETTINGS_KEYS.LLM_TIERS);
  }

  getGlobalNanoModel(): string | null {
    return this.store.get(GLOBAL_ID, GLOBAL_SETTINGS_KEYS.LLM_NANO_MODEL);
  }

  getWebhookToken(): string | null {
    return this.store.get(GLOBAL_ID, GLOBAL_SETTINGS_KEYS.WEBHOOKS_TOKEN);
  }

  getWebhookTunnelDomain(): string | null {
    return this.store.get(GLOBAL_ID, GLOBAL_SETTINGS_KEYS.WEBHOOKS_TUNNEL_DOMAIN);
  }

  isWebhooksEnabled(): boolean {
    return this.store.get(GLOBAL_ID, GLOBAL_SETTINGS_KEYS.WEBHOOKS_ENABLED) === "true";
  }

  getAllowedBinaries(): string[] {
    return this.store.getJson<string[]>(GLOBAL_ID, GLOBAL_SETTINGS_KEYS.RUN_COMMAND_ALLOWED_BINARIES) ?? [];
  }

  // ── LLM ─────────────────────────────────────────────────

  getModel(agentId: string): string | null {
    return this.store.get(agentId, SETTINGS_KEYS.LLM_MODEL);
  }

  getTemperature(agentId: string): number | null {
    return this.getNumber(agentId, SETTINGS_KEYS.LLM_TEMPERATURE);
  }

  getMaxSteps(agentId: string): number | null {
    return this.getNumber(agentId, SETTINGS_KEYS.LLM_MAX_STEPS);
  }

  getReasoningEffort(agentId: string): string | null {
    return this.store.get(agentId, SETTINGS_KEYS.LLM_REASONING_EFFORT);
  }

  getTiers(agentId: string): Record<string, string> | null {
    return this.store.getJson<Record<string, string>>(agentId, SETTINGS_KEYS.LLM_TIERS);
  }

  getActiveTier(agentId: string): string | null {
    return this.store.get(agentId, SETTINGS_KEYS.MODEL_TIER);
  }

  // ── Memory ──────────────────────────────────────────────

  getLastMessages(agentId: string): number | null {
    return this.getNumber(agentId, SETTINGS_KEYS.MEMORY_LAST_MESSAGES);
  }

  getSemanticRecall(agentId: string): boolean | null {
    return this.getBool(agentId, SETTINGS_KEYS.MEMORY_SEMANTIC_RECALL);
  }

  getObservationalEnabled(agentId: string): boolean | null {
    return this.getBool(agentId, SETTINGS_KEYS.MEMORY_OBSERVATIONAL_ENABLED);
  }

  getObservationalModel(agentId: string): string | null {
    return this.store.get(agentId, SETTINGS_KEYS.MEMORY_OBSERVATIONAL_MODEL);
  }

  getObservationalScope(agentId: string): string | null {
    return this.store.get(agentId, SETTINGS_KEYS.MEMORY_OBSERVATIONAL_SCOPE);
  }

  getWorkingMemoryEnabled(agentId: string): boolean | null {
    return this.getBool(agentId, SETTINGS_KEYS.MEMORY_WORKING_MEMORY_ENABLED);
  }

  getWorkingMemoryScope(agentId: string): string | null {
    return this.store.get(agentId, SETTINGS_KEYS.MEMORY_WORKING_MEMORY_SCOPE);
  }

  // ── Access control ──────────────────────────────────────

  getAllowedGroups(agentId: string): string[] {
    return this.store.getJson<string[]>(agentId, SETTINGS_KEYS.ALLOWED_GROUPS) ?? [];
  }

  getAdminGroups(agentId: string): string[] {
    return this.store.getJson<string[]>(agentId, SETTINGS_KEYS.ADMIN_GROUPS) ?? [];
  }

  // ── Tools & skills ──────────────────────────────────────

  getTools(agentId: string): string[] {
    return this.store.getJson<string[]>(agentId, SETTINGS_KEYS.TOOLS) ?? [];
  }

  getSkills(agentId: string): string[] {
    return this.store.getJson<string[]>(agentId, SETTINGS_KEYS.SKILLS) ?? [];
  }

  getMcpServers(agentId: string): string[] {
    return this.store.getJson<string[]>(agentId, SETTINGS_KEYS.MCP_SERVERS) ?? [];
  }

  // ── Conversation flow ───────────────────────────────────

  getConversationFlowEnabled(agentId: string): boolean | null {
    return this.getBool(agentId, SETTINGS_KEYS.CONV_FLOW_ENABLED);
  }

  getTypingIndicator(agentId: string): boolean | null {
    return this.getBool(agentId, SETTINGS_KEYS.CONV_FLOW_TYPING);
  }

  getToolStatusMessages(agentId: string): boolean | null {
    return this.getBool(agentId, SETTINGS_KEYS.CONV_FLOW_TOOL_STATUS);
  }

  getLongRunningTools(agentId: string): string[] {
    return this.store.getJson<string[]>(agentId, SETTINGS_KEYS.CONV_FLOW_LONG_RUNNING) ?? [];
  }

  // ── Whisper ─────────────────────────────────────────────

  getWhisperEnabled(agentId: string): boolean | null {
    return this.getBool(agentId, SETTINGS_KEYS.WHISPER_ENABLED);
  }

  getWhisperModel(agentId: string): string | null {
    return this.store.get(agentId, SETTINGS_KEYS.WHISPER_MODEL);
  }

  getWhisperTimeout(agentId: string): number | null {
    return this.getNumber(agentId, SETTINGS_KEYS.WHISPER_TIMEOUT);
  }

  // ── Proactive check-ins ─────────────────────────────────

  getProactiveConfig(agentId: string): {
    enabled: boolean;
    minIntervalHours: number;
    maxIntervalHours: number;
    minGapHours: number;
    probability: number;
    activeHoursStart: string;
    activeHoursEnd: string;
    prompt: string | null;
  } {
    const rawMin = this.getNumber(agentId, SETTINGS_KEYS.PROACTIVE_MIN_INTERVAL);
    const rawMax = this.getNumber(agentId, SETTINGS_KEYS.PROACTIVE_MAX_INTERVAL);
    // Default to 2h/4h. If either is 0 or missing, use defaults. Ensure max >= min.
    const minInterval = (rawMin && rawMin > 0) ? rawMin : 2;
    const maxInterval = (rawMax && rawMax > 0) ? Math.max(rawMax, minInterval) : Math.max(4, minInterval);

    return {
      enabled: this.getBool(agentId, SETTINGS_KEYS.PROACTIVE_ENABLED) ?? false,
      minIntervalHours: minInterval,
      maxIntervalHours: maxInterval,
      minGapHours: this.getNumber(agentId, SETTINGS_KEYS.PROACTIVE_MIN_GAP) ?? 4,
      probability: this.getNumber(agentId, SETTINGS_KEYS.PROACTIVE_PROBABILITY) ?? 0.4,
      activeHoursStart: this.store.get(agentId, SETTINGS_KEYS.PROACTIVE_ACTIVE_START) ?? "08:00",
      activeHoursEnd: this.store.get(agentId, SETTINGS_KEYS.PROACTIVE_ACTIVE_END) ?? "21:00",
      prompt: this.store.get(agentId, SETTINGS_KEYS.PROACTIVE_PROMPT),
    };
  }

  // ── Behavior ─────────────���──────────────────────────────

  getBehavior(agentId: string): BehaviorConfig {
    const K = SETTINGS_KEYS;
    return {
      responseLength: (this.store.get(agentId, K.BEHAVIOR_RESPONSE_LENGTH) as BehaviorConfig["responseLength"]) || BEHAVIOR_DEFAULTS.responseLength,
      agency: (this.store.get(agentId, K.BEHAVIOR_AGENCY) as BehaviorConfig["agency"]) || BEHAVIOR_DEFAULTS.agency,
      tone: (this.store.get(agentId, K.BEHAVIOR_TONE) as BehaviorConfig["tone"]) || BEHAVIOR_DEFAULTS.tone,
      format: (this.store.get(agentId, K.BEHAVIOR_FORMAT) as BehaviorConfig["format"]) || BEHAVIOR_DEFAULTS.format,
      language: (this.store.get(agentId, K.BEHAVIOR_LANGUAGE) as BehaviorConfig["language"]) || BEHAVIOR_DEFAULTS.language,
      customInstructions: this.store.get(agentId, K.BEHAVIOR_CUSTOM_INSTRUCTIONS) || BEHAVIOR_DEFAULTS.customInstructions,
    };
  }

  // ── Generic setter ──────────────────────────────────────

  /** Set any setting by key. Accepts strings, numbers, booleans, arrays, objects. */
  setSetting(agentId: string, key: string, value: unknown): void {
    if (typeof value === "string") {
      this.store.set(agentId, key, value);
    } else {
      this.store.setJson(agentId, key, value);
    }
  }

  /** Get all settings for an agent as a flat key-value map. */
  getAll(agentId: string): Map<string, string> {
    return this.store.getAll(agentId);
  }

  // ── Seeding from YAML config ────────────────────────────

  /**
   * Seed SQLite settings from a per-agent YAML config.
   * Only writes keys that don't already exist (idempotent first-run seed).
   * Call once per agent at platform startup.
   */
  seedFromConfig(config: AgentRegistryConfig): void {
    const id = config.id;
    const s = this.store;

    // LLM — tier-based model selection
    s.setIfMissing(id, SETTINGS_KEYS.MODEL_TIER, config.llm.tier || "low");
    if (config.llm.override) {
      s.setIfMissing(id, SETTINGS_KEYS.LLM_MODEL, config.llm.override);
    } else if (config.llm.model) {
      // Legacy: seed model field for backwards compat
      s.setIfMissing(id, SETTINGS_KEYS.LLM_MODEL, config.llm.model);
    }
    s.setIfMissing(id, SETTINGS_KEYS.LLM_TEMPERATURE, String(config.llm.temperature));
    s.setIfMissing(id, SETTINGS_KEYS.LLM_MAX_STEPS, String(config.llm.maxSteps));
    if (config.llm.reasoningEffort) {
      s.setIfMissing(id, SETTINGS_KEYS.LLM_REASONING_EFFORT, config.llm.reasoningEffort);
    }
    // Memory
    s.setIfMissing(id, SETTINGS_KEYS.MEMORY_LAST_MESSAGES, String(config.memory.lastMessages));
    s.setIfMissing(id, SETTINGS_KEYS.MEMORY_SEMANTIC_RECALL, String(config.memory.semanticRecall));
    if (config.memory.observational) {
      s.setIfMissing(id, SETTINGS_KEYS.MEMORY_OBSERVATIONAL_ENABLED, String(config.memory.observational.enabled));
      if (config.memory.observational.model) {
        s.setIfMissing(id, SETTINGS_KEYS.MEMORY_OBSERVATIONAL_MODEL, config.memory.observational.model);
      }
      if (config.memory.observational.scope) {
        s.setIfMissing(id, SETTINGS_KEYS.MEMORY_OBSERVATIONAL_SCOPE, config.memory.observational.scope);
      }
    }
    if (config.memory.workingMemory) {
      s.setIfMissing(id, SETTINGS_KEYS.MEMORY_WORKING_MEMORY_ENABLED, String(config.memory.workingMemory.enabled));
      s.setIfMissing(id, SETTINGS_KEYS.MEMORY_WORKING_MEMORY_SCOPE, config.memory.workingMemory.scope);
    }

    // Access control
    if (config.allowedGroups.length > 0) {
      s.setIfMissing(id, SETTINGS_KEYS.ALLOWED_GROUPS, JSON.stringify(config.allowedGroups));
    }
    if (config.adminGroups.length > 0) {
      s.setIfMissing(id, SETTINGS_KEYS.ADMIN_GROUPS, JSON.stringify(config.adminGroups));
    }

    // Tools & skills
    if (config.tools.length > 0) {
      s.setIfMissing(id, SETTINGS_KEYS.TOOLS, JSON.stringify(config.tools));
    }
    if (config.skills.length > 0) {
      s.setIfMissing(id, SETTINGS_KEYS.SKILLS, JSON.stringify(config.skills));
    }
    if (config.mcpServers.length > 0) {
      s.setIfMissing(id, SETTINGS_KEYS.MCP_SERVERS, JSON.stringify(config.mcpServers));
    }

    // Behavior defaults
    s.setIfMissing(id, SETTINGS_KEYS.BEHAVIOR_RESPONSE_LENGTH, BEHAVIOR_DEFAULTS.responseLength);
    s.setIfMissing(id, SETTINGS_KEYS.BEHAVIOR_AGENCY, BEHAVIOR_DEFAULTS.agency);
    s.setIfMissing(id, SETTINGS_KEYS.BEHAVIOR_TONE, BEHAVIOR_DEFAULTS.tone);
    s.setIfMissing(id, SETTINGS_KEYS.BEHAVIOR_FORMAT, BEHAVIOR_DEFAULTS.format);
    s.setIfMissing(id, SETTINGS_KEYS.BEHAVIOR_LANGUAGE, BEHAVIOR_DEFAULTS.language);
  }

  // ── Internal helpers ────────────────────────────────────

  private getNumber(agentId: string, key: string): number | null {
    const raw = this.store.get(agentId, key);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  private getBool(agentId: string, key: string): boolean | null {
    const raw = this.store.get(agentId, key);
    if (raw === null) return null;
    return raw === "true";
  }
}
