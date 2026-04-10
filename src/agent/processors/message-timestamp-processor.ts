/**
 * MessageTimestampProcessor — prepends a relative timestamp to each historical
 * user message so the agent can reason about per-message timing, not just the
 * "gap to the previous turn" that the system prompt already provides.
 *
 * Lifecycle:
 * - processInput: runs once per turn, before the LLM call. Walks the messages
 *   array, finds user messages, prepends `[3 days ago] ` (etc.) to the first
 *   text part. Returns NEW message objects so persistence is unaffected.
 *
 * Skipped:
 * - When the agent's tempo setting is off (gated by `memoryTempoEnabled` on
 *   requestContext, set by AgentRunner per-turn).
 * - The most recent user message (the current turn — "just now" is noise).
 * - Assistant messages (only user message timing is what matters for tempo).
 * - Messages without createdAt or with non-parts content shapes.
 *
 * The DB stays clean: this transformation runs in-memory between recall and
 * the model call, never reaching storage.
 */
import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";
import { formatElapsedHuman } from "../../memory/smart-recall.js";

export class MessageTimestampProcessor implements Processor {
  id = "message-timestamp";

  async processInput({ messages, requestContext }: {
    messages: MastraDBMessage[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- requestContext shape varies
    requestContext?: { get: (key: string) => any };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<MastraDBMessage[]> {
    // Gate: only run when tempo awareness is enabled for this agent.
    if (!requestContext?.get("memoryTempoEnabled")) return messages;

    // Identify the most recent user message — that's the "current turn",
    // which we never stamp (no "ago" for now).
    const lastUserIdx = findLastUserIdx(messages);
    if (lastUserIdx < 0) return messages;

    const now = Date.now();
    let changed = false;
    const out: MastraDBMessage[] = messages.map((msg, idx) => {
      // Skip the current turn and any non-user messages.
      if (idx === lastUserIdx) return msg;
      if ((msg as { role?: string }).role !== "user") return msg;

      // Need a real createdAt to compute the delta.
      const createdAtRaw = (msg as { createdAt?: Date | string }).createdAt;
      if (!createdAtRaw) return msg;
      const createdAt = createdAtRaw instanceof Date ? createdAtRaw : new Date(createdAtRaw);
      const elapsedMs = now - createdAt.getTime();
      // Suppress sub-minute markers — too noisy and adds tokens for nothing.
      if (elapsedMs < 60_000) return msg;
      const marker = `[${formatElapsedHuman(elapsedMs)} ago] `;

      // Walk parts; prepend the marker to the FIRST text part. Don't touch
      // tool calls, images, or anything else.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- content shape varies
      const content = msg.content as any;
      if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
        return msg;
      }
      let prepended = false;
      const newParts = content.parts.map((part: { type?: string; text?: string }) => {
        if (!prepended && part.type === "text" && typeof part.text === "string") {
          prepended = true;
          // Don't double-stamp if the marker is already there (defense in depth).
          if (part.text.startsWith("[") && part.text.includes(" ago] ")) return part;
          return { ...part, text: marker + part.text };
        }
        return part;
      });
      if (!prepended) return msg;
      changed = true;
      return { ...msg, content: { ...content, parts: newParts } } as MastraDBMessage;
    });

    return changed ? out : messages;
  }
}

function findLastUserIdx(messages: MastraDBMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as { role?: string }).role === "user") return i;
  }
  return -1;
}
