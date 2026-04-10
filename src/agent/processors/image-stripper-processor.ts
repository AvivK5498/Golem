/**
 * ImageStripperProcessor — strips base64 image/file data from messages so old
 * images don't bloat the context window on subsequent turns.
 *
 * Lifecycle:
 * - processInputStep (step 0): strips images from recalled history but
 *   PRESERVES the current user message so the LLM can see the new image.
 * - processInputStep (step 1+): strips everything (LLM already saw it on step 0).
 * - processOutputStep: runs after every LLM step. Strips images from ALL
 *   messages including the user input. By the time this fires, the LLM has
 *   already seen the input on the current step, so stripping is safe and it
 *   ensures the user input message is persisted to memory WITHOUT the base64
 *   blob (which would otherwise consume ~119K tokens per recalled image and
 *   blow Mastra's TokenLimiterProcessor budget on the next turn).
 * - processOutputResult: strips images from response messages before save.
 *   (Mastra only passes response messages to processOutputResult — input
 *   messages are handled by processOutputStep above.)
 */
import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";

const IMAGE_PLACEHOLDER = "[Image was shared and processed by the model]";

export class ImageStripperProcessor implements Processor {
  id = "image-stripper";

  private stripImages(messages: MastraDBMessage[]): MastraDBMessage[] {
    return messages.map(msg => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = msg.content as any;
      if (!content || typeof content !== "object") return msg;

      // Format 2: direct array of content objects (AI SDK input format)
      if (Array.isArray(content)) {
        let changed = false;
        const newContent = content.map((part: { type?: string; image?: unknown; data?: string }) => {
          if ((part.type === "image" || part.type === "file") && (part.image || (part.data && part.data.length > 1000))) {
            changed = true;
            return { type: "text", text: IMAGE_PLACEHOLDER };
          }
          return part;
        });
        if (changed) {
          return { ...msg, content: newContent } as unknown as MastraDBMessage;
        }
        return msg;
      }

      // Format 1 + Format 3: object form — may contain `parts` (file parts),
      // `experimental_attachments` (AI SDK v5 persisted attachments), or both.
      // We strip both into the same placeholder text so recalled history is
      // identical regardless of how the image originally entered memory.
      let changed = false;
      let newContent = content;

      // Strip file/image parts → placeholder text
      if (Array.isArray(content.parts)) {
        let partsChanged = false;
        const newParts = content.parts.map((part: { type?: string; data?: string; mimeType?: string }) => {
          if ((part.type === "file" || part.type === "image") && part.data && part.data.length > 1000) {
            partsChanged = true;
            return { type: "text", text: IMAGE_PLACEHOLDER };
          }
          return part;
        });
        if (partsChanged) {
          changed = true;
          newContent = { ...newContent, parts: newParts };
        }
      }

      // Strip experimental_attachments carrying base64 data URLs. Mastra
      // persists these alongside `parts`, and on recall it rebuilds them as
      // file parts in the LLM input — defeating the parts-side strip above
      // unless we also clear them here.
      if (Array.isArray(content.experimental_attachments)) {
        const orig = content.experimental_attachments;
        const kept = orig.filter((att: { url?: string }) =>
          !att?.url || !att.url.startsWith("data:") || att.url.length <= 1000
        );
        if (kept.length !== orig.length) {
          changed = true;
          // Ensure the parts array surfaces the placeholder text so the agent
          // still sees the image signal in conversation history.
          const basisParts = Array.isArray(newContent.parts) ? newContent.parts : [];
          const hasPlaceholder = basisParts.some(
            (p: { type?: string; text?: string }) => p?.type === "text" && p.text === IMAGE_PLACEHOLDER,
          );
          const partsWithPlaceholder = hasPlaceholder
            ? basisParts
            : [{ type: "text", text: IMAGE_PLACEHOLDER }, ...basisParts];
          const next = { ...newContent, parts: partsWithPlaceholder };
          if (kept.length > 0) {
            next.experimental_attachments = kept;
          } else {
            delete next.experimental_attachments;
          }
          newContent = next;
        }
      }

      return changed ? ({ ...msg, content: newContent } as MastraDBMessage) : msg;
    });
  }

  /** Strip all images from response messages before persisting to memory. */
  async processOutputResult({ messages }: {
    messages: MastraDBMessage[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<MastraDBMessage[]> {
    return this.stripImages(messages);
  }

  /**
   * After every LLM step, strip images from ALL messages in the messageList
   * (including the user input). At this point the LLM has already consumed the
   * image on the current step, so it's safe to strip. This guarantees that
   * when Mastra persists unsaved messages at the end of the run, the user
   * input message no longer carries the base64 blob.
   */
  async processOutputStep({ messages }: {
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
