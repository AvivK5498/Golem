import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
  Processor,
} from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/agent";

/**
 * Marker string used to split the primary system prompt into a stable prefix
 * (cacheable) and a per-turn dynamic tail. The instructions callback in
 * platform.ts assembles the prompt as `<static>\n\n<SENTINEL>\n\n<dynamic>`.
 */
export const CACHE_BOUNDARY_SENTINEL = "<!-- CACHE_BOUNDARY -->";

/** Heuristic match for the working-memory system message Mastra appends. */
const WORKING_MEMORY_MARKERS = ["WORKING_MEMORY_SYSTEM_INSTRUCTION", "Working Memory"];

function looksLikeWorkingMemory(content: unknown): boolean {
  if (typeof content !== "string") return false;
  return WORKING_MEMORY_MARKERS.some((m) => content.includes(m));
}

/**
 * Maximizes Anthropic prompt-cache coverage. Three cache breakpoints:
 *
 *   1. Static system prefix — split out of the first system message at the
 *      `<!-- CACHE_BOUNDARY -->` sentinel.
 *   2. Working memory — Mastra-appended system message that updates rarely.
 *   3. Most recent historical assistant message — caches all of conversation
 *      history (lastMessages window) up through the prior turn's reply. New
 *      breakpoint each turn; prior turns' breakpoints still hit until TTL.
 *
 * Reorders system messages so dynamic per-turn content (tempo) sits AFTER
 * working memory. The current-time marker has been moved out of the system
 * block entirely (it lives in the user message envelope now).
 *
 * Final system order: [static (cache), working_memory (cache), dynamic, …rest].
 * History gets cache_control attached in-place on the latest assistant message.
 *
 * Only fires for Anthropic-routed models. Non-Anthropic providers get the
 * sentinel stripped with no markers attached.
 */
export class PromptCacheProcessor implements Processor {
  readonly id = "prompt-cache";
  readonly name = "Prompt Cache";

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult | void {
    const systemMessages = args.systemMessages;
    if (!systemMessages || systemMessages.length === 0) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (args as any).model;
    const modelId: string | undefined = model?.modelId;
    const provider: string | undefined = model?.provider;
    const isAnthropic =
      provider?.toLowerCase().includes("anthropic") ||
      modelId?.toLowerCase().includes("anthropic") ||
      modelId?.toLowerCase().includes("claude");

    const cacheControl = { type: "ephemeral", ttl: "1h" } as const;

    // ── System messages: split static/dynamic, tag static + working memory ──
    let staticMsg: typeof systemMessages[number] | null = null;
    let dynamicMsg: typeof systemMessages[number] | null = null;
    const wmMessages: typeof systemMessages = [];
    const otherMessages: typeof systemMessages = [];

    for (const msg of systemMessages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (msg as any).content;
      if (staticMsg === null && typeof content === "string" && content.includes(CACHE_BOUNDARY_SENTINEL)) {
        const [rawStatic, ...rest] = content.split(CACHE_BOUNDARY_SENTINEL);
        const staticPart = rawStatic.trimEnd();
        const dynamicPart = rest.join(CACHE_BOUNDARY_SENTINEL).trimStart();

        if (isAnthropic) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const existing = (msg as any).providerOptions ?? {};
          staticMsg = {
            ...msg,
            content: staticPart,
            providerOptions: {
              ...existing,
              openrouter: { cacheControl },
              anthropic: { cacheControl },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          staticMsg = { ...msg, content: staticPart } as any;
        }
        if (dynamicPart) {
          dynamicMsg = { role: "system", content: dynamicPart };
        }
      } else if (looksLikeWorkingMemory(content)) {
        if (isAnthropic) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const existing = (msg as any).providerOptions ?? {};
          wmMessages.push({
            ...msg,
            providerOptions: {
              ...existing,
              openrouter: { cacheControl },
              anthropic: { cacheControl },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
        } else {
          wmMessages.push(msg);
        }
      } else {
        otherMessages.push(msg);
      }
    }

    if (!staticMsg) return; // sentinel not found — no rewrite

    // Order: static (cached), working memory (cached), dynamic (uncached), other
    const rewrittenSystem: typeof systemMessages = [staticMsg, ...wmMessages];
    if (dynamicMsg) rewrittenSystem.push(dynamicMsg);
    rewrittenSystem.push(...otherMessages);

    // ── History: tag the most recent historical assistant message ──
    // The runner appends the new user message to `messages` BEFORE the model
    // generates, so the most recent assistant in the array is from the prior
    // turn — exactly the right breakpoint for the conversation prefix.
    let historyTagged = false;
    let rewrittenMessages: MastraDBMessage[] | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const incomingMessages = (args as any).messages as MastraDBMessage[] | undefined;
    if (isAnthropic && Array.isArray(incomingMessages) && incomingMessages.length > 0) {
      let lastAssistantIdx = -1;
      for (let i = incomingMessages.length - 1; i >= 0; i--) {
        if ((incomingMessages[i] as { role?: string }).role === "assistant") {
          lastAssistantIdx = i;
          break;
        }
      }
      if (lastAssistantIdx >= 0) {
        const target = incomingMessages[lastAssistantIdx];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existingContent = (target as any).content ?? {};
        const existingProviderMeta = existingContent.providerMetadata ?? {};
        const tagged: MastraDBMessage = {
          ...target,
          content: {
            ...existingContent,
            providerMetadata: {
              ...existingProviderMeta,
              openrouter: { cacheControl },
              anthropic: { cacheControl },
            },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        rewrittenMessages = [
          ...incomingMessages.slice(0, lastAssistantIdx),
          tagged,
          ...incomingMessages.slice(lastAssistantIdx + 1),
        ];
        historyTagged = true;
      }
    }

    if (isAnthropic && modelId && !loggedModels.has(modelId)) {
      loggedModels.add(modelId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const staticLen = (staticMsg as any)?.content?.length ?? 0;
      const wmLen = wmMessages.reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (n, m) => n + ((m as any)?.content?.length ?? 0),
        0,
      );
      const breakpointCount = 1 + (wmMessages.length > 0 ? 1 : 0) + (historyTagged ? 1 : 0);
      console.log(
        `[prompt-cache] active model=${modelId} staticLen=${staticLen} wmLen=${wmLen} historyTagged=${historyTagged} breakpoints=${breakpointCount}`,
      );
    }

    const result: ProcessInputStepResult = { systemMessages: rewrittenSystem };
    if (rewrittenMessages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any).messages = rewrittenMessages;
    }
    return result;
  }
}

const loggedModels = new Set<string>();
