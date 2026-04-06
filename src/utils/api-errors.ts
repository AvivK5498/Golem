/**
 * Shared transient API error detection.
 *
 * Used by AgentRunner (primary model retry) and sub-agent loader (delegation retry)
 * to identify errors that are worth retrying with backoff.
 */

const TRANSIENT_STATUS_CODES = new Set([429, 503, 529]);

export function isTransientApiError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes("overloaded") || msg.includes("rate limit") || msg.includes("service unavailable")) return true;
  if (msg.includes("prefill") || msg.includes("must end with a user message")) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- checking responseBody on error objects
  const responseBody = String((err as any).responseBody || "");
  if (responseBody.includes("prefill") || responseBody.includes("must end with a user message")) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- checking statusCode on error objects
  const statusCode = (err as any).statusCode;
  if (typeof statusCode === "number" && TRANSIENT_STATUS_CODES.has(statusCode)) return true;
  return false;
}
