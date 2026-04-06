/**
 * Continuity Processor
 *
 * Step 0: no-op (full system prompt is correct, TokenLimiterProcessor handles budget)
 * Step 1+: replace system messages with a lean continuation prompt.
 *          Drops persona/invariant/media/OM, preserves skill/workspace/tool-discovery messages.
 *          Never touches conversation messages — TokenLimiterProcessor handles that natively
 *          since Mastra 1.12.0 (runs processInputStep at every step).
 *
 * Only active for owner chatType with promptMode "full".
 */
import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
  Processor,
} from "@mastra/core/processors";
import type { CoreMessage } from "@mastra/core/llm";
import { formatTaskList } from "../task-state.js";

export class ContinuityProcessor implements Processor {
  readonly id = "continuity-processor";
  readonly name = "Continuity Processor";

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult | void {
    if (!this.shouldRun(args)) return;

    // Step 0: no-op. Full prompt is correct.
    if (args.stepNumber <= 0) return;

    return this.processFollowupStep(args);
  }

  private shouldRun(args: ProcessInputStepArgs): boolean {
    const chatType = args.requestContext?.get("chatType" as never) as string | undefined;
    const promptMode = args.requestContext?.get("promptMode" as never) as string | undefined;
    return chatType === "owner" && (promptMode == null || promptMode === "full");
  }

  private processFollowupStep(args: ProcessInputStepArgs): ProcessInputStepResult {
    // Only replace system messages. Never touch conversation messages.
    // TokenLimiterProcessor (Mastra 1.12.0+) handles message budget per-step natively.
    const currentSystemMessages = this.getCurrentSystemMessages(args);
    const systemMessages = this.buildLeanSystemMessages(args, currentSystemMessages);

    console.log(
      `[continuity] Step ${args.stepNumber}: system ${currentSystemMessages.length}→${systemMessages.length} chars ${this.countSystemChars(currentSystemMessages)}→${this.countSystemChars(systemMessages)}`,
    );

    return { systemMessages };
  }

  // ---------------------------------------------------------------------------
  // Lean system prompt builder
  // ---------------------------------------------------------------------------

  private buildLeanSystemMessages(args: ProcessInputStepArgs, currentSystemMessages: CoreMessage[]): CoreMessage[] {
    const nowLocal = args.requestContext?.get("nowLocal" as never) as string | undefined;
    const timezone = args.requestContext?.get("timezone" as never) as string | undefined;
    const workspaceRoot = this.extractWorkspaceRoot(currentSystemMessages);
    const preservedSystemMessages = this.extractPreservedSystemMessages(currentSystemMessages);

    const lines = [
      "Continuation step for the same user request.",
      "Keep the same tone and language as earlier messages.",
      "",
      "## Rules",
      "- Act first, ask only when genuinely ambiguous.",
      "- Never claim completion unless the tool result confirmed it this turn.",
      "- On error: report briefly, fix, retry. Don't abandon after one failure.",
      "- Do not restart the task. Treat recent tool results as source of truth.",
      "",
      "## Efficiency",
      "- Parallelize aggressively. If multiple independent calls are needed, make them all in one step.",
      "- Plan your step budget. Reserve the last step for the final answer.",
      "- If you used steps inefficiently (sequential calls that could have been parallel, unnecessary reads), briefly note it at the end so the owner can optimize.",
      "",
      "## Delegation",
      "- Delegate to sub-agents when one matches. Use workspace tools directly for file ops.",
      "- If a sub-agent is already handling this task, let it finish.",
      "",
      "## Safety",
      "- Changes to Golem's own source code require the user's approval.",
    ];

    if (workspaceRoot) {
      lines.push(`Workspace root: ${workspaceRoot}`);
    }
    if (nowLocal) {
      lines.push(`Current time: ${nowLocal}${timezone ? ` (${timezone})` : ""}`);
    }

    const jid = args.requestContext?.get("jid" as never) as string | undefined;
    if (jid) {
      const taskBlock = formatTaskList(jid);
      if (taskBlock) {
        lines.push(taskBlock);
      }
    }

    return [
      {
        role: "system",
        content: lines.join("\n"),
      },
      ...preservedSystemMessages,
    ];
  }

  // ---------------------------------------------------------------------------
  // System message helpers
  // ---------------------------------------------------------------------------

  private getCurrentSystemMessages(args: ProcessInputStepArgs): CoreMessage[] {
    const liveSystemMessages = args.messageList?.getAllSystemMessages?.();
    return Array.isArray(liveSystemMessages) ? liveSystemMessages : args.systemMessages;
  }

  private extractWorkspaceRoot(systemMessages: CoreMessage[]): string | null {
    for (const message of systemMessages) {
      const text = this.extractCoreMessageText(message);
      if (!text) continue;
      const match = text.match(/Local filesystem at "([^"]+)"/);
      if (match?.[1]) {
        return match[1];
      }
    }
    return null;
  }

  private extractPreservedSystemMessages(systemMessages: CoreMessage[]): CoreMessage[] {
    return systemMessages.filter((message) => {
      const text = this.extractCoreMessageText(message);
      if (!text) return true;
      return !this.isReplaceableBaseSystemMessage(text);
    });
  }

  private isReplaceableBaseSystemMessage(text: string): boolean {
    return (
      this.isPersonaMessage(text) ||
      this.isInvariantMessage(text) ||
      this.isMediaMessage(text) ||
      this.isObservationalMemoryMessage(text)
    );
  }

  private isPersonaMessage(text: string): boolean {
    return (
      text.includes("## Identity") &&
      text.includes("## Personality")
    );
  }

  private isInvariantMessage(text: string): boolean {
    return (
      text.includes("## Delegation") &&
      text.includes("## Behavior")
    );
  }

  private isMediaMessage(text: string): boolean {
    return text.includes("For image/media requests, deliver the actual file using send_media.");
  }

  private isObservationalMemoryMessage(text: string): boolean {
    return text.includes("The following observations block contains") || text.includes("<observations>");
  }

  // ---------------------------------------------------------------------------
  // Text extraction
  // ---------------------------------------------------------------------------

  private extractCoreMessageText(message: CoreMessage): string {
    const content = message.content;
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (part == null || typeof part !== "object") return "";
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    if (content == null || typeof content !== "object") {
      return "";
    }

    const record = content as { parts?: unknown[]; content?: unknown };
    if (Array.isArray(record.parts)) {
      return record.parts
        .map((part) => {
          if (part == null || typeof part !== "object") return "";
          const text = (part as { text?: unknown }).text;
          return typeof text === "string" ? text : "";
        })
        .filter(Boolean)
        .join("\n")
        .trim();
    }

    return typeof record.content === "string" ? record.content.trim() : "";
  }

  private countSystemChars(messages: CoreMessage[]): number {
    return messages.reduce((total, message) => {
      return total + this.extractCoreMessageText(message).length;
    }, 0);
  }
}
