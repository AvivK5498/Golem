import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
  Processor,
} from "@mastra/core/processors";

/**
 * Reserves the final step for a text response by stripping all tools.
 *
 * Designed for sub-agents that may exhaust their maxSteps on tool calls
 * without ever producing a text response. On step N-1, this processor
 * removes all tools and injects a system message forcing the model to
 * synthesize a final answer from whatever results it has so far.
 */
export class FinalStepGuard implements Processor {
  readonly id = "final-step-guard";
  readonly name = "Final Step Guard";

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult | void {
    const stepNumber = (args as { stepNumber?: number }).stepNumber ?? 0;
    if (stepNumber === 0) return;

    const maxSteps = this.getMaxSteps(args);
    if (maxSteps === null || maxSteps <= 0) return;

    if (stepNumber < maxSteps - 1) return;

    console.log(
      `[final-step-guard] step ${stepNumber + 1}/${maxSteps} — stripping tools for final answer`,
    );

    return {
      tools: {},
      activeTools: [],
      toolChoice: "none",
      systemMessages: [
        ...args.systemMessages,
        {
          role: "system" as const,
          content:
            `This is your final step (${stepNumber + 1}/${maxSteps}). ` +
            "Do not call any tools. Write your final answer now using the results you already have. Clearly state any missing data.",
        },
      ],
    };
  }

  private getMaxSteps(args: ProcessInputStepArgs): number | null {
    // Try requestContext first (set by main agent)
    const fromContext = args.requestContext?.get("maxSteps" as never);
    if (typeof fromContext === "number" && Number.isFinite(fromContext)) {
      return fromContext;
    }

    // Fall back to defaultOptions.maxSteps passed through agent config
    const opts = (args as { defaultOptions?: { maxSteps?: number } }).defaultOptions;
    if (typeof opts?.maxSteps === "number" && Number.isFinite(opts.maxSteps)) {
      return opts.maxSteps;
    }

    return null;
  }
}
