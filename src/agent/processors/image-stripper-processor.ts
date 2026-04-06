/**
 * ImageStripperProcessor — strips base64 image/file data from messages
 * before they are persisted to conversation history.
 *
 * Runs as an output processor AFTER the model has seen the image.
 * Replaces image parts with a text placeholder so subsequent turns
 * don't replay massive base64 blobs (100-200KB per image).
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

  async processOutputResult({ messages }: {
    messages: MastraDBMessage[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<MastraDBMessage[]> {
    return this.stripImages(messages);
  }

  async processInputStep({ messages }: {
    messages: MastraDBMessage[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<MastraDBMessage[]> {
    return this.stripImages(messages);
  }
}
