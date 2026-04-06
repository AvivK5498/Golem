/**
 * ToolErrorGate — processInputStep processor that detects repeated tool failures.
 *
 * Tools increment a counter on requestContext when they error (via error-tagging wrapper).
 * This processor reads the counter BEFORE the next LLM step and strips tools if too many
 * consecutive errors have occurred, forcing the agent to synthesize a response explaining
 * what went wrong.
 *
 * Threshold: 3 consecutive tool errors = strip tools + explain.
 * A single successful tool call resets the counter.
 */
import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
  Processor,
} from "@mastra/core/processors";
import { TOOL_ERROR_COUNT_KEY } from "../tools/error-tagging.js";
import { logger } from "../../utils/external-logger.js";

const MAX_CONSECUTIVE_ERRORS = 3;

export class ToolErrorGate implements Processor {
  readonly id = "tool-error-gate";

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult | void {
    const requestContext = args.requestContext;
    if (!requestContext) return;

    const stepNumber = (args as { stepNumber?: number }).stepNumber ?? 0;
    if (stepNumber === 0) return;

    const errorCount = (requestContext.get(TOOL_ERROR_COUNT_KEY) as number) || 0;
    if (errorCount < MAX_CONSECUTIVE_ERRORS) return;

    // Extract recent error details from messages for the agent to report
    const errorDetails = this.extractRecentErrors(args.messages);

    console.log(`[error-gate] ${errorCount} consecutive errors at step ${stepNumber} — stripping tools, forcing synthesis`);
    logger.warn(`Error gate triggered: ${errorCount} consecutive errors`, {
      errors: String(errorCount),
      step: String(stepNumber),
      details: errorDetails.join(" | "),
    });

    return {
      tools: {},
      activeTools: [],
      toolChoice: "none",
      systemMessages: [
        ...args.systemMessages,
        {
          role: "system" as const,
          content:
            `${errorCount} consecutive tool errors occurred. Tools have been disabled. ` +
            "Tell the user what you were trying to do, what errors occurred, and what results (if any) you gathered before the errors. " +
            "Be specific about the errors so the user understands what went wrong.\n\n" +
            `Recent errors:\n${errorDetails.map(e => `- ${e}`).join("\n")}`,
        },
      ],
    };
  }

  private extractRecentErrors(messages: unknown): string[] {
    const errors: string[] = [];
    if (!Array.isArray(messages)) return errors;

    // Walk messages in reverse to find recent tool-result errors
    for (let i = messages.length - 1; i >= 0 && errors.length < 5; i--) {
      const msg = messages[i];
      if (!msg || typeof msg !== "object") continue;
      const record = msg as Record<string, unknown>;

      if (record.role === "tool") {
        const content = typeof record.content === "string" ? record.content : "";
        if (content.includes("isError") || content.includes("error") || content.includes("Error")) {
          const toolName = (record.toolName as string) ?? (record.name as string) ?? "unknown";
          // Extract just the error message, not the full JSON
          const errorMatch = content.match(/"error"\s*:\s*"([^"]+)"/);
          const errorText = errorMatch ? errorMatch[1] : content.slice(0, 200);
          errors.push(`${toolName}: ${errorText}`);
        }
      }

      // Also check assistant messages with tool invocation results
      if (record.role === "assistant" && Array.isArray(record.content)) {
        for (const part of record.content as Array<Record<string, unknown>>) {
          if (part?.type === "tool-result" || part?.type === "tool-invocation") {
            const result = part.result ?? part.output ?? "";
            const resultStr = typeof result === "string" ? result : JSON.stringify(result);
            if (resultStr.includes("isError") || resultStr.includes("Error")) {
              const toolName = (part.toolName as string) ?? "unknown";
              const errorMatch = resultStr.match(/"error"\s*:\s*"([^"]+)"/);
              const errorText = errorMatch ? errorMatch[1] : resultStr.slice(0, 200);
              errors.push(`${toolName}: ${errorText}`);
            }
          }
        }
      }
    }

    return errors.length > 0 ? errors : ["(error details not available in message history)"];
  }
}
