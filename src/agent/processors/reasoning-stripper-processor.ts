/**
 * ReasoningStripperProcessor — strips wasteful metadata from assistant
 * messages before they are persisted to conversation history:
 *
 * 1. Encrypted reasoning blocks (Gemini) — can't be decoded, pure waste
 * 2. providerMetadata (OpenRouter) — carries duplicate reasoning + provider internals
 */
import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";

export class ReasoningStripperProcessor implements Processor {
  id = "reasoning-stripper";

  async processOutputResult({ messages }: {
    messages: MastraDBMessage[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<MastraDBMessage[]> {
    return messages.map(msg => {
      if (msg.role !== "assistant") return msg;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = msg.content as any;
      if (!content || typeof content !== "object") return msg;

      let changed = false;
      let newContent = content;

      // Strip reasoning parts and providerMetadata from parts array
      if (Array.isArray(content.parts)) {
        const filtered = content.parts
          .filter((part: { type?: string }) => part.type !== "reasoning")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((part: any) => {
            if (part.providerMetadata) {
              const { providerMetadata: _, ...rest } = part;
              changed = true;
              return rest;
            }
            return part;
          });
        if (filtered.length !== content.parts.length) changed = true;
        if (changed) newContent = { ...newContent, parts: filtered };
      }

      // Strip top-level providerMetadata
      if (newContent.providerMetadata) {
        const { providerMetadata: _, ...rest } = newContent;
        newContent = rest;
        changed = true;
      }

      return changed ? { ...msg, content: newContent } as MastraDBMessage : msg;
    });
  }
}
