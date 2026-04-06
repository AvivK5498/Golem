import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod/v4";
import { logger } from "./utils/external-logger.js";

const CONFIG_PATH = path.resolve("config.yaml");

/**
 * MCP server configuration schema
 */
const MCPServerConfigSchema = z.object({
  // Stdio transport
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  // HTTP transport
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const PhoenixObservabilitySchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().optional(),
  apiKey: z.string().optional(),
  projectName: z.string().optional(),
  serviceName: z.string().optional(),
  includeInternalSpans: z.boolean().default(false),
});

const ObservabilityConfigSchema = z.object({
  phoenix: PhoenixObservabilitySchema.optional(),
});

const CodingConfigSchema = z.object({
  enabled: z.boolean().default(false),
  defaultAgent: z.literal("claude").default("claude"),
  model: z.string().optional().describe("Claude Code model ID, e.g. 'claude-sonnet-4-6' or 'claude-opus-4-6'"),
  maxConcurrentSessions: z.number().default(3),
}).optional();

/**
 * Full configuration schema with Zod validation
 */
export const ConfigSchema = z.object({
  defaultAgent: z.string().optional(),
  llm: z.object({
    tiers: z.record(z.string(), z.string()).optional(),
  }).optional(),
  server: z.object({
    port: z.number(),
  }),
  mcp: z.object({
    servers: z.record(z.string(), MCPServerConfigSchema).optional(),
  }).optional(),
  observability: ObservabilityConfigSchema.optional(),
  skills: z.object({
    dirs: z.array(z.string()),
  }).optional(),
  whisper: z.object({
    enabled: z.boolean().default(false),
    apiKey: z.string().default(""),
    endpoint: z.string().default("https://api.groq.com/openai/v1/audio/transcriptions"),
    model: z.string().default("whisper-large-v3-turbo"),
    timeoutMs: z.number().int().min(5000).max(600000).default(30000),
  }).optional(),
  webhooks: z.object({
    enabled: z.boolean().default(false),
    token: z.string().optional(),
    maxAuthFailures: z.number().default(3),
    authWindowMs: z.number().default(300000),
    tunnel: z.object({
      domain: z.string().optional(),
    }).optional(),
  }).optional(),
  agent: z.object({
    framework: z.enum(["mastra"]),
    env: z.record(z.string(), z.string()).optional()
      .describe("Extra environment variables merged into run_command calls"),
  }).optional(),
  coding: CodingConfigSchema,
  tools: z.object({
    webSearchPerTurnLimit: z.number().default(30),
  }).optional(),
});

/**
 * Configuration for an MCP server.
 * Supports two transport types:
 * - Stdio: subprocess via command/args (e.g., npx @modelcontextprotocol/server-github)
 * - HTTP: remote server via url/headers (e.g., https://mcp.linear.app/mcp)
 */
export interface MCPServerConfig {
  // Stdio transport (subprocess)
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  // HTTP transport (remote server)
  url?: string;
  headers?: Record<string, string>;
}

export interface AppConfig {
  defaultAgent?: string;
  /** Global LLM config. Only tiers is typed; other fields are per-agent in SQLite. */
  llm?: {
    tiers?: Record<string, string>;
    [key: string]: unknown;
  };
  server: {
    port: number;
  };
  mcp?: {
    servers?: Record<string, MCPServerConfig>;
  };
  observability?: {
    phoenix?: {
      enabled?: boolean;
      endpoint?: string;
      apiKey?: string;
      projectName?: string;
      serviceName?: string;
      includeInternalSpans?: boolean;
    };
  };
  skills?: {
    dirs: string[];
  };
  whisper?: {
    enabled: boolean;
    apiKey: string;
    endpoint: string;
    model: string;
    timeoutMs?: number;
  };
  webhooks?: {
    enabled: boolean;
    token?: string;
    maxAuthFailures: number;
    authWindowMs: number;
    tunnel?: {
      domain?: string;
    };
  };
  agent?: {
    framework: "mastra";
    env?: Record<string, string>;
  };
  coding?: {
    enabled: boolean;
    defaultAgent: "claude";
    model?: string;
    maxConcurrentSessions: number;
  };
  tools?: {
    webSearchPerTurnLimit: number;
  };
}

