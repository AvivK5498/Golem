import type { ChatAddress } from "./types.js";

/**
 * Create a composite thread ID from a ChatAddress.
 * Format: "{platform}:{id}" (e.g., "telegram:123456789")
 */
export function makeThreadId(addr: ChatAddress): string {
  return `${addr.platform}:${addr.id}`;
}
