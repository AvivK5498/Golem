// ---------------------------------------------------------------------------
// Tool error tagging — structured isError flag for retry-loop detection
// ---------------------------------------------------------------------------
import { logger } from "../../utils/external-logger.js";

/** Marker type for tool results that represent errors */
export interface ToolErrorResult {
  isError: true;
  error: string;
}

/** Create a structured error result that the retry-loop breaker can detect */
export function toolError(message: string): ToolErrorResult {
  return { isError: true, error: message };
}

/**
 * Guidance result — aggressive nudge that does NOT count toward the error gate.
 * Used for per-turn rate limits: the tool is working fine, the agent just needs to stop calling it.
 */
export interface ToolGuidanceResult {
  isGuidance: true;
  message: string;
}

export function toolGuidance(message: string): ToolGuidanceResult {
  return { isGuidance: true, message };
}

/** Check if a string looks like an error returned from a tool */
export const ERROR_PATTERNS = [
  "error:",
  "command failed:",
  "command blocked:",
  "failed to",
  "not found",
  "not allowed",
  "not available",
  "not enabled",
  "not initialized",
  "is blocked",
  "is not available",
  // "limit reached" — removed: per-turn rate limits use toolGuidance() with graduated escalation
  "permission denied",
  "timed out",
  "unreachable",
  "tool input validation failed",
  "download failed:",
  "skill download failed:",
  "coding agent error:",
  "invalid url",
  "invalid config",
  "invalid cron",
  "blocked by security",
  "must be provided",
  "does not contain",
  "could not determine",
  "file is empty",
  "already exists",
];

