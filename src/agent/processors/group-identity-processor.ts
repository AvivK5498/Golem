/**
 * GroupIdentityProcessor — prepends agent identity tag to assistant
 * messages in group chats before memory persistence.
 *
 * Runs as an output processor BEFORE Mastra's MessageHistory saves.
 * Other agents sharing the same group thread can then see who said what.
 *
 * Example: "[Agent - assistant] Here is your answer."
 * The tag is stripped by the transport handler before sending to Telegram.
 */
import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";

export class GroupIdentityProcessor implements Processor {
  id = "group-identity";

  private agentName: string;
  private agentRole?: string;

  constructor(agentName: string, agentRole?: string) {
    this.agentName = agentName;
    this.agentRole = agentRole;
  }

  get tag(): string {
    return `[${this.agentName}${this.agentRole ? ` - ${this.agentRole}` : ""}]`;
  }

  async processOutputResult({ messages, requestContext }: {
    messages: MastraDBMessage[];
    requestContext?: { get: (key: string) => unknown };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<MastraDBMessage[]> {
    const chatType = requestContext?.get("chatType") as string | undefined;
    if (chatType !== "group") return messages;

    return messages.map(msg => {
      if (msg.role !== "assistant") return msg;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MastraDBMessage content varies
      const content = msg.content as any;

      // Fix #7: Handle all content formats
      // Format 1: structured with parts array
      if (content && typeof content === "object" && Array.isArray(content.parts)) {
        const newParts = content.parts.map((part: { type?: string; text?: string }) => {
          if (part.type === "text" && typeof part.text === "string") {
            return { ...part, text: `${this.tag} ${part.text}` };
          }
          return part;
        });
        return { ...msg, content: { ...content, parts: newParts } } as MastraDBMessage;
      }
      // Format 2: direct array of content objects
      if (Array.isArray(content)) {
        const newContent = content.map((part: { type?: string; text?: string }) => {
          if (part.type === "text" && typeof part.text === "string") {
            return { ...part, text: `${this.tag} ${part.text}` };
          }
          return part;
        });
        return { ...msg, content: newContent } as unknown as MastraDBMessage;
      }

      return msg;
    });
  }
}

/**
 * Strip agent identity tag from a response before sending to user.
 * Fix #6: Use exact agent name matching, not a broad regex.
 */
export function stripGroupIdentityTag(text: string, agentName?: string, agentRole?: string): string {
  if (agentName) {
    // Exact match for this agent's tag
    const escaped = `${agentName}${agentRole ? ` - ${agentRole}` : ""}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(`^\\[${escaped}\\]\\s*`), "");
  }
  // Fallback: match [Name] or [Name - Role] at start of string only
  // Restrictive: requires at least one letter, no nested brackets
  return text.replace(/^\[[A-Za-z][\w\s]*(?:\s-\s[\w\s]+)?\]\s*/, "");
}
