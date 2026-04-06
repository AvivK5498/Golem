import type { ChatAddress } from "./types.js";

/**
 * Create a composite thread ID from a ChatAddress.
 * Format: "{platform}:{id}" (e.g., "telegram:123456789")
 */
export function makeThreadId(addr: ChatAddress): string {
  return `${addr.platform}:${addr.id}`;
}

/**
 * Parse a composite thread ID back into a ChatAddress.
 * Falls back to { platform: "telegram", id: raw } for legacy bare-ID strings.
 */
export function parseThreadId(raw: string): ChatAddress {
  const idx = raw.indexOf(":");
  if (idx > 0) {
    const platform = raw.slice(0, idx);
    if (platform === "telegram") {
      return { platform, id: raw.slice(idx + 1) };
    }
  }
  // Legacy bare ID - assume Telegram
  return { platform: "telegram", id: raw };
}

/**
 * Get the owner's ChatAddress from config.
 * Uses Telegram ownerId.
 */
/**
 * Get the owner's ChatAddress.
 * Accepts a config-like object that may have a `telegram` field (legacy)
 * or any other shape. Returns a fallback address when telegram is not configured.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOwnerAddress(config: Record<string, any>): ChatAddress {
  if (config.telegram?.enabled && config.telegram.ownerId) {
    return { platform: "telegram", id: String(config.telegram.ownerId) };
  }
  // Fallback - should not happen if config is valid
  return { platform: "telegram", id: "" };
}
