import { hookRegistry } from "./index.js";
import type { MessageTransport } from "../transport/interface.js";
import type { ChatAddress } from "../transport/types.js";
import type { AgentSettings } from "../platform/agent-settings.js";

/** Default set of tools that warrant a typing-indicator refresh */
const DEFAULT_LONG_RUNNING_TOOLS = [
  "web_search", "web_fetch", "run_command",
  "code_agent",
];

/** Non-interactive promptModes — no human is waiting, skip indicators */
const SILENT_PROMPT_MODES = new Set(["autonomous"]);

/** Telegram typing indicator expires after ~5s; refresh before that */
const TYPING_REFRESH_MS = 4_000;

/**
 * Register conversation-flow hooks for a transport.
 *
 * - `before_agent`: start a recurring typing indicator while the agent works
 * - `after_tool_call`: refresh the typing indicator for long-running tools
 * - `agent_end`: stop the recurring indicator and clean up
 *
 * When `agentSettings` is provided, settings are read from SQLite.
 * An optional `overrides` object can supply values directly (useful for testing).
 *
 * @returns unregister function that removes all hooks
 */
export interface ConversationFlowOverrides {
  enabled?: boolean;
  typingIndicator?: boolean;
  toolStatusMessages?: boolean;
  longRunningTools?: string[];
}

export function registerConversationFlowHooks(
  transport: MessageTransport,
  agentId?: string,
  agentSettings?: AgentSettings,
  overrides?: ConversationFlowOverrides,
): () => void {
  // Read from AgentSettings (SQLite) when available
  function fromSettings<T>(getter: (s: AgentSettings, id: string) => T | undefined): T | undefined {
    return agentId && agentSettings ? getter(agentSettings, agentId) : undefined;
  }

  const enabled = overrides?.enabled
    ?? fromSettings((s, id) => s.getConversationFlowEnabled(id))
    ?? true;

  if (!enabled) {
    return () => {};
  }

  const longRunningTools = new Set(
    overrides?.longRunningTools
      ?? fromSettings((s, id) => s.getLongRunningTools(id))
      ?? DEFAULT_LONG_RUNNING_TOOLS,
  );
  const showTyping = overrides?.typingIndicator
    ?? fromSettings((s, id) => s.getTypingIndicator(id)) ?? true;
  const refreshOnTool = overrides?.toolStatusMessages
    ?? fromSettings((s, id) => s.getToolStatusMessages(id)) ?? true;

  // Track active JIDs and their typing intervals for this transport instance.
  // Prefixed with platform to avoid cross-transport collisions.
  const activeJids = new Set<string>();
  const typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  function startTypingLoop(key: string, address: ChatAddress): void {
    // Don't double-start
    if (typingIntervals.has(key)) return;
    // Send immediately
    transport.sendTypingIndicator?.(address).catch(() => {});
    // Then refresh on interval
    const interval = setInterval(() => {
      if (!activeJids.has(key)) {
        clearInterval(interval);
        typingIntervals.delete(key);
        return;
      }
      transport.sendTypingIndicator?.(address).catch(() => {});
    }, TYPING_REFRESH_MS);
    typingIntervals.set(key, interval);
  }

  function stopTypingLoop(key: string): void {
    const interval = typingIntervals.get(key);
    if (interval) {
      clearInterval(interval);
      typingIntervals.delete(key);
    }
  }

  const unregisterBeforeAgent = hookRegistry.register("before_agent", async (ctx) => {
    const promptMode = ctx.promptMode as string;
    const jid = ctx.jid as string;
    const platform = ctx.platform as string;

    if (SILENT_PROMPT_MODES.has(promptMode)) return;
    if (platform !== transport.platform) return;
    if (agentId && ctx.agentId && ctx.agentId !== agentId) return;
    if (!jid) return;

    const key = `${platform}:${jid}`;
    activeJids.add(key);

    if (showTyping && transport.sendTypingIndicator) {
      const address: ChatAddress = { platform: transport.platform, id: jid };
      startTypingLoop(key, address);
    }
  });

  const unregisterAfterTool = hookRegistry.register("after_tool_call", async (ctx) => {
    if (!refreshOnTool) return;
    if (agentId && ctx.agentId && ctx.agentId !== agentId) return;

    const toolName = ctx.toolName as string;
    const jid = ctx.jid as string;
    if (!jid) return;

    // Check if this JID belongs to our transport
    const key = `${transport.platform}:${jid}`;
    if (!activeJids.has(key)) return;

    if (!longRunningTools.has(toolName)) return;

    // The interval loop handles continuous refresh, but send an extra
    // immediate pulse after a long-running tool completes to avoid any gap.
    if (transport.sendTypingIndicator) {
      const address: ChatAddress = { platform: transport.platform, id: jid };
      await transport.sendTypingIndicator(address).catch(() => {});
    }
  });

  const unregisterAgentEnd = hookRegistry.register("agent_end", async (ctx) => {
    if (agentId && ctx.agentId && ctx.agentId !== agentId) return;
    const jid = ctx.jid as string;
    if (!jid) return;
    const key = `${transport.platform}:${jid}`;
    stopTypingLoop(key);
    activeJids.delete(key);
  });

  return () => {
    unregisterBeforeAgent();
    unregisterAfterTool();
    unregisterAgentEnd();
    // Clean up any lingering intervals
    for (const [_key, interval] of typingIntervals) {
      clearInterval(interval);
    }
    typingIntervals.clear();
    activeJids.clear();
  };
}
