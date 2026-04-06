import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { redactSecretsInText, toSafeLogString } from "./log-redaction.js";

const TOOL_LOG_DIR = "./data/tool-logs";
const DEFAULT_INLINE_RESULT_CHARS = 500;

function toIsoDate(value: Date | string | undefined): string {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function sanitizePathSegment(value: string | undefined, fallback: string): string {
  const source = value?.trim() || fallback;
  return source.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function serializeValue(value: unknown): string {
  if (typeof value === "string") {
    return redactSecretsInText(value);
  }

  try {
    return redactSecretsInText(JSON.stringify(value, null, 2));
  } catch {
    return redactSecretsInText(String(value));
  }
}

export function estimateToolResultChars(result: unknown): number {
  return serializeValue(result).length;
}

export function isLargeToolResult(
  result: unknown,
  maxInlineChars = DEFAULT_INLINE_RESULT_CHARS,
): boolean {
  return estimateToolResultChars(result) > maxInlineChars;
}

export function buildToolLogRelativePath(params: {
  createdAt?: Date | string;
  messageId?: string;
  toolCallId?: string;
  partIndex?: number;
}): string {
  const dateSegment = toIsoDate(params.createdAt);
  const messageId = sanitizePathSegment(params.messageId, "message");
  const toolCallId = sanitizePathSegment(
    params.toolCallId,
    `part-${params.partIndex ?? 0}`,
  );
  return `${TOOL_LOG_DIR}/${dateSegment}/${messageId}__${toolCallId}.json`;
}

export function writeToolLogArtifact(params: {
  relativePath: string;
  entry: Record<string, unknown>;
}): void {
  const absolutePath = path.resolve(params.relativePath);
  const directory = path.dirname(absolutePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(absolutePath, `${JSON.stringify(params.entry, null, 2)}\n`);
}

function inferToolStatus(result: unknown): "success" | "error" | "unknown" {
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (record.isError === true) return "error";
    if (typeof record.error === "string" && record.error.trim()) return "error";
    if (record.success === true) return "success";
  }

  if (typeof result === "string") {
    const lowered = result.toLowerCase();
    if (lowered.includes("iserror") || lowered.includes("error:")) {
      return "error";
    }
    if (lowered.trim()) {
      return "success";
    }
  }

  return "unknown";
}

function summarizeArgs(args: unknown): string {
  if (!args || typeof args !== "object") {
    return "";
  }

  const record = args as Record<string, unknown>;
  const preferredKeys = [
    "command",
    "path",
    "file_path",
    "url",
    "query",
    "name",
    "toolName",
    "prompt",
  ];

  const previews: string[] = [];
  for (const key of preferredKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      previews.push(`${key}=${JSON.stringify(value.trim())}`);
    }
    if (previews.length >= 2) break;
  }

  if (previews.length > 0) {
    return previews.join(", ");
  }

  return toSafeLogString(record, 120);
}

export function buildToolResultMemorySummary(params: {
  toolName?: string;
  args?: unknown;
  result?: unknown;
  logPath: string;
}): string {
  const toolName = params.toolName || "unknown_tool";
  const status = inferToolStatus(params.result);
  const argsPreview = summarizeArgs(params.args);
  const details = argsPreview ? ` (${argsPreview})` : "";
  return `Used tool ${toolName}${details} -> ${status}. Full log: ${params.logPath}`;
}

export function createToolLogEntry(params: {
  timestamp: string;
  jid?: string;
  messageId?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  logPath: string;
}): Record<string, unknown> {
  return {
    logVersion: 1,
    timestamp: params.timestamp,
    jid: params.jid || "unknown",
    messageId: params.messageId,
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    status: inferToolStatus(params.result),
    logPath: params.logPath,
    argsText: serializeValue(params.args ?? {}),
    resultText: serializeValue(params.result),
  };
}

export const TOOL_LOG_INLINE_RESULT_CHARS = DEFAULT_INLINE_RESULT_CHARS;
