import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/agent";
import {
  TOOL_LOG_INLINE_RESULT_CHARS,
  buildToolLogRelativePath,
  buildToolResultMemorySummary,
  createToolLogEntry,
  isLargeToolResult,
  writeToolLogArtifact,
} from "../tool-log-artifacts.js";

interface SanitizerPart {
  type?: string;
  text?: string;
  toolInvocation?: {
    state?: string;
    toolCallId?: string;
    toolName?: string;
    args?: Record<string, unknown>;
    result?: unknown;
  };
}

/**
 * Sanitizes tool results in two phases:
 *
 * 1. processInputStep — recall-only. Sanitizes only messages from PRIOR turns
 *    (before the current user message). Current-turn tool results stay full
 *    so the agent can reason over what it just generated without trying to
 *    re-read its own tool-log artifacts.
 *
 * 2. processOutputResult — sanitizes tool results AFTER the turn completes,
 *    before they are persisted back to memory. This reduces DB bloat for
 *    future recalls.
 */
export class ToolResultSanitizer implements Processor {
  readonly id = "tool-result-sanitizer";
  private readonly maxInlineResultChars: number;

  constructor(maxInlineResultChars = TOOL_LOG_INLINE_RESULT_CHARS) {
    this.maxInlineResultChars = maxInlineResultChars;
  }

  processInputStep({
    messages,
  }: {
    messages: MastraDBMessage[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): MastraDBMessage[] {
    let sanitizedCount = 0;
    const currentTurnStart = this.findCurrentTurnStart(messages);

    const result = messages.map((msg, index) => {
      if (msg.role === "system" || msg.role === "user") return msg;
      // Anything in the current turn (after the latest user message) is fresh
      // — the agent just generated these and needs the full payload visible.
      if (currentTurnStart >= 0 && index > currentTurnStart) return msg;
      if (!this.hasSanitizablePayload(msg)) return msg;

      sanitizedCount++;
      return this.sanitizeMessage(msg);
    });

    if (sanitizedCount > 0) {
      console.log(`[tool-sanitizer] Sanitized ${sanitizedCount} recalled message(s) on input`);
    }
    return result;
  }

  processOutputResult({
    messages,
  }: {
    messages: MastraDBMessage[];
  }): MastraDBMessage[] {
    return messages.map((msg) => this.sanitizeMessage(msg));
  }

  private sanitizeMessage(msg: MastraDBMessage): MastraDBMessage {
    const rawContent = (msg as { content?: unknown }).content;
    if (typeof rawContent === "string") {
      if ((msg.role as string) !== "tool" || !isLargeToolResult(rawContent, this.maxInlineResultChars)) {
        return msg;
      }

      return {
        ...(msg as Record<string, unknown>),
        content: this.sanitizeTextPayload(msg, 0, rawContent),
      } as unknown as MastraDBMessage;
    }

    const content = rawContent as { parts?: unknown[]; [key: string]: unknown } | undefined;
    if (!Array.isArray(content?.parts)) return msg;

    const sanitizedParts = content.parts.map((rawPart, partIndex: number) => {
      const part = rawPart as SanitizerPart;
      if (part.type !== "tool-invocation") return part;

      const toolInvocation = part.toolInvocation;
      if (!toolInvocation) return part;

      const { toolName, args, result, toolCallId } = toolInvocation;
      if (!isLargeToolResult(result, this.maxInlineResultChars)) {
        return part;
      }

      const logPath = buildToolLogRelativePath({
        createdAt: msg.createdAt,
        messageId: msg.id,
        toolCallId,
        partIndex,
      });
      const sanitized = this.sanitizeToolResult(toolName || "unknown", args, result, logPath, msg.id, toolCallId);

      // Keep as tool-invocation with sanitized result instead of converting to text.
      // This prevents sanitized results from appearing in response.text
      // (Mastra only extracts type:"text" parts for response text)
      return {
        ...part,
        toolInvocation: {
          ...toolInvocation,
          result: sanitized,
        },
      };
    });

    const textSanitizedParts = sanitizedParts.map((rawPart, partIndex: number) => {
      const part = rawPart as SanitizerPart;
      if ((msg.role as string) !== "tool" || part?.type !== "text" || typeof part.text !== "string") {
        return part;
      }
      if (!isLargeToolResult(part.text, this.maxInlineResultChars)) {
        return part;
      }

      return {
        ...part,
        text: this.sanitizeTextPayload(msg, partIndex, part.text),
      };
    });

    return {
      ...msg,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: { ...content, parts: textSanitizedParts as any[], toolInvocations: undefined } as any,
    };
  }

  private findCurrentTurnStart(messages: MastraDBMessage[]): number {
    return messages.findLastIndex((message) => message.role === "user");
  }

  private sanitizeToolResult(
    toolName: string,
    args: Record<string, unknown> | undefined,
    result: unknown,
    logPath: string,
    messageId?: string,
    toolCallId?: string,
  ): string {
    // Write the full tool result to disk so the agent can read it later if it
    // needs detail the summary didn't capture. Without this, the "Full log:
    // <path>" reference in the summary points at a file that doesn't exist,
    // and the agent cascades into file-not-found errors when it tries to cat.
    writeToolLogArtifact({
      relativePath: logPath,
      entry: createToolLogEntry({
        timestamp: new Date().toISOString(),
        messageId,
        toolCallId,
        toolName,
        args,
        result,
        logPath,
      }),
    });
    return buildToolResultMemorySummary({
      toolName,
      args,
      result,
      logPath,
    });
  }

  private hasSanitizablePayload(msg: MastraDBMessage): boolean {
    const rawContent = (msg as { content?: unknown }).content;
    if (typeof rawContent === "string") {
      return (msg.role as string) === "tool" && isLargeToolResult(rawContent, this.maxInlineResultChars);
    }

    const content = rawContent as { parts?: unknown[] } | undefined;
    if (!Array.isArray(content?.parts)) return false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MastraDBMessage parts type is complex
    return content.parts.some((part: any) => {
      if (part?.type === "tool-invocation") {
        return isLargeToolResult(part.toolInvocation?.result, this.maxInlineResultChars);
      }
      return (
        (msg.role as string) === "tool" &&
        part?.type === "text" &&
        typeof part.text === "string" &&
        isLargeToolResult(part.text, this.maxInlineResultChars)
      );
    });
  }

  private sanitizeTextPayload(
    msg: MastraDBMessage,
    partIndex: number,
    text: string,
  ): string {
    const toolName = this.inferToolName(msg);
    const toolCallId = this.inferToolCallId(msg, partIndex);
    const logPath = buildToolLogRelativePath({
      createdAt: msg.createdAt,
      messageId: msg.id,
      toolCallId,
      partIndex,
    });

    writeToolLogArtifact({
      relativePath: logPath,
      entry: createToolLogEntry({
        timestamp: new Date().toISOString(),
        messageId: msg.id,
        toolCallId,
        toolName,
        result: text,
        logPath,
      }),
    });

    return buildToolResultMemorySummary({
      toolName,
      result: text,
      logPath,
    });
  }

  private inferToolName(msg: MastraDBMessage): string {
    const record = msg as Record<string, unknown>;
    for (const key of ["toolName", "name"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return (msg.role as string) === "tool" ? "tool_result" : "unknown_tool";
  }

  private inferToolCallId(msg: MastraDBMessage, partIndex: number): string {
    const record = msg as Record<string, unknown>;
    for (const key of ["toolCallId", "tool_call_id"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return `part-${partIndex}`;
  }
}
