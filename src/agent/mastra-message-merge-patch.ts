import { MessageMerger } from "@mastra/core/agent/message-list";

let applied = false;

/**
 * Mastra 1.15.0 can merge a fresh assistant response into the most recent
 * memory-loaded assistant message even when the two messages have different
 * IDs. That can surface a previous turn's text as the current result.
 *
 * Upstream tracked this in mastra-ai/mastra#9370 and proposed the same guard
 * in PR #9396. Apply it locally until the dependency ships an equivalent fix.
 */
export function applyMastraMessageMergePatch(): void {
  if (applied) return;

  const originalShouldMerge = MessageMerger.shouldMerge.bind(MessageMerger);

  MessageMerger.shouldMerge = function patchedShouldMerge(
    latestMessage,
    incomingMessage,
    messageSource,
    isLatestFromMemory,
    agentNetworkAppend = false,
  ) {
    const shouldMerge = originalShouldMerge(
      latestMessage,
      incomingMessage,
      messageSource,
      isLatestFromMemory,
      agentNetworkAppend,
    );

    if (!shouldMerge) return false;

    // Never append a fresh response onto a memory-restored assistant message
    // unless they're explicitly the same message ID.
    if (
      isLatestFromMemory &&
      latestMessage?.id &&
      incomingMessage?.id &&
      latestMessage.id !== incomingMessage.id
    ) {
      return false;
    }

    return true;
  };

  applied = true;
}
