/**
 * AgentRunner — per-agent message processing for the platform architecture.
 *
 * Encapsulates the agent-scoped equivalent of processCommandFull() from
 * mastra-agent.ts. Each agent gets its own AgentRunner instance that handles:
 * - Memory scoping with agent prefix
 * - Request context setup
 * - Delegation hooks for supervisor pattern
 * - Progressive messaging via onStepFinish
 * - Feed logging (success + error paths)
 * - Per-chat FIFO queue to prevent concurrent processing
 */
import type { Agent } from "@mastra/core/agent";
import type { AgentRegistryConfig } from "./schemas.js";
import type { AgentRegistry } from "./agent-registry.js";
import type { TelegramTransport } from "../transport/telegram-transport.js";
import type { FeedStore } from "../feed/feed-store.js";
import type { CronStore } from "../scheduler/cron-store.js";
import type { IncomingMessage } from "../transport/types.js";
import fs from "node:fs";
import { buildMemoryScope } from "../agent/memory-scope.js";
import { classifyChat } from "../agent/filter.js";
import type { ChatType } from "../agent/filter.js";
import { getModelForId } from "../agent/model.js";
import { logger } from "../utils/external-logger.js";
import { isTransientApiError } from "../utils/api-errors.js";

const FALLBACK_MODEL = process.env.FALLBACK_MODEL || "openai/gpt-4.1-mini";

// ── Public interfaces ────────────────────────────────────────

export interface AgentRunnerDeps {
  agent: Agent;
  config: AgentRegistryConfig;
  registry: AgentRegistry;
  transport: TelegramTransport;
  feedStore: FeedStore;
  cronStore: CronStore;
  jobQueue?: import("../scheduler/job-queue.js").JobQueue;
  settingsStore?: import("../scheduler/settings-store.js").SettingsStore;
  agentSettings?: import("./agent-settings.js").AgentSettings;
}

export interface ProcessMessageOptions {
  promptMode?: "full" | "autonomous" | "proactive";
  sender?: string;
  imageData?: { base64: string; mimeType: string; filePath?: string };
  onProgressText?: (text: string) => Promise<void>;
}

export interface ProcessMessageResult {
  text: string;
  finishReason: string;
  tokensIn?: number;
  tokensOut?: number;
  /** Text already sent via progressive messaging (verbatim) */
  progressivelySentText: string;
}

// ── AgentRunner ──────────────────────────────────────────────

export class AgentRunner {
  private agent: Agent;
  private config: AgentRegistryConfig;
  private registry: AgentRegistry;
  private transport: TelegramTransport;
  private feedStore: FeedStore;
  private cronStore: CronStore;
  private jobQueue?: import("../scheduler/job-queue.js").JobQueue;
  private settingsStore?: import("../scheduler/settings-store.js").SettingsStore;
  private agentSettings?: import("./agent-settings.js").AgentSettings;

  /** Per-chat promise chain to prevent concurrent processing for the same chat. */
  private chatQueues = new Map<string, Promise<void>>();

  /** Per-chat recent response hashes for stale detection. */
  private recentResponseHashes = new Map<string, number[]>();

  constructor(deps: AgentRunnerDeps) {
    this.agent = deps.agent;
    this.config = deps.config;
    this.registry = deps.registry;
    this.transport = deps.transport;
    this.feedStore = deps.feedStore;
    this.cronStore = deps.cronStore;
    this.jobQueue = deps.jobQueue;
    this.settingsStore = deps.settingsStore;
    this.agentSettings = deps.agentSettings;
  }

  // ── Resilience helpers ────────────────────────────────────

