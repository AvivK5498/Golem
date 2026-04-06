import { z } from "zod/v4";

export const TransportConfigSchema = z.object({
  platform: z.literal("telegram"),
  botToken: z.string().describe("Env var reference like ${AGENT2_TELEGRAM_TOKEN}"),
  ownerId: z.number().describe("Telegram user ID of the owner"),
});

export const MemoryConfigSchema = z.object({
  lastMessages: z.number().default(12),
  semanticRecall: z.boolean().default(false),
  observational: z
    .object({
      enabled: z.boolean().default(false),
      model: z.string().optional(),
      scope: z.enum(["resource", "thread"]).optional(),
    })
    .optional(),
  workingMemory: z
    .object({
      enabled: z.boolean().default(true),
      scope: z.enum(["resource", "thread"]).default("resource"),
    })
    .optional(),
});

export const LLMConfigSchema = z.object({
  provider: z.string().default("openrouter"),
  tier: z.enum(["low", "med", "high"]).default("low"),
  override: z.string().nullable().optional().default(null),
  temperature: z.number().min(0).max(2).default(0.2),
  maxSteps: z.number().min(1).max(100).default(30),
  reasoningEffort: z.enum(["xhigh", "high", "medium", "low", "minimal", "none"]).optional(),
  // Legacy — kept for backwards compatibility during migration
  model: z.string().optional(),
});

export const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(false),
  every: z.string().default("2h"),
  taskFile: z.string().optional(),
  activeHours: z
    .object({
      start: z.string().regex(/^\d{2}:\d{2}$/),
      end: z.string().regex(/^\d{2}:\d{2}$/),
    })
    .optional(),
});

export const AgentRegistryConfigSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "Agent ID must be lowercase alphanumeric with hyphens"),
  name: z.string().min(1),
  description: z.string().min(1),
  ownerName: z.string().default("the user"),
  role: z.string().default("personal assistant"),
  characterName: z.string().optional(),
  enabled: z.boolean().default(true),
  transport: TransportConfigSchema,
  llm: LLMConfigSchema,
  memory: MemoryConfigSchema.default({ lastMessages: 12, semanticRecall: false }),
  tools: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  mcpServers: z.array(z.string()).default([]),
  heartbeat: HeartbeatConfigSchema.optional(),
  allowedGroups: z.array(z.string()).default([]),
  adminGroups: z.array(z.string()).default([]),
  coding: z
    .object({
      enabled: z.boolean().default(false),
      defaultAgent: z.string().default("claude"),
      model: z.string().optional(),
    })
    .optional(),
});

export type AgentRegistryConfig = z.infer<typeof AgentRegistryConfigSchema>;
export type TransportConfig = z.infer<typeof TransportConfigSchema>;
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type HeartbeatConfig = z.infer<typeof HeartbeatConfigSchema>;
