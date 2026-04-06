import type { ChatAddress } from "../transport/index.js";

export type ChatType = 'owner' | 'client' | 'unknown' | 'group';

/**
 * Check if an address represents a group chat.
 * Telegram: negative chat IDs indicate groups/channels
 */
function isGroupChat(address: ChatAddress): boolean {
  if (address.platform === "telegram") {
    const numericId = parseInt(address.id, 10);
    return !isNaN(numericId) && numericId < 0;
  }
  return false;
}

/** Per-agent config for classifyChat (platform architecture). */
export interface ClassifyChatConfig {
  ownerId: number;
  allowedGroups?: string[];
  adminGroups?: string[];
}

/**
 * Classify a chat based on the address.
 * @param address - The chat address (platform + id)
 * @param agentConfig - Per-agent config with ownerId for owner detection.
 */
export function classifyChat(address: ChatAddress, agentConfig?: ClassifyChatConfig): ChatType {
  // Group detection (platform-aware)
  if (isGroupChat(address)) return 'group';

  // Telegram owner matching (requires per-agent config)
  if (address.platform === "telegram" && agentConfig) {
    if (address.id === String(agentConfig.ownerId)) return 'owner';
  }

  // All other individual chats are 'unknown'
  return 'unknown';
}
