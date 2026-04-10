/**
 * Hardcoded registry of Codex models available via the ChatGPT subscription
 * OAuth path. The Codex Responses API does NOT expose a /models endpoint, so
 * we maintain this list manually. Verified via the audit script
 * (npx tsx src/codex-audit.ts) on 2026-04-09 against a Plus subscription.
 *
 * Each entry should be tested with src/codex-audit.ts before being added.
 * Some models require a minimum reasoning effort (e.g. gpt-5.2-codex needs
 * "medium" minimum); the codex-provider's clampReasoningEffort handles this.
 */

export interface CodexModelInfo {
  /** Bare model ID as Codex expects it (no prefix). */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  /** Approximate context window in tokens. */
  contextLength: number;
  /** True when this model is available on Plus. False = Pro+ only or restricted. */
  availableOnPlus: boolean;
  /** Minimum reasoning effort the model accepts. Empty = "any". */
  minReasoningEffort?: "low" | "medium" | "high";
  /** Optional short description for the picker tooltip. */
  description?: string;
}

/**
 * Verified-working Codex models. The "codex/" prefix is added at the dispatcher
 * layer (src/agent/model.ts) — model IDs here are bare.
 */
export const CODEX_MODELS: readonly CodexModelInfo[] = [
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 mini",
    contextLength: 272_000,
    availableOnPlus: true,
    description: "Fast, cheap, the default low-tier replacement",
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    contextLength: 272_000,
    availableOnPlus: true,
    description: "Full GPT-5.4 — usable for med tier",
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    contextLength: 272_000,
    availableOnPlus: true,
    description: "Coding-tuned variant",
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    contextLength: 272_000,
    availableOnPlus: true,
    description: "Older GPT-5 family",
  },
  {
    id: "gpt-5.2-codex",
    name: "GPT-5.2 Codex",
    contextLength: 272_000,
    availableOnPlus: true,
    minReasoningEffort: "medium",
    description: "Coding-tuned, requires reasoning effort ≥ medium",
  },
  {
    id: "gpt-5.1",
    name: "GPT-5.1",
    contextLength: 272_000,
    availableOnPlus: true,
    description: "Legacy GPT-5.1",
  },
  {
    id: "gpt-5.1-codex-max",
    name: "GPT-5.1 Codex Max",
    contextLength: 272_000,
    availableOnPlus: true,
    minReasoningEffort: "medium",
    description: "Higher capacity codex variant, reasoning effort ≥ medium",
  },
  {
    id: "gpt-5.1-codex-mini",
    name: "GPT-5.1 Codex mini",
    contextLength: 272_000,
    availableOnPlus: true,
    minReasoningEffort: "medium",
    description: "Lightweight codex variant, reasoning effort ≥ medium",
  },
  // Pro+ entitlement only — listed for completeness, won't work on Plus accounts
  {
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    contextLength: 272_000,
    availableOnPlus: false,
    description: "Pro+ entitlement only",
  },
] as const;

/** Returns the Codex models with the "codex/" prefix already applied. */
export function getCodexModelsForUI(): Array<{ id: string; name: string; contextLength: number; provider: "codex" }> {
  return CODEX_MODELS.map((m) => ({
    id: `codex/${m.id}`,
    name: m.name,
    contextLength: m.contextLength,
    provider: "codex" as const,
  }));
}

/** True if the given (prefixed or bare) model ID is in our Codex registry. */
export function isCodexModel(modelId: string): boolean {
  const bare = modelId.startsWith("codex/") ? modelId.slice("codex/".length) : modelId;
  return CODEX_MODELS.some((m) => m.id === bare);
}
