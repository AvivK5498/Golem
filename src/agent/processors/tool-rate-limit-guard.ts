import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
  Processor,
} from "@mastra/core/processors";

/**
 * Detects when tool results contain rate-limit errors and strips those tools
 * from subsequent steps, forcing the model to synthesize from available results.
 *
 * Designed for sub-agents that share a turn-level tool budget (e.g., web_search).
 * Without this, models ignore tool-result-level error messages and keep retrying
 * the rate-limited tool until maxSteps is exhausted — producing no text output.
 */
export class ToolRateLimitGuard implements Processor {
  readonly id = "tool-rate-limit-guard";
  readonly name = "Tool Rate Limit Guard";

  private static readonly RATE_LIMIT_PATTERNS = [
    /limit reached/i,
    /rate.?limit/i,
    /too many requests/i,
    /quota exceeded/i,
    /you have used all \d+/i,
    /called \d+ times past its limit/i,
  ];

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult | void {
    const stepNumber = (args as { stepNumber?: number }).stepNumber ?? 0;
    if (stepNumber === 0) return;

    // Scan the message history for tool results that contain rate-limit errors.
    // Collect the names of tools that have been rate-limited.
    const rateLimitedTools = this.findRateLimitedTools(args.messages);
    if (rateLimitedTools.size === 0) return;

    // Remove rate-limited tools from the available set
    const currentTools = args.tools ?? {};
    const currentActiveTools = args.activeTools ?? Object.keys(currentTools);

    const filteredTools: Record<string, unknown> = {};
    for (const [name, tool] of Object.entries(currentTools)) {
      if (!rateLimitedTools.has(name)) {
        filteredTools[name] = tool;
      }
    }
    const filteredActiveTools = currentActiveTools.filter(
      (name) => !rateLimitedTools.has(name),
    );

    const toolNames = [...rateLimitedTools].join(", ");
    console.log(
      `[rate-limit-guard] stripping rate-limited tools: ${toolNames} (step ${stepNumber})`,
    );

    // If ALL tools are rate-limited, force text-only output
    const hasRemainingTools = filteredActiveTools.length > 0;

    const systemMessages = [
      ...args.systemMessages,
      {
        role: "system" as const,
        content:
          `The following tools hit their rate limit and are no longer available: ${toolNames}. ` +
          "Synthesize your final answer from the results you already have. Do not attempt to call these tools again.",
      },
    ];

    return {
      tools: filteredTools as Record<string, never>,
      activeTools: filteredActiveTools,
      ...(hasRemainingTools ? {} : { toolChoice: "none" as const }),
      systemMessages,
    };
  }

  /**
   * Walk through messages looking for tool results that match rate-limit patterns.
   * Returns the set of tool names that have been rate-limited.
   */
  private findRateLimitedTools(messages: unknown): Set<string> {
    const rateLimited = new Set<string>();
    if (!Array.isArray(messages)) return rateLimited;

    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const record = msg as Record<string, unknown>;

      // Check tool-result messages (role === "tool")
      if (record.role === "tool") {
        const toolName = this.extractToolName(record);
        const content = this.extractTextContent(record);
        if (toolName && this.isRateLimitError(content)) {
          rateLimited.add(toolName);
        }
        continue;
      }

      // Check assistant messages with tool invocation results
      if (record.role === "assistant") {
        const content = record.content;
        if (Array.isArray(content)) {
          for (const part of content) {
            this.checkToolInvocationPart(part, rateLimited);
          }
        }
        if (content && typeof content === "object" && !Array.isArray(content)) {
          const parts = (content as { parts?: unknown[] }).parts;
          if (Array.isArray(parts)) {
            for (const part of parts) {
              this.checkToolInvocationPart(part, rateLimited);
            }
          }
        }
      }
    }

    return rateLimited;
  }

  private checkToolInvocationPart(
    part: unknown,
    rateLimited: Set<string>,
  ): void {
    if (!part || typeof part !== "object") return;
    const p = part as Record<string, unknown>;

    // Vercel AI SDK tool-invocation format
    if (p.type === "tool-result" || p.type === "tool-invocation") {
      const toolName =
        (p.toolName as string) ?? (p.tool_name as string) ?? null;
      const result = p.result ?? p.output ?? p.text ?? "";
      const resultText =
        typeof result === "string" ? result : JSON.stringify(result);
      if (toolName && this.isRateLimitError(resultText)) {
        rateLimited.add(toolName);
      }
    }
  }

  private extractToolName(record: Record<string, unknown>): string | null {
    return (
      (record.toolName as string) ??
      (record.tool_name as string) ??
      (record.name as string) ??
      null
    );
  }

  private extractTextContent(record: Record<string, unknown>): string {
    const content = record.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((c) => {
          if (typeof c === "string") return c;
          if (c && typeof c === "object" && (c as Record<string, unknown>).text) {
            return (c as Record<string, unknown>).text as string;
          }
          return JSON.stringify(c);
        })
        .join(" ");
    }
    return typeof content === "object" ? JSON.stringify(content) : "";
  }

  private isRateLimitError(text: string): boolean {
    return ToolRateLimitGuard.RATE_LIMIT_PATTERNS.some((pattern) =>
      pattern.test(text),
    );
  }
}