  private async retryWithBackoff<T>(fn: () => Promise<T>, label: string): Promise<T> {
    const maxRetries = parseInt(process.env.MAX_RETRIES || "3");
    const baseRetryMs = parseInt(process.env.BASE_RETRY_MS || "5000");
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!isTransientApiError(err) || attempt === maxRetries - 1) throw err;
        const delayMs = baseRetryMs * Math.pow(2, attempt);
        console.warn(`[${this.config.id}] ${label}: transient error, retry ${attempt + 1}/${maxRetries} in ${delayMs / 1000}s...`);
        try { logger.warn(`Transient API error, retrying: ${label}`, { agent: this.config.id, attempt: String(attempt + 1), maxRetries: String(maxRetries) }); } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    throw new Error("unreachable");
  }

  private simpleHash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return h >>> 0;
  }

  private isStaleResponse(chatId: string, hash: number): boolean {
    if (hash === 0) return false;
    const recent = this.recentResponseHashes.get(chatId) || [];
    return recent.includes(hash);
  }

  private recordResponseHash(chatId: string, hash: number): void {
    if (hash === 0) return;
    const recent = this.recentResponseHashes.get(chatId) || [];
    recent.push(hash);
    if (recent.length > 5) recent.shift();
    this.recentResponseHashes.set(chatId, recent);
  }

  /**
   * Process an incoming message. This is the main entry point.
   */
  async processMessage(
    text: string,
    chatId: string,
    chatType: ChatType,
    options: ProcessMessageOptions = {},
  ): Promise<ProcessMessageResult> {
    const { promptMode = "full" } = options;
    const agentId = this.config.id;

    const ownerId = String(this.config.transport.ownerId);
    const memoryScope = buildMemoryScope({
      platform: "telegram",
      chatId,
      ownerId,
      promptMode,
      agentId,
    });

    const requestContext = new Map<string, unknown>();
    requestContext.set("agentId", agentId);
    requestContext.set("chatType", chatType);
    requestContext.set("promptMode", promptMode);
    requestContext.set("jid", chatId);
    requestContext.set("cronStore", this.cronStore);
    requestContext.set("transport", this.transport);
    requestContext.set("ownerAddress", {
      platform: "telegram" as const,
      id: String(this.config.transport.ownerId),
    });
    if (this.jobQueue) requestContext.set("jobQueue", this.jobQueue);
    if (this.settingsStore) requestContext.set("settingsStore", this.settingsStore);
    if (this.agentSettings) requestContext.set("agentSettings", this.agentSettings);
    // Tiers are global — resolved from settings
    const globalTiers = this.agentSettings?.getGlobalTiers();
    if (globalTiers) requestContext.set("modelTiers", globalTiers);
    // Default model: override (settings) > tier (settings) > fallback
    const override = this.agentSettings?.getModel(agentId);
    const tierKey = this.agentSettings?.getActiveTier(agentId) || "low";
    const resolvedModel = override || (globalTiers && globalTiers[tierKey]) || "anthropic/claude-haiku-4-5";
    requestContext.set("defaultModel", resolvedModel);
    if (options.sender) {
      requestContext.set("sender", options.sender);
    }
    if (options.imageData) {
      requestContext.set("imageData", options.imageData);
    }

    const isBackgroundRun = promptMode === "autonomous";
    const maxSteps = this.agentSettings?.getMaxSteps(agentId) ?? 30;

    try {
      const startMs = Date.now();
      try { logger.info(`Agent turn started: "${text.slice(0, 120)}"`, { agent: agentId, chatType, promptMode }); } catch { /* ignore */ }

      // Group chats: shared thread for conversation, working memory disabled
      // (Mastra rejects cross-resource writes on shared threads).
      // Working memory is maintained via 1:1 conversations only.
      // Fix #2: use chatType instead of ID comparison — admin groups are promoted to "owner"
      const isGroupChat = chatType === "group";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra generate options type is complex
      const generateOptions: Record<string, any> = {
        maxSteps,
        requestContext,
        memory: {
          thread: memoryScope.thread,
          resource: memoryScope.resource,
          ...(isBackgroundRun && { options: { lastMessages: 0, semanticRecall: false } }),
          ...(isGroupChat && { options: { workingMemory: { enabled: false } } }),
        },
        // Delegation hooks for supervisor pattern (sub-agent orchestration)
        // NOTE: context.iteration is derived from assistant message count in memory,
        // NOT an actual delegation counter. We track our own counter per-generate call.
        delegation: (() => {
          let delegationCount = 0;
          return {
          onDelegationStart: async (context: { primitiveId: string; iteration: number }) => {
            delegationCount++;
            console.log(`[${agentId}] delegating to ${context.primitiveId} (delegation #${delegationCount})`);
            if (delegationCount > 8) {
              return {
                proceed: false,
                rejectionReason: "Max delegation iterations reached. Synthesize current findings.",
              };
            }
            return { proceed: true };
          },
          onDelegationComplete: async (context: { primitiveId: string; error?: string }) => {
            if (context.error) {
              console.error(`[${agentId}] delegation to ${context.primitiveId} failed:`, context.error);
              return { feedback: `Delegation failed: ${context.error}. Try a different approach.` };
            }
            return undefined;
          },
          // Filter messages passed to sub-agents to limit context size
          messageFilter: ({ messages }: { messages: Array<{ role: string }> }) => {
            const system = messages.filter((m) => m.role === "system");
            const recent = messages.filter((m) => m.role !== "system").slice(-5);
            return [...system, ...recent];
          },
        };
        })(),
      };

      // Track the last progressively sent text verbatim so we can deduplicate the final message
      // Track cumulative text to extract per-step deltas (Mastra sends accumulated text, not deltas)
      let lastSentProgressText = "";
      let previousCumulativeText = "";

      if (options.onProgressText) {
        let stepsSinceLastSend = 0;

        generateOptions.onStepFinish = async (props: {
          text?: string;
          finishReason?: string;
          toolCalls?: unknown[];
        }) => {
          const cumulativeText = typeof props.text === "string" ? props.text.trim() : "";
          const hasToolCalls = Array.isArray(props.toolCalls) && props.toolCalls.length > 0;
          stepsSinceLastSend++;
          if (!hasToolCalls || cumulativeText.length <= 20 || !options.onProgressText) return;

          // Extract only the new text added in this step
          let delta = cumulativeText;
          if (previousCumulativeText && cumulativeText.startsWith(previousCumulativeText)) {
            delta = cumulativeText.slice(previousCumulativeText.length).trim();
          }
          previousCumulativeText = cumulativeText;

          // Send if meaningful text: 40+ chars (skips filler like "Let me check..." or "Got it.")
          // OR if several steps passed and there's any new content (agent is working through steps)
          const isSubstantial = delta.length >= 40;
          const isLongRunning = stepsSinceLastSend >= 2 && delta.length > 20;
          if (isSubstantial || isLongRunning) {
            await options.onProgressText(delta);
            lastSentProgressText = cumulativeText;
            stepsSinceLastSend = 0;
          }
        };
      }

      // Build multimodal message when image is present
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- CoreMessage content types are complex
      let messageInput: any = text;
      if (options.imageData) {
        const imageBytes = options.imageData.filePath
          ? new Uint8Array(fs.readFileSync(options.imageData.filePath))
          : new Uint8Array(Buffer.from(options.imageData.base64, "base64"));
        messageInput = [{
          role: "user" as const,
          content: [
            { type: "image" as const, image: imageBytes, mimeType: options.imageData.mimeType },
            { type: "text" as const, text: text || "What do you see in this image?" },
          ],
        }];
      }

      // Retry with backoff + fallback model on transient errors
      const generateFn = () => this.agent.generate(messageInput, generateOptions);
      let result;
      try {
        result = await this.retryWithBackoff(generateFn, "primary model");
      } catch (err) {
        if (isTransientApiError(err)) {
          console.warn(`[${agentId}] retries exhausted, falling back to ${FALLBACK_MODEL}`);
          try { logger.warn(`Retries exhausted, falling back to ${FALLBACK_MODEL}`, { agent: agentId, chatType }); } catch { /* ignore */ }
          result = await this.agent.generate(text, {
            ...generateOptions,
            model: getModelForId(FALLBACK_MODEL),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra generate accepts model override at runtime
          } as any);
        } else {
          throw err;
        }
      }

      // When multi-step execution happens, Mastra concatenates text from all steps.
      // Use the last step's text instead — it's the actual answer.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra result.steps type
      const steps = (result as any).steps as Array<{ text?: string; toolCalls?: unknown[] }> | undefined;
      if (steps && steps.length > 1) {
        const lastStep = steps[steps.length - 1];
        if (lastStep.text?.trim()) {
          result = { ...result, text: lastStep.text };
        }
      }

      const asyncJobDispatched = requestContext.get("_asyncJobDispatched" as never);

      // AsyncJobGuard aborts the loop after async job dispatch (step 1 TripWire).
      // The result text is empty because no LLM ran after step 0. Extract the
      // confirmation from the tool result in step 0 (the code_agent return value).
      if (asyncJobDispatched && !result.text?.trim()) {
        const step0Text = steps?.[0]?.text?.trim();
        if (step0Text) {
          result = { ...result, text: step0Text };
        }
      }

      // Hard-stop fallback: if many steps ran but result text is empty, the model
      // hit a limit (error gate, per-turn cap) without producing a final answer.
      // Ensure the user always gets something back.
      if (!result.text?.trim() && steps && steps.length > 3) {
        const fallback = "I ran into repeated issues and couldn't complete this task. Please try again or rephrase your request.";
        console.warn(`[${agentId}] empty result after ${steps.length} steps — using fallback`);
        try { logger.warn("Empty result after hard stop, using fallback", { agent: agentId, steps: String(steps.length) }); } catch { /* ignore */ }
        result = { ...result, text: fallback };
      }

      // Stale response detection — retry once if response hash matches recent.
      // Skip when an async job was dispatched — the confirmation message IS the
      // expected response, and retrying would re-enter the agentic loop.
      const responseHash = this.simpleHash(result.text || "");
      if (!asyncJobDispatched && this.isStaleResponse(chatId, responseHash)) {
        console.warn(`[${agentId}] stale response detected for ${chatId}, retrying...`);
        try { logger.warn("Stale response detected, retrying", { agent: agentId, chatType, chatId }); } catch { /* ignore */ }
        result = await this.agent.generate(
          `${text}\n\n[System: Your previous response was identical to a recent one. Please provide a fresh, different response.]`,
          generateOptions,
        );
      }
      this.recordResponseHash(chatId, this.simpleHash(result.text || ""));

      const latencyMs = Date.now() - startMs;

      this.feedStore.log(agentId, {
        source: isBackgroundRun ? "cron" : "direct",
        input: text.slice(0, 500),
        output: (result.text || "").slice(0, 500),
        status: result.text?.trim() ? "delivered" : "suppressed",
        tokensIn: result.usage?.inputTokens,
        tokensOut: result.usage?.outputTokens,
        latencyMs,
        platform: "telegram",
      });

      try {
        logger.info(`Agent turn completed in ${latencyMs}ms`, {
          agent: agentId, chatType, finishReason: result.finishReason || "stop",
          tokensIn: String(result.usage?.inputTokens ?? 0), tokensOut: String(result.usage?.outputTokens ?? 0),
          latencyMs: String(latencyMs), steps: String(steps?.length ?? 1),
        });
      } catch { /* ignore */ }

      return {
        text: result.text || "",
        finishReason: result.finishReason || "stop",
        tokensIn: result.usage?.inputTokens,
        tokensOut: result.usage?.outputTokens,
        progressivelySentText: lastSentProgressText,
      };
    } catch (err) {
      console.error(`[${agentId}] processMessage error:`, err);
      try { logger.error(`Agent turn failed: ${err instanceof Error ? err.message : String(err)}`, { agent: agentId, chatType }); } catch { /* ignore */ }
      this.feedStore.log(agentId, {
        source: isBackgroundRun ? "cron" : "direct",
        input: text.slice(0, 500),
        output: err instanceof Error ? err.message : String(err),
        status: "error",
        platform: "telegram",
      });
      throw err;
    }
  }

  /**
   * Classify an incoming message based on per-agent config.
   * Uses the agent's ownerId/allowedGroups instead of global config.
   */
  classifyMessage(msg: IncomingMessage): ChatType {
    return classifyChat(msg.from, {
      ownerId: this.config.transport.ownerId,
      allowedGroups: this.agentSettings?.getAllowedGroups(this.config.id) ?? [],
      adminGroups: this.agentSettings?.getAdminGroups(this.config.id) ?? [],
    });
  }

  /**
   * Queue a message for processing, preventing concurrent processing for the same chat.
   * Uses a per-chat promise chain to enforce FIFO ordering within each conversation.
   */
  async queueMessage(
    chatId: string,
    handler: () => Promise<void>,
  ): Promise<void> {
    const existing = this.chatQueues.get(chatId) || Promise.resolve();
    const next = existing.then(handler).catch((err) => {
      console.error(`[${this.config.id}] queue error for chat ${chatId}:`, err);
      try { logger.error(`Queue error for chat ${chatId}: ${err instanceof Error ? err.message : String(err)}`, { agent: this.config.id }); } catch { /* ignore */ }
    });
    this.chatQueues.set(chatId, next);
    try {
      await next;
    } finally {
      // Clean up completed queue entry to prevent unbounded growth
      if (this.chatQueues.get(chatId) === next) {
        this.chatQueues.delete(chatId);
      }
    }
  }

  get agentId(): string {
    return this.config.id;
  }

  getOwnerId(): number {
    return this.config.transport.ownerId;
  }

  get mastraAgent(): Agent {
    return this.agent;
  }
}
