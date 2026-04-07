import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
  Processor,
} from "@mastra/core/processors";

/**
 * Terminates the agent loop after an async job (e.g., coding agent) is dispatched.
 *
 * When a tool sets `_asyncJobDispatched` on the request context, this processor
 * calls abort() on the NEXT step, hard-stopping the agentic loop via TripWire.
 * The confirmation text from the tool result (step 0) is sent to the user by
 * agent-runner. The job result is delivered later via onJobComplete → processMessage.
 */
export class AsyncJobGuard implements Processor {
  readonly id = "async-job-guard";

  processInputStep(args: ProcessInputStepArgs & { abort?: (reason?: string) => never }): ProcessInputStepResult | void {
    const dispatched = args.requestContext?.get("_asyncJobDispatched" as never);
    if (!dispatched) return;

    const stepNumber = (args as { stepNumber?: number }).stepNumber ?? 0;
    if (stepNumber === 0) return; // Let the dispatch step complete first

    // Hard-terminate the loop — no LLM call, no further steps.
    if (args.abort) {
      args.abort("Async job dispatched — loop terminated");
    }

    // Fallback if abort is unavailable
    return {
      tools: {},
      activeTools: [],
      toolChoice: "none",
    };
  }
}
