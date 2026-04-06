import { createTool } from "@mastra/core/tools";
import { z } from "zod/v4";
import type { SettingsStore } from "../../scheduler/settings-store.js";

export const MODEL_TIER_SETTING_KEY = "model_tier";

export const switchModelTool = createTool({
  id: "switch_model",
  description:
    "Switch the LLM model tier for this agent. Available tiers are configured per-agent (typically: low, med, high). " +
    "The change is persistent and takes effect on the next message.",
  inputSchema: z.object({
    tier: z.string().describe('The tier name to switch to (e.g., "low", "med", "high"). Use "default" to reset to the configured default.'),
  }),
  execute: async (input, context) => {
    const settingsStore = context?.requestContext?.get("settingsStore" as never) as unknown as SettingsStore | undefined;
    if (!settingsStore) return "Error: settings store not available.";

    const agentId = context?.requestContext?.get("agentId" as never) as unknown as string;
    if (!agentId) return "Error: agent identity not available.";

    const tiers = context?.requestContext?.get("modelTiers" as never) as unknown as Record<string, string> | undefined;

    // Reset to default
    if (input.tier === "default") {
      settingsStore.delete(agentId, MODEL_TIER_SETTING_KEY);
      const defaultModel = context?.requestContext?.get("defaultModel" as never) as unknown as string || "config default";
      return `Model reset to default (${defaultModel}). Active from the next message.`;
    }

    // Validate tier exists
    if (!tiers || !tiers[input.tier]) {
      const available = tiers ? Object.keys(tiers).join(", ") : "none configured";
      return `Unknown tier "${input.tier}". Available tiers: ${available}. Use "default" to reset.`;
    }

    const modelId = tiers[input.tier];
    settingsStore.set(agentId, MODEL_TIER_SETTING_KEY, input.tier);
    return `Switched to ${input.tier} tier (${modelId}). Active from the next message.`;
  },
});
