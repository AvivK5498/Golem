import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { requestToolApproval } from "../tool-approvals.js";
import type { AgentSettings } from "../../platform/agent-settings.js";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export const BLOCKED_CONFIG_PATHS = [
  "observability.phoenix.apiKey",
  "webhooks.token",
  "global.webhooks.token",
];

export function isBlockedConfigPath(dotPath: string): boolean {
  return BLOCKED_CONFIG_PATHS.some(
    (blocked) => dotPath === blocked || dotPath.startsWith(blocked + "."),
  );
}

export function getConfigValueByPath(config: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function buildNestedUpdate(dotPath: string, value: unknown): Record<string, unknown> {
  const parts = dotPath.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = result;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return result;
}

export function redactConfig(config: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(config)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (isBlockedConfigPath(fullPath)) {
      result[key] = "[REDACTED]";
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      result[key] = redactConfig(val as Record<string, unknown>, fullPath);
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helper: convert flat settings map to nested object for display
// ---------------------------------------------------------------------------

function settingsMapToNested(settings: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    // Try to parse JSON values back to their original types
    let parsed: unknown = value;
    try { parsed = JSON.parse(value); } catch { /* keep as string */ }

    const parts = key.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current: any = result;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== "object") {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = parsed;
  }
  return result;
}

// ---------------------------------------------------------------------------
// config_update tool — reads/writes SQLite global settings
// ---------------------------------------------------------------------------

export const configUpdateTool = createTool({
  id: "config_update",
  description:
    "Read or update platform global settings using a 3-step workflow: " +
    "1) 'read' — view current settings (optionally a specific key via dot-notation). " +
    "2) 'propose' — show the current value and proposed new value without applying. " +
    "3) 'apply' — persist the change to SQLite settings (requires owner approval). " +
    "Sensitive paths (tokens, auth) are blocked. " +
    "Use 'read' first to understand the current state before proposing changes.",
  inputSchema: z.object({
    action: z.enum(["read", "propose", "apply"]),
    key: z.string().optional().describe(
      "Dot-notation settings key (e.g., 'global.server.port', 'global.whisper.enabled'). " +
      "Global settings use the 'global.' prefix.",
    ),
    value: z.unknown().optional().describe(
      "New value for propose/apply actions",
    ),
  }),
  inputExamples: [
    { input: { action: "read" } },
    { input: { action: "read", key: "global.server.port" } },
    { input: { action: "propose", key: "global.whisper.enabled", value: false } },
    { input: { action: "apply", key: "global.whisper.enabled", value: false } },
  ],
  execute: async (input, context) => {
    const agentSettings = context?.requestContext?.get("agentSettings" as never) as unknown as AgentSettings | undefined;
    if (!agentSettings) {
      return "Error: AgentSettings not available in tool context. Cannot read/write platform settings.";
    }

    if (input.action === "apply") {
      const approvalResult = await requestToolApproval({
        requestContext: context?.requestContext,
        toolName: "config_update",
        input,
        summary: `Apply settings change:\n\`${input.key}\` -> \`${JSON.stringify(input.value)}\``,
      });
      if (approvalResult) {
        return approvalResult;
      }
    }

    switch (input.action) {
      case "read": {
        if (input.key) {
          if (isBlockedConfigPath(input.key)) {
            return `Settings key "${input.key}" is restricted and cannot be read.`;
          }
          const value = agentSettings.getGlobal(input.key);
          if (value === null) return `Settings key "${input.key}" not found.`;
          // Try to parse JSON for display
          try {
            const parsed = JSON.parse(value);
            return `${input.key} = ${JSON.stringify(parsed, null, 2)}`;
          } catch {
            return `${input.key} = ${JSON.stringify(value)}`;
          }
        }
        // Return all global settings as nested object
        const allGlobal = agentSettings.getAllGlobal();
        const nested = settingsMapToNested(allGlobal);
        const redacted = redactConfig(nested);
        return JSON.stringify(redacted, null, 2);
      }

      case "propose": {
        if (!input.key) return "key is required for propose action.";
        if (input.value === undefined) return "value is required for propose action.";
        if (isBlockedConfigPath(input.key)) {
          return `Settings key "${input.key}" is restricted and cannot be modified.`;
        }
        const currentValue = agentSettings.getGlobal(input.key);
        const displayCurrent = currentValue !== null ? currentValue : "(not set)";
        return `Proposed change:\n  ${input.key}: ${displayCurrent} → ${JSON.stringify(input.value)}\n\nThis has NOT been applied. Ask the owner to confirm, then use action "apply".`;
      }

      case "apply": {
        if (!input.key) return "key is required for apply action.";
        if (input.value === undefined) return "value is required for apply action.";
        if (isBlockedConfigPath(input.key)) {
          return `Settings key "${input.key}" is restricted and cannot be modified.`;
        }
        const currentValue = agentSettings.getGlobal(input.key);
        const displayCurrent = currentValue !== null ? currentValue : "(not set)";
        try {
          const valueStr = typeof input.value === "string"
            ? input.value
            : JSON.stringify(input.value);
          agentSettings.setGlobal(input.key, valueStr);
          return `Settings updated:\n  ${input.key}: ${displayCurrent} → ${JSON.stringify(input.value)}\n\nChange applied and saved to SQLite settings.`;
        } catch (err) {
          return `Failed to update settings: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      default:
        return `Unknown action: ${input.action}`;
    }
  },
});
