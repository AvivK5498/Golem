/**
 * AgentSettings — typed facade over SettingsStore for per-agent runtime config.
 *
 * Keys are namespaced strings (e.g., "llm.model", "memory.lastMessages").
 * Arrays/objects are stored as JSON strings. Numbers are parsed on read.
 * Identity fields (id, name, transport) stay in YAML — this only covers behavior.
 */
import type { SettingsStore } from "../scheduler/settings-store.js";

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

  // seedGlobalDefaults removed — global settings are written directly by POST /api/setup and PATCH /api/settings

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

  // ── Write runtime settings for a new agent ─────────────

  /**
   * Write all runtime settings for a newly created agent.
   * Uses set() not setIfMissing() — these are explicit user choices.
   */
  writeRuntimeDefaults(agentId: string, opts: {
    tier?: string;
    override?: string | null;
    temperature?: number;
    maxSteps?: number;
    reasoningEffort?: string;
    lastMessages?: number;
    semanticRecall?: boolean;
    workingMemory?: { enabled: boolean; scope: string };
    observational?: { enabled: boolean; model?: string; scope?: string };
    tools?: string[];
    skills?: string[];
    mcpServers?: string[];
    allowedGroups?: string[];
    adminGroups?: string[];
  }): void {
    const s = this.store;

    // LLM
    s.set(agentId, SETTINGS_KEYS.MODEL_TIER, opts.tier || "low");
    if (opts.override) {
      s.set(agentId, SETTINGS_KEYS.LLM_MODEL, opts.override);
    } else {
      // Clear any stale override so tier resolution takes precedence
      s.delete(agentId, SETTINGS_KEYS.LLM_MODEL);
    }
    s.set(agentId, SETTINGS_KEYS.LLM_TEMPERATURE, String(opts.temperature ?? 0.2));
    s.set(agentId, SETTINGS_KEYS.LLM_MAX_STEPS, String(opts.maxSteps ?? 30));
    if (opts.reasoningEffort) s.set(agentId, SETTINGS_KEYS.LLM_REASONING_EFFORT, opts.reasoningEffort);

    // Memory
    s.set(agentId, SETTINGS_KEYS.MEMORY_LAST_MESSAGES, String(opts.lastMessages ?? 12));
    s.set(agentId, SETTINGS_KEYS.MEMORY_SEMANTIC_RECALL, String(opts.semanticRecall ?? false));
    if (opts.workingMemory) {
      s.set(agentId, SETTINGS_KEYS.MEMORY_WORKING_MEMORY_ENABLED, String(opts.workingMemory.enabled));
      s.set(agentId, SETTINGS_KEYS.MEMORY_WORKING_MEMORY_SCOPE, opts.workingMemory.scope);
    }
    if (opts.observational) {
      s.set(agentId, SETTINGS_KEYS.MEMORY_OBSERVATIONAL_ENABLED, String(opts.observational.enabled));
      if (opts.observational.model) s.set(agentId, SETTINGS_KEYS.MEMORY_OBSERVATIONAL_MODEL, opts.observational.model);
      if (opts.observational.scope) s.set(agentId, SETTINGS_KEYS.MEMORY_OBSERVATIONAL_SCOPE, opts.observational.scope);
    }

    // Access control
    s.setJson(agentId, SETTINGS_KEYS.ALLOWED_GROUPS, opts.allowedGroups ?? []);
    s.setJson(agentId, SETTINGS_KEYS.ADMIN_GROUPS, opts.adminGroups ?? []);

    // Tools & skills
    s.setJson(agentId, SETTINGS_KEYS.TOOLS, opts.tools ?? []);
    s.setJson(agentId, SETTINGS_KEYS.SKILLS, opts.skills ?? []);
    s.setJson(agentId, SETTINGS_KEYS.MCP_SERVERS, opts.mcpServers ?? []);

    // Behavior defaults
    s.set(agentId, SETTINGS_KEYS.BEHAVIOR_RESPONSE_LENGTH, BEHAVIOR_DEFAULTS.responseLength);
    s.set(agentId, SETTINGS_KEYS.BEHAVIOR_AGENCY, BEHAVIOR_DEFAULTS.agency);
    s.set(agentId, SETTINGS_KEYS.BEHAVIOR_TONE, BEHAVIOR_DEFAULTS.tone);
    s.set(agentId, SETTINGS_KEYS.BEHAVIOR_FORMAT, BEHAVIOR_DEFAULTS.format);
    s.set(agentId, SETTINGS_KEYS.BEHAVIOR_LANGUAGE, BEHAVIOR_DEFAULTS.language);
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
