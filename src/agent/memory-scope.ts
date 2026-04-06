import { makeThreadId } from "../transport/address-utils.js";
import type { Platform } from "../transport/types.js";

export type MemoryPromptMode = "full" | "autonomous" | "proactive";

interface MemoryScopeParams {
  platform: Platform;
  /** The chat ID (group or 1:1). Determines conversation thread. */
  chatId?: string;
  /** The owner's user ID. Determines working memory resource scope.
   *  If omitted, falls back to chatId (1:1 behavior). */
  ownerId?: string;
  promptMode: MemoryPromptMode;
  agentId?: string;
}

interface MemoryScopeResult {
  thread: string;
  resource: string;
}

/**
 * Build scoped memory IDs for Mastra memory.
 *
 * - thread: per-chat conversation history (different for 1:1 vs group)
 * - resource: per-owner working memory (same across all chats with that owner)
 *
 * In 1:1 chats, thread === resource (chatId === ownerId).
 * In group chats, thread uses groupId, resource uses ownerId —
 * so working memory follows the user across chats.
 */
export function buildMemoryScope(params: MemoryScopeParams): MemoryScopeResult {
  const chatBase = params.chatId
    ? makeThreadId({ platform: params.platform, id: params.chatId })
    : "default";

  const ownerBase = params.ownerId
    ? makeThreadId({ platform: params.platform, id: params.ownerId })
    : chatBase; // fallback to chat-scoped if no ownerId

  // Group chats: shared thread across all agents (so they see each other's messages).
  // 1:1 chats: per-agent thread (isolated conversations).
  const isGroup = params.chatId && params.ownerId && params.chatId !== params.ownerId;
  const thread = isGroup
    ? `group-${chatBase}`                                                    // shared for all agents in this group
    : (params.agentId ? `${params.agentId}-${chatBase}` : chatBase);         // per-agent for 1:1
  // Resource (working memory) is always per-agent per-owner.
  const resource = params.agentId ? `${params.agentId}-${ownerBase}` : ownerBase;

  return { thread, resource };
}