const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 3847,
  },
  observability: {
    phoenix: {
      enabled: false,
      serviceName: "golem-agent",
      includeInternalSpans: false,
    },
  },
  whisper: {
    enabled: false,
    apiKey: "",
    endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
    model: "whisper-large-v3-turbo",
    timeoutMs: 30000,
  },
};

/** Check if config.yaml exists (first-run detection) */
function hasConfig(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

/** Load config.yaml + merge secrets from .env */
export function loadConfig(): AppConfig {
  if (!hasConfig()) {
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  const parsed = YAML.parse(raw) as Partial<AppConfig> | null;
  if (!parsed) return DEFAULT_CONFIG;
  const merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, parsed as unknown as Partial<Record<string, unknown>>) as unknown as AppConfig;

  // Validate merged config against Zod schema — fail fast on invalid config
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const issues = (result.error.issues as any[]).map((i) => `  ${(i.path || []).join(".")}: ${i.message}`).join("\n");
    logger.error("Config validation failed", { issues });
    throw new Error(`Invalid config.yaml:\n${issues}`);
  }

  return result.data as AppConfig;
}


/** Deep merge two objects. Arrays are replaced, not concatenated. */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const srcVal = (source as Record<string, unknown>)[key];
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result as T;
}

/**
 * Check if any keys from `updates` were dropped during schema validation.
 * Walks the update object and checks each leaf path exists in the validated output.
 */
function findDroppedKeys(
  updates: Record<string, unknown>,
  validated: Record<string, unknown>,
  prefix = "",
): string[] {
  const dropped: string[] = [];
  for (const key of Object.keys(updates)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    const updateVal = updates[key];
    const validatedVal = validated[key];

    if (validatedVal === undefined && updateVal !== undefined) {
      dropped.push(fullPath);
    } else if (
      updateVal !== null &&
      typeof updateVal === "object" &&
      !Array.isArray(updateVal) &&
      validatedVal !== null &&
      typeof validatedVal === "object" &&
      !Array.isArray(validatedVal)
    ) {
      dropped.push(
        ...findDroppedKeys(
          updateVal as Record<string, unknown>,
          validatedVal as Record<string, unknown>,
          fullPath,
        ),
      );
    }
  }
  return dropped;
}

/** Update specific sections of config.yaml with deep merge.
 *  Reads current config, deep-merges updates, writes back.
 *  Use this for surgical updates (e.g. adding/removing a single MCP server). */
export function updateConfigSection(updates: Partial<AppConfig>, dryRun = false): void {
  const current = loadConfig();
  const merged = deepMerge(current as unknown as Record<string, unknown>, updates as unknown as Record<string, unknown>);
  // mcp.servers is a map (dynamic keys) — replace entirely, don't merge.
  // This ensures server removal works (deepMerge can't delete keys).
  if (updates.mcp?.servers !== undefined) {
    (merged as Record<string, unknown>).mcp = { ...(merged as Record<string, unknown>).mcp as object, servers: updates.mcp.servers };
  }
  // Validate against schema before writing — reject invalid values,
  // strip unknown keys so the agent can't write arbitrary config paths.
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `  ${i.path.join(".")}: ${i.message}`,
    ).join("\n");
    logger.error("Config update validation failed", { issues });
    throw new Error(`Invalid config:\n${issues}`);
  }
  // Detect keys that would be silently stripped by schema validation.
  // Compare update keys against the validated output to catch unknown paths.
  const droppedKeys = findDroppedKeys(
    updates as unknown as Record<string, unknown>,
    result.data as unknown as Record<string, unknown>,
  );
  if (droppedKeys.length > 0) {
    throw new Error(
      `Unknown config path(s): ${droppedKeys.join(", ")}. These keys are not in the config schema.`,
    );
  }
  if (dryRun) return;
  // Write the validated result, not the raw merge — this drops unknown keys
  fs.writeFileSync(CONFIG_PATH, YAML.stringify(result.data), "utf-8");
}

/** Expand ${VAR_NAME} references in a string using process.env */
export function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => process.env[varName] || "");
}

// Legacy compat: export a flat config object for existing code
const appConfig = loadConfig();

export const config = {
  serverPort: appConfig.server.port,
} as const;
