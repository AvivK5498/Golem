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
    const promptMode = requestContext?.get("promptMode" as never) as string | undefined;

    // Build a lookup of toolName + args by toolCallId from assistant tool-invocation parts,
    // so standalone role:"tool" result messages (AI SDK v6 shape) can be paired with the
    // originating call instead of logging with "unknown" name.
    const callByToolCallId = new Map<string, { toolName: string; args: unknown }>();
    for (const msg of messages) {
      if (msg.role !== "assistant" || !msg.content?.parts) continue;
      for (const part of msg.content.parts) {
        const typedPart = part as unknown as ToolInvocationPart;
        if (typedPart.type !== "tool-invocation" || !typedPart.toolInvocation) continue;
        const { toolCallId, toolName, args } = typedPart.toolInvocation;
        if (toolCallId && toolName) {
          callByToolCallId.set(toolCallId, { toolName, args });
        }
      }
    }

    for (const [msgIdx, msg] of messages.entries()) {
      // Shape A: assistant message with content.parts carrying tool-invocation parts
      if (msg.role === "assistant" && msg.content?.parts) {
        for (const [partIndex, part] of msg.content.parts.entries()) {
          const typedPart = part as unknown as ToolInvocationPart;
          if (typedPart.type !== "tool-invocation") continue;
          const toolInvocation = typedPart.toolInvocation;
          if (!toolInvocation) continue;
          const { toolCallId, toolName, args, result } = toolInvocation;
          if (!toolName) continue;
          this.emitLog({
            jid, promptMode,
            createdAt: msg.createdAt,
            messageId: msg.id,
            partIndex,
            toolCallId,
            toolName,
            args,
            result,
          });
        }
        continue;
      }

      // Shape B: standalone role="tool" message with string or parts content
      if ((msg.role as string) === "tool") {
        const rawContent = (msg as { content?: unknown }).content;
        // String content = raw result payload; pair via toolCallId if present on msg.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolCallId = (msg as any).toolCallId as string | undefined;
        const pairing = toolCallId ? callByToolCallId.get(toolCallId) : undefined;
        const toolName = pairing?.toolName ?? "tool_result";
        const args = pairing?.args;

        if (typeof rawContent === "string") {
          this.emitLog({
            jid, promptMode,
            createdAt: msg.createdAt,
            messageId: msg.id,
            partIndex: msgIdx,
            toolCallId,
            toolName,
            args,
            result: rawContent,
          });
          continue;
        }

        // Array / object content: iterate for tool-result parts
        const contentAsObj = rawContent as { parts?: unknown[] } | unknown[] | null;
        const partsArr = Array.isArray(contentAsObj)
          ? (contentAsObj as unknown[])
          : (contentAsObj?.parts as unknown[] | undefined) ?? [];
        for (const [partIndex, part] of partsArr.entries()) {
          const p = part as { type?: string; result?: unknown; toolCallId?: string; toolName?: string };
          if (p.type !== "tool-result" && p.type !== "text") continue;
          const pairForPart = p.toolCallId ? callByToolCallId.get(p.toolCallId) : pairing;
          this.emitLog({
            jid, promptMode,
            createdAt: msg.createdAt,
            messageId: msg.id,
            partIndex,
            toolCallId: p.toolCallId ?? toolCallId,
            toolName: p.toolName ?? pairForPart?.toolName ?? toolName,
            args: pairForPart?.args ?? args,
            result: p.type === "text" ? (p as unknown as { text?: string }).text : p.result,
          });
        }
      }
    }

    return messages; // pass through unchanged
  }

  private emitLog(params: {
    jid?: string;
    promptMode?: string;
    createdAt?: Date | string;
    messageId?: string;
    partIndex: number;
    toolCallId?: string;
    toolName: string;
    args: unknown;
    result: unknown;
  }): void {
    const { jid, promptMode, createdAt, messageId, partIndex, toolCallId, toolName, args, result } = params;
    const timestamp = new Date().toISOString();
    const logPath = buildToolLogRelativePath({ createdAt, messageId, toolCallId, partIndex });
    const argsStr = toSafeLogString(args || {}, 140);
    const resultStr = toSafeLogString(result || {}, 140);
    console.log(
      `[tool] ${timestamp} ${jid || "unknown"} ${toolName}(${argsStr}) \u2192 ${resultStr}`,
    );
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
        messageId,
        toolCallId,
        toolName,
        args,
        result,
        logPath,
      }),
    });
    hookRegistry.emitSync("after_tool_call", {
      toolName,
      args,
      result: toSafeLogString(result || {}, 8_000),
      jid: jid || "",
      promptMode: promptMode || "",
    });
  }

  private logToFile(entry: Record<string, unknown>): void {
    pendingLogEntries.push(JSON.stringify(entry) + "\n");
    scheduleLogFlush();
  }
}

// ── Buffered log writer ───────────────────────────────────────────
// Batch disk I/O so 10 parallel tool calls don't become 10 sync syscalls in
// the hot path. Flushes every 500ms or on process exit.
const pendingLogEntries: string[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function scheduleLogFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushPendingLogs, 500);
  flushTimer.unref?.();
}

function flushPendingLogs(): void {
  flushTimer = null;
  if (pendingLogEntries.length === 0) return;
  const batch = pendingLogEntries.splice(0, pendingLogEntries.length).join("");
  try {
    const dir = dataPath(".");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    try {
      const stats = statSync(LOG_FILE);
      if (stats.size > 5 * 1024 * 1024) {
        renameSync(LOG_FILE, LOG_FILE + ".old");
      }
    } catch { /* file doesn't exist yet */ }
    appendFileSync(LOG_FILE, batch);
  } catch (err) {
    console.error(`[tool-logger] Failed to write log: ${err}`);
  }
}

process.on("beforeExit", flushPendingLogs);
