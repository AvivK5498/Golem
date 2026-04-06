import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/agent";
import type { RequestContext } from "@mastra/core/request-context";
import { appendFileSync, mkdirSync, existsSync, statSync, renameSync } from "fs";
import { dataPath } from "../../utils/paths.js";
import { toSafeLogString } from "../log-redaction.js";
import {
  buildToolLogRelativePath,
  createToolLogEntry,
  writeToolLogArtifact,
} from "../tool-log-artifacts.js";
import { hookRegistry } from "../../hooks/index.js";

const LOG_FILE = dataPath("tool-calls.log");

interface ToolInvocationPart {
  type: string;
  toolInvocation?: {
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    result?: unknown;
  };
}

/**
 * Logs every tool invocation to console and file for debugging.
 * Placed BEFORE ToolResultSanitizer in the pipeline to capture original results.
 */
export class ToolExecutionLogger implements Processor {
  readonly id = "tool-execution-logger";

  processOutputResult({
    messages,
    requestContext,
  }: {
    messages: MastraDBMessage[];
    requestContext?: RequestContext;
  }): MastraDBMessage[] {
    const jid = requestContext?.get("jid" as never) as string | undefined;

    for (const msg of messages) {
      if (msg.role !== "assistant" || !msg.content?.parts) continue;

      for (const [partIndex, part] of msg.content.parts.entries()) {
        const typedPart = part as unknown as ToolInvocationPart;
        if (typedPart.type !== "tool-invocation") continue;

        const toolInvocation = typedPart.toolInvocation;
        if (!toolInvocation) continue;

        const { toolCallId, toolName, args, result } = toolInvocation;
        if (!toolName) continue;
        const timestamp = new Date().toISOString();
        const logPath = buildToolLogRelativePath({
          createdAt: msg.createdAt,
          messageId: msg.id,
          toolCallId,
          partIndex,
        });

        // Console log with truncation
        const argsStr = toSafeLogString(args || {}, 140);
        const resultStr = toSafeLogString(result || {}, 140);
        console.log(
          `[tool] ${timestamp} ${jid || "unknown"} ${toolName}(${argsStr}) → ${resultStr}`,
        );

        // File log with redacted details
        this.logToFile({
          timestamp,
          jid: jid || "unknown",
          toolName,
          args: toSafeLogString(args || {}, 4_000),
          result: toSafeLogString(result || {}, 8_000),
        });

        writeToolLogArtifact({
          relativePath: logPath,
          entry: createToolLogEntry({
            timestamp,
            jid,
            messageId: msg.id,
            toolCallId,
            toolName,
            args,
            result,
            logPath,
          }),
        });

        // Hooks: after_tool_call (fire-and-forget)
        const promptMode = requestContext?.get("promptMode" as never) as string | undefined;
        hookRegistry.emitSync("after_tool_call", {
          toolName,
          args,
          result: toSafeLogString(result || {}, 8_000),
          jid: jid || "",
          promptMode: promptMode || "",
        });
      }
    }

    return messages; // pass through unchanged
  }

  private logToFile(entry: Record<string, unknown>): void {
    try {
      const dir = "data";
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      // Rotate if file exceeds 5MB
      try {
        const stats = statSync(LOG_FILE);
        if (stats.size > 5 * 1024 * 1024) {
          renameSync(LOG_FILE, LOG_FILE + ".old");
        }
      } catch {
        // File doesn't exist yet — that's fine
      }
      appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
    } catch (err) {
      console.error(`[tool-logger] Failed to write log: ${err}`);
    }
  }
}
