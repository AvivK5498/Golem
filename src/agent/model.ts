import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createCodexModel } from "./codex-provider.js";

// ---------------------------------------------------------------------------
// Shared OpenRouter settings (typed by @openrouter/ai-sdk-provider)
// ---------------------------------------------------------------------------

type ReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

const DEFAULT_REASONING_EFFORT: ReasoningEffort =
  (process.env.DEFAULT_REASONING_EFFORT as ReasoningEffort) || "medium";

// Provider routing: exclude data-training providers, and DON'T set an explicit
// sort so that OpenRouter's Auto Exacto kicks in for tool-calling requests.
//
// Auto Exacto reorders providers using throughput + tool-call success rate +
// benchmark data — only for requests that include tools. For non-tool requests
// the default price-weighted routing applies. Setting an explicit `sort` here
// would bypass Auto Exacto entirely.
//
// Note: a `default sort` in OpenRouter account preferences also bypasses
// Auto Exacto. If Auto Exacto isn't kicking in, check that setting too.
//
// See: https://openrouter.ai/docs/guides/routing/auto-exacto
const PROVIDER_ROUTING = {
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

  // Default: OpenRouter (unchanged)
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
 * Forces `sort: "price"` (cheapest provider) since nano calls are typically
 * single-shot, no-tool, cost-sensitive operations — Auto Exacto and quality
 * optimization don't matter here.
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
