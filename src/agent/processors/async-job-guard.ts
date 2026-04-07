import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
  Processor,
} from "@mastra/core/processors";

/**
 * Stops the agent loop after an async job (e.g., coding agent) is dispatched.
 *
 * When a tool sets `_asyncJobDispatched` on the request context, this processor
 * forces toolChoice: "none" on the NEXT step, making the agent produce a final
 * text response and stop. The job result re-triggers the conversation later.
 */
export class AsyncJobGuard implements Processor {
  readonly id = "async-job-guard";

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult | void {
    const dispatched = args.requestContext?.get("_asyncJobDispatched" as never);
    if (!dispatched) return;

    const stepNumber = (args as { stepNumber?: number }).stepNumber ?? 0;
    if (stepNumber === 0) return; // Let the dispatch step complete first

    return {
      toolChoice: "none",
      systemMessages: [
        ...args.systemMessages,
        {
          role: "system" as const,
          content: "An async background job was dispatched. Do NOT call any more tools. Write a brief confirmation to the user and stop. The result will be delivered automatically when the job completes.",
        },
      ],
    };
  }
}