export function looksLikeError(result: string): boolean {
  const lower = result.toLowerCase().trimStart();
  return ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Wrap a tool's execute return value: catch throws and tag error-like strings */
export function tagResult(result: unknown): unknown {
  if (result && typeof result === "object" && "isGuidance" in result) {
    return result; // guidance — not an error, don't tag
  }
  if (result && typeof result === "object" && "isError" in result) {
    return result; // already tagged
  }
  // Mastra validation errors: { error: true, message: "..." }
  if (result && typeof result === "object" && "error" in result) {
    const obj = result as Record<string, unknown>;
    if (obj.error === true && typeof obj.message === "string") {
      return toolError(obj.message);
    }
  }
  if (typeof result === "string" && looksLikeError(result)) {
    return toolError(result);
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = { execute?: (...args: any[]) => Promise<any>; [key: string]: any };

/** Key used on RequestContext to track tool errors and loop detection. */
export const TOOL_ERROR_COUNT_KEY = "__toolErrorCount" as never;
export const TOOL_CALL_HASHES_KEY = "__toolCallHashes" as never;
export const TOOL_ERROR_BY_NAME_KEY = "__toolErrorByName" as never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRC(context: unknown): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (context as any)?.requestContext;
}

function incrementErrorCount(context: unknown): void {
  const rc = getRC(context);
  if (rc?.get && rc?.set) {
    const count = (rc.get(TOOL_ERROR_COUNT_KEY) as number) || 0;
    rc.set(TOOL_ERROR_COUNT_KEY, (count + 1) as never);
  }
}

/**
 * Hash-based loop detection. Tracks (toolName + args) hashes per turn.
 * Returns the count of consecutive identical calls at the tail of the history.
 */
function trackCallAndGetRepeatCount(context: unknown, toolName: string, args: unknown): number {
  const rc = getRC(context);
  if (!rc?.get || !rc?.set) return 0;

  // Simple hash: toolName + JSON(args) truncated to keep it fast
  const argsStr = typeof args === "string" ? args : JSON.stringify(args ?? {});
  const hash = `${toolName}:${argsStr.slice(0, 200)}`;

  const hashes: string[] = (rc.get(TOOL_CALL_HASHES_KEY) as string[]) || [];
  hashes.push(hash);
  // Keep last 20 to bound memory
  if (hashes.length > 20) hashes.shift();
  rc.set(TOOL_CALL_HASHES_KEY, hashes as never);

  // Count consecutive identical hashes from the end
  let count = 0;
  for (let i = hashes.length - 1; i >= 0; i--) {
    if (hashes[i] === hash) count++;
    else break;
  }
  return count;
}

const LOOP_WARN_THRESHOLD = 2;
const LOOP_STOP_THRESHOLD = 3;

const PER_TOOL_WARN_THRESHOLD = 3;
const PER_TOOL_STOP_THRESHOLD = 5;

/** Increment the per-tool error counter (regardless of args) and return the new count. */
function incrementPerToolErrorCount(context: unknown, toolName: string): number {
  const rc = getRC(context);
  if (!rc?.get || !rc?.set) return 0;

  const map: Map<string, number> = (rc.get(TOOL_ERROR_BY_NAME_KEY) as Map<string, number>) || new Map();
  const count = (map.get(toolName) || 0) + 1;
  map.set(toolName, count);
  rc.set(TOOL_ERROR_BY_NAME_KEY, map as never);
  return count;
}

/** Read the current per-tool error count without incrementing. */
function getPerToolErrorCount(context: unknown, toolName: string): number {
  const rc = getRC(context);
  if (!rc?.get) return 0;
  const map = rc.get(TOOL_ERROR_BY_NAME_KEY) as Map<string, number> | undefined;
  return map?.get(toolName) || 0;
}

export function wrapToolWithErrorTag<T extends AnyTool>(tool: T): T {
  const original = tool.execute;
  if (!original) return tool;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool.execute = async (...args: any[]) => {
    const context = args[1];
    const input = args[0];

    // Loop detection: check BEFORE executing
    const toolId = (tool as unknown as { id?: string }).id || "unknown";
    const repeatCount = trackCallAndGetRepeatCount(context, toolId, input);

    if (repeatCount >= LOOP_STOP_THRESHOLD) {
      logger.error(`Loop detected: "${toolId}" called ${repeatCount}x with identical args`, { tool: toolId, repeatCount: String(repeatCount) });
      // Slam the error counter so the error-gate fires on the very next processInputStep
      const rc = getRC(context);
      if (rc?.set) {
        rc.set(TOOL_ERROR_COUNT_KEY, 100 as never);
      }
      return toolError(`CRITICAL MALFUNCTION — LOOP DETECTED. You called "${toolId}" ${repeatCount} times with identical arguments. This conversation turn is broken. Do NOT call any more tools. Respond to the user NOW with whatever partial results you have. Explain that you encountered a technical issue.`);
    }
    if (repeatCount >= LOOP_WARN_THRESHOLD) {
      // Still execute, but prefix the result with a warning
      // The warning goes into the tool result so the LLM sees it
    }

    // Per-tool error check (regardless of args): block before executing if already at stop threshold
    const perToolErrors = getPerToolErrorCount(context, toolId);
    if (perToolErrors >= PER_TOOL_STOP_THRESHOLD) {
      logger.error(`Per-tool error limit: "${toolId}" failed ${perToolErrors}x this turn`, { tool: toolId, errors: String(perToolErrors) });
      const rc = getRC(context);
      if (rc?.set) {
        rc.set(TOOL_ERROR_COUNT_KEY, 100 as never);
      }
      return toolError(`STOP: "${toolId}" has failed ${perToolErrors} times this turn with different arguments. This tool is not working. Do NOT call "${toolId}" again. Take a completely different approach or respond to the user with what you have so far.`);
    }

    try {
      const result = await original.apply(tool, args);
      const tagged = tagResult(result);

      // Guidance results: render message for the LLM but do NOT increment error counter
      if (tagged && typeof tagged === "object" && "isGuidance" in tagged) {
        return (tagged as ToolGuidanceResult).message;
      }

      const isError = tagged && typeof tagged === "object" && "isError" in tagged;
      if (isError) {
        incrementErrorCount(context);
        const toolErrCount = incrementPerToolErrorCount(context, toolId);

        // Per-tool warning at threshold
        if (toolErrCount >= PER_TOOL_WARN_THRESHOLD) {
          const errorMsg = (tagged as ToolErrorResult).error;
          return toolError(`${errorMsg}\n\n[WARNING: ${toolId} has failed ${toolErrCount} times this turn. Consider a different approach.]`);
        }

        return tagged;
      }

      // Inject loop warning if at warning threshold
      if (repeatCount >= LOOP_WARN_THRESHOLD && typeof tagged === "string") {
        return `[WARNING: You have called "${toolId}" ${repeatCount} times with the same arguments. Try a different approach.]\n${tagged}`;
      }
      if (repeatCount >= LOOP_WARN_THRESHOLD && tagged && typeof tagged === "object" && !("isError" in tagged)) {
        return `[WARNING: You have called "${toolId}" ${repeatCount} times with the same arguments. Try a different approach.]\n${JSON.stringify(tagged).slice(0, 500)}`;
      }

      return tagged;
    } catch (err) {
      incrementErrorCount(context);
      const toolErrCount = incrementPerToolErrorCount(context, toolId);
      const errMsg = err instanceof Error ? err.message : String(err);

      if (toolErrCount >= PER_TOOL_WARN_THRESHOLD) {
        return toolError(`${errMsg}\n\n[WARNING: ${toolId} has failed ${toolErrCount} times this turn. Consider a different approach.]`);
      }
      return toolError(errMsg);
    }
  };
  return tool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapAllTools<T extends Record<string, any>>(tools: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapped: Record<string, any> = { ...tools };
  for (const key of Object.keys(wrapped)) {
    if (wrapped[key]?.execute) {
      wrapped[key] = wrapToolWithErrorTag(wrapped[key]);
    }
  }
  return wrapped as T;
}
