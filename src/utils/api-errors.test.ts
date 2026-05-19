import { describe, expect, test } from "bun:test";

import { isTransientApiError } from "./api-errors.js";

// Mirrors the real shape we see from `@openrouter/ai-sdk-provider` + undici:
// the outer error is an AI SDK APICallError whose `cause` is the undici
// ConnectTimeoutError. We don't import either lib here — the helper only
// inspects name/code/message/cause, so a plain Error chain is faithful.
function makeApiCallError(causeName: string, causeCode: string, causeMessage: string): Error {
  const cause = new Error(causeMessage);
  cause.name = causeName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cause as any).code = causeCode;
  const outer = new Error(`Cannot connect to API: ${causeMessage}`);
  outer.name = "AI_APICallError";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (outer as any).cause = cause;
  return outer;
}

describe("isTransientApiError — existing behavior preserved", () => {
  test("non-Error inputs are not transient", () => {
    expect(isTransientApiError("boom")).toBe(false);
    expect(isTransientApiError(null)).toBe(false);
    expect(isTransientApiError(undefined)).toBe(false);
    expect(isTransientApiError({ message: "overloaded" })).toBe(false);
  });

  test("overloaded / rate limit / service unavailable in message", () => {
    expect(isTransientApiError(new Error("Anthropic Overloaded"))).toBe(true);
    expect(isTransientApiError(new Error("429 rate limit exceeded"))).toBe(true);
    expect(isTransientApiError(new Error("503 Service Unavailable"))).toBe(true);
  });

  test("prefill / must-end-with-user-message via message and responseBody", () => {
    expect(isTransientApiError(new Error("prefill rejected"))).toBe(true);
    expect(isTransientApiError(new Error("history must end with a user message"))).toBe(true);
    const err: Error & { responseBody?: string } = new Error("bad request");
    err.responseBody = '{"error":"prefill not allowed"}';
    expect(isTransientApiError(err)).toBe(true);
  });

  test("statusCode 429 / 503 / 529 are transient; 400 / 401 / 500 are not", () => {
    const make = (status: number) => {
      const e: Error & { statusCode?: number } = new Error("x");
      e.statusCode = status;
      return e;
    };
    expect(isTransientApiError(make(429))).toBe(true);
    expect(isTransientApiError(make(503))).toBe(true);
    expect(isTransientApiError(make(529))).toBe(true);
    expect(isTransientApiError(make(400))).toBe(false);
    expect(isTransientApiError(make(401))).toBe(false);
    expect(isTransientApiError(make(500))).toBe(false);
  });

  test("plain unrelated error is not transient", () => {
    expect(isTransientApiError(new Error("something broke"))).toBe(false);
    expect(isTransientApiError(new Error("Invalid model id"))).toBe(false);
  });
});

describe("isTransientApiError — connection errors (new)", () => {
  test("undici ConnectTimeoutError wrapped by AI SDK APICallError (the observed case)", () => {
    const err = makeApiCallError(
      "ConnectTimeoutError",
      "UND_ERR_CONNECT_TIMEOUT",
      "Connect Timeout Error (attempted addresses: 104.18.3.115:443, 104.18.2.115:443, timeout: 10000ms)",
    );
    expect(isTransientApiError(err)).toBe(true);
  });

  test("bare ConnectTimeoutError (no wrapper)", () => {
    const e = new Error("Connect Timeout Error");
    e.name = "ConnectTimeoutError";
    expect(isTransientApiError(e)).toBe(true);
  });

  test("undici header/body timeouts", () => {
    const headers = new Error("Headers Timeout Error");
    headers.name = "HeadersTimeoutError";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (headers as any).code = "UND_ERR_HEADERS_TIMEOUT";
    expect(isTransientApiError(headers)).toBe(true);

    const body = new Error("Body Timeout Error");
    body.name = "BodyTimeoutError";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (body as any).code = "UND_ERR_BODY_TIMEOUT";
    expect(isTransientApiError(body)).toBe(true);
  });

  test("POSIX socket-level codes: ECONNRESET, ECONNREFUSED, ETIMEDOUT, EAI_AGAIN, ENOTFOUND", () => {
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"]) {
      const e: Error & { code?: string } = new Error(`network: ${code}`);
      e.code = code;
      expect(isTransientApiError(e)).toBe(true);
    }
  });

  test("message-only signals: 'socket hang up', 'fetch failed'", () => {
    expect(isTransientApiError(new Error("socket hang up"))).toBe(true);
    expect(isTransientApiError(new TypeError("fetch failed"))).toBe(true);
  });

  test("deeply nested cause chain is still detected", () => {
    const root = new Error("Connect Timeout Error");
    root.name = "ConnectTimeoutError";
    const mid = new Error("upstream failed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mid as any).cause = root;
    const top = new Error("Cannot connect to API");
    top.name = "AI_APICallError";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (top as any).cause = mid;
    expect(isTransientApiError(top)).toBe(true);
  });

  test("self-referential cause does not loop", () => {
    const e: Error & { cause?: unknown } = new Error("weird");
    e.cause = e;
    expect(isTransientApiError(e)).toBe(false);
  });
});
