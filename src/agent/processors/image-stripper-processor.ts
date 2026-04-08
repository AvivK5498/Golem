/**
 * ImageStripperProcessor — strips base64 image/file data from recalled history
 * so old images don't bloat the context window on subsequent turns.
 *
 * - processInputStep: strips images from RECALLED history messages only,
 *   preserving the current user message's image so the LLM can see it.
 * - processOutputResult: strips all images before persisting to memory.
 */
import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";

export class ImageStripperProcessor implements Processor {
  id = "image-stripper";

  private stripImages(messages: MastraDBMessage[]): MastraDBMessage[] {
    return messages.map(msg => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = msg.content as any;
      if (!content || typeof content !== "object") return msg;

      // Format 1: structured with parts array { format: 2, parts: [...] }
      if (Array.isArray(content.parts)) {
        let changed = false;
        const newParts = content.parts.map((part: { type?: string; data?: string; mimeType?: string }) => {
          if (part.type === "file" && part.data && part.data.length > 1000) {
            changed = true;
            return { type: "text", text: "[Image was shared and processed by the model]" };
          }
          if (part.type === "image" && part.data && part.data.length > 1000) {
            changed = true;
            return { type: "text", text: "[Image was shared and processed by the model]" };
          }
          return part;
        });
        if (changed) {
          return { ...msg, content: { ...content, parts: newParts } } as MastraDBMessage;
        }
      }

      // Format 2: direct array of content objects
      if (Array.isArray(content)) {
        let changed = false;
        const newContent = content.map((part: { type?: string; image?: unknown; data?: string }) => {
          if ((part.type === "image" || part.type === "file") && (part.image || (part.data && part.data.length > 1000))) {
            changed = true;
            return { type: "text", text: "[Image was shared and processed by the model]" };
          }
          return part;
        });
        if (changed) {
          return { ...msg, content: newContent } as unknown as MastraDBMessage;
        }
      }

      return msg;
    });
  }

  /** Strip all images before persisting to memory. */
  async processOutputResult({ messages }: {
    messages: MastraDBMessage[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<MastraDBMessage[]> {
    return this.stripImages(messages);
  }

  /**
   * Strip images from recalled history only — preserve the latest user message
   * so the LLM can see the current image on step 0.
   */
  async processInputStep({ messages, stepNumber }: {
    messages: MastraDBMessage[];
    stepNumber?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<MastraDBMessage[]> {
    // On step 0: strip all EXCEPT the last user message (the current one with the image)
    if ((stepNumber ?? 0) === 0 && messages.length > 0) {
      const lastUserIdx = messages.findLastIndex(m => (m as { role?: string }).role === "user");
      if (lastUserIdx >= 0) {
        const before = this.stripImages(messages.slice(0, lastUserIdx));
        const current = messages[lastUserIdx]; // keep as-is
        const after = this.stripImages(messages.slice(lastUserIdx + 1));
        return [...before, current, ...after];
      }
    }
    // On step 1+: strip everything (the LLM already saw it on step 0)
    return this.stripImages(messages);
  }
}
