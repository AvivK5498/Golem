import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// ---------------------------------------------------------------------------
// Shared OpenRouter settings (typed by @openrouter/ai-sdk-provider)
// ---------------------------------------------------------------------------

type ReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

const DEFAULT_REASONING_EFFORT: ReasoningEffort =
  (process.env.DEFAULT_REASONING_EFFORT as ReasoningEffort) || "medium";

// Provider routing: prefer fast providers, exclude data-training providers.
const PROVIDER_ROUTING = {
  sort: "throughput" as const,
  data_collection: "deny" as const,
};

function buildReasoning(effort?: ReasoningEffort) {
  const resolved = effort || DEFAULT_REASONING_EFFORT;
  return { effort: resolved, exclude: true };
}

// ---------------------------------------------------------------------------
// Provider singleton
// ---------------------------------------------------------------------------

let _openRouterProvider: ReturnType<typeof createOpenRouter> | null = null;
function getOpenRouterProvider() {
  if (!_openRouterProvider) {
    _openRouterProvider = createOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY,
      headers: {
        "HTTP-Referer": "https://golem.agent",
        "X-Title": "Golem",
      },
      // Anthropic prompt caching — not typed in the SDK.
      extraBody: {
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    });
  }
  return _openRouterProvider;
}

// Default model IDs — used as fallbacks when per-agent settings are not available.
const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const DEFAULT_EMBEDDER_MODEL = "openai/text-embedding-3-small";
const DEFAULT_NANO_MODEL = "openai/gpt-4.1-nano";

/**
 * Build a Mastra-compatible model instance with default settings.
 * Per-agent overrides happen at the platform layer via getModelForId().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMastraModelId(): any {
  return getOpenRouterProvider()(DEFAULT_MODEL, {
    parallelToolCalls: true,
    reasoning: buildReasoning(),
    usage: { include: true },
    provider: PROVIDER_ROUTING,
  });
}

/**
 * Build a Mastra-compatible embedder via OpenRouter.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getMastraEmbedderId(): any {
  return getOpenRouterProvider().textEmbeddingModel(DEFAULT_EMBEDDER_MODEL);
}

/**
 * Build a LanguageModel for a specific OpenRouter model ID string.
 * Used by platform agent creation and sub-agent loader.
 * When fallbackModels is provided, OpenRouter tries them server-side.
 * When reasoningEffort is provided, it overrides the env/default.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getModelForId(modelId: string, opts?: { fallbackModels?: string[]; reasoningEffort?: ReasoningEffort }): any {
  return getOpenRouterProvider()(modelId, {
    parallelToolCalls: true,
    reasoning: buildReasoning(opts?.reasoningEffort),
    usage: { include: true },
    provider: PROVIDER_ROUTING,
    ...(opts?.fallbackModels?.length && { models: [modelId, ...opts.fallbackModels] }),
  });
}

/**
 * Get the nano model for lightweight utility tasks.
 * Sorts by price instead of throughput.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getNanoModel(): any {
  return getOpenRouterProvider()(DEFAULT_NANO_MODEL, {
    reasoning: buildReasoning("none"),
    usage: { include: true },
    provider: {
      ...PROVIDER_ROUTING,
      sort: "price" as const,
    },
  });
}
