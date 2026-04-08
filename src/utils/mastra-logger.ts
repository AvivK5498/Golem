/**
 * Filtered Mastra logger.
 *
 * Wraps Mastra's ConsoleLogger and suppresses noisy "errors" that are actually
 * intentional control flow — currently just the AsyncJobGuard's TripWire abort
 * (which Mastra logs as "Error executing step ... async-job-guard").
 */
import { ConsoleLogger } from "@mastra/core/logger";

const SUPPRESSED_PATTERNS = [
  /async-job-guard.*Async job dispatched/i,
  /Error executing step.*async-job-guard/i,
];

function isSuppressed(message: string): boolean {
  return SUPPRESSED_PATTERNS.some((p) => p.test(message));
}

export class FilteredMastraLogger extends ConsoleLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- match parent signature
  error(message: string, ...args: any[]): void {
    if (typeof message === "string" && isSuppressed(message)) {
      // Log a one-line, non-stacktrace info instead so we still see SOMETHING in dev
      console.log("[async-job-guard] loop terminated after async dispatch (expected)");
      return;
    }
    super.error(message, ...args);
  }
}
