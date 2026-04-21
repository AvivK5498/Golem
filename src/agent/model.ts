import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createCodexModel } from "./codex-provider.js";

// ---------------------------------------------------------------------------
// Shared OpenRouter settings (typed by @openrouter/ai-sdk-provider)
// ---------------------------------------------------------------------------

type ReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

const DEFAULT_REASONING_EFFORT: ReasoningEffort =
  (process.env.DEFAULT_REASONING_EFFORT as ReasoningEffort) || "medium";

// Provider routing: exclude data-training providers. Provider ORDER is pinned
// per model family in buildProviderRouting() to keep each family in a single
// cache pool — prompt caching only pays off if consecutive turns hit the same
// provider. allow_fallbacks: true preserves uptime when the primary is down.
//
// See: https://openrouter.ai/docs/guides/routing/auto-exacto
const BASE_PROVIDER_ROUTING = {
  data_collection: "deny" as const,
  allow_fallbacks: true,
};

/**
 * Build provider routing for a given model ID. Pinning ORDER by model family
 * keeps prompt caching stable:
 *   - Anthropic: explicit cache_control markers require Anthropic-direct (or
 *     Bedrock with native caching; we prefer direct for simplicity).
 *   - Google / OpenAI / DeepSeek: automatic caching only hits when consecutive
 *     turns go to the same provider.
 * Unknown families fall back to default (Auto Exacto) routing.
 */
function buildProviderRouting(modelId: string) {
  if (modelId.startsWith("anthropic/")) {
    return { ...BASE_PROVIDER_ROUTING, order: ["anthropic"] };
  }
  if (modelId.startsWith("google/")) {
    return { ...BASE_PROVIDER_ROUTING, order: ["google-ai-studio", "google-vertex"] };
  }
  if (modelId.startsWith("openai/")) {
    return { ...BASE_PROVIDER_ROUTING, order: ["openai"] };
  }
  if (modelId.startsWith("deepseek/")) {
    return { ...BASE_PROVIDER_ROUTING, order: ["deepseek"] };
  }
  return BASE_PROVIDER_ROUTING;
}

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
      // Prompt caching is handled per-message by PromptCacheProcessor, which
      // tags the final system message with `providerOptions.openrouter.cacheControl`.
      // The OpenRouter SDK reads that and emits the correct Anthropic cache_control
      // block. A provider-level extraBody.cache_control does NOT work here —
      // verified empirically (cachedInputTokens stayed at 0 across turns).
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
    provider: buildProviderRouting(DEFAULT_MODEL),
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
 * Build a LanguageModel for a specific model ID string.
 *
 * Provider routing is determined by the model ID prefix:
 *   - "codex/<model>" → Codex provider (ChatGPT subscription via OAuth)
 *   - everything else → OpenRouter (current default behavior)
 *
 * The Codex path bypasses OpenRouter entirely; it talks directly to
 * chatgpt.com/backend-api with credentials managed by codex-auth-store.
 *
 * When fallbackModels is provided (OpenRouter only), OpenRouter tries them
 * server-side. When reasoningEffort is provided, it overrides the env/default.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getModelForId(modelId: string, opts?: { fallbackModels?: string[]; reasoningEffort?: ReasoningEffort }): any {
  // Codex provider — strip the prefix and dispatch to the new path.
  // Pass through the per-agent reasoning effort so the existing UI dropdown
  // applies to Codex agents the same way it does to OpenRouter agents.
  if (modelId.startsWith("codex/")) {
    const codexModelId = modelId.slice("codex/".length);
    return createCodexModel(codexModelId, { reasoningEffort: opts?.reasoningEffort });
  }

  // Default: OpenRouter (provider routing pinned by model family for cache stability)
  return getOpenRouterProvider()(modelId, {
    parallelToolCalls: true,
    reasoning: buildReasoning(opts?.reasoningEffort),
    usage: { include: true },
    provider: buildProviderRouting(modelId),
    ...(opts?.fallbackModels?.length && { models: [modelId, ...opts.fallbackModels] }),
  });
}

/**
 * Get the nano model for lightweight utility tasks.
 * Forces `sort: "price"` (cheapest provider) since nano calls are typically
 * single-shot, no-tool, cost-sensitive operations — Auto Exacto and quality
 * optimization don't matter here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getNanoModel(): any {
  return getOpenRouterProvider()(DEFAULT_NANO_MODEL, {
    reasoning: buildReasoning("none"),
    usage: { include: true },
    // Nano is single-shot, no-tool, cost-sensitive; sort by price and bypass
    // family-pinning since caching isn't useful for one-off classification.
    provider: {
      ...BASE_PROVIDER_ROUTING,
      sort: "price" as const,
    },
  });
}
