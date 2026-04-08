/**
 * Filtered Mastra logger.
 *
 * Wraps Mastra's ConsoleLogger and suppresses noisy "errors" that are actually
 * intentional control flow — currently just the AsyncJobGuard's TripWire abort
 * (which Mastra logs as "Error executing step ... async-job-guard").
 *
 * We also patch `console.error` globally because the input-processor workflow
 * runs in its own ExecutionEngine that doesn't receive Mastra's configured
 * logger — it falls back to a fresh ConsoleLogger that writes directly to
 * console.error.
 */
import { ConsoleLogger } from "@mastra/core/logger";

const SUPPRESSED_PATTERNS = [
  /async-job-guard.*Async job dispatched/i,
  /Error executing step.*async-job-guard/i,
];

function isSuppressed(message: unknown): boolean {
  if (typeof message !== "string") return false;
  return SUPPRESSED_PATTERNS.some((p) => p.test(message));
}

let consolePatched = false;

/** Wrap console.error so AsyncJobGuard tripwire stack traces don't reach the user. */
export function installConsoleFilter(): void {
  if (consolePatched) return;
  consolePatched = true;
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (args.length > 0 && isSuppressed(args[0])) {
      console.log("[async-job-guard] loop terminated after async dispatch (expected)");
      return;
    }
    originalError(...args);
  };
}

export class FilteredMastraLogger extends ConsoleLogger {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- match parent signature
  error(message: string, ...args: any[]): void {
    if (isSuppressed(message)) {
      console.log("[async-job-guard] loop terminated after async dispatch (expected)");
      return;
    }
    super.error(message, ...args);
  }
}
