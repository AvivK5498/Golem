/**
 * Shared transient API error detection.
 *
 * Used by AgentRunner (primary model retry) and sub-agent loader (delegation retry)
 * to identify errors that are worth retrying with backoff.
 */

const TRANSIENT_STATUS_CODES = new Set([429, 503, 529]);

// Network-level errors worth retrying. Mostly undici (Node's fetch) and POSIX
// socket codes that surface when the TCP connection itself never completes —
// distinct from API responses, which is why isTransientApiError previously
// missed them.
const TRANSIENT_ERROR_NAMES = new Set([
  "ConnectTimeoutError",
  "HeadersTimeoutError",
  "BodyTimeoutError",
  "SocketError",
]);
const TRANSIENT_ERROR_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
]);

function hasTransientNetworkSignal(err: unknown, depth = 0): boolean {
  if (depth > 5 || !(err instanceof Error)) return false;
  if (TRANSIENT_ERROR_NAMES.has(err.name)) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- checking code on error objects
  const code = (err as any).code;
  if (typeof code === "string" && TRANSIENT_ERROR_CODES.has(code)) return true;
  const msg = err.message.toLowerCase();
  if (
    msg.includes("connect timeout") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("network socket disconnected") ||
    msg.includes("other side closed")
  ) return true;
  if (err.cause && err.cause !== err) return hasTransientNetworkSignal(err.cause, depth + 1);
  return false;
}

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
  if (hasTransientNetworkSignal(err)) return true;
  return false;
}
