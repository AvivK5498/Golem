import { describe, expect, test } from "bun:test";

import { looksLikeTelegramToken, validateTelegramToken } from "./telegram-validate.js";

const VALID_SHAPE = "1234567890:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

function mockFetch(responses: Array<Partial<Response> & { json?: () => Promise<unknown> }>): typeof fetch {
  let i = 0;
  return ((async () => {
    const r = responses[i++];
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: r.json ?? (async () => ({})),
    } as Response;
  }) as unknown) as typeof fetch;
}

describe("looksLikeTelegramToken", () => {
  test("accepts well-formed tokens", () => {
    expect(looksLikeTelegramToken(VALID_SHAPE)).toBe(true);
  });
  test("rejects obviously malformed input", () => {
    expect(looksLikeTelegramToken("nope")).toBe(false);
    expect(looksLikeTelegramToken("12345:short")).toBe(false);
    expect(looksLikeTelegramToken("")).toBe(false);
  });
});

describe("validateTelegramToken", () => {
  test("empty token rejected without a network call", async () => {
    const fetchImpl = mockFetch([]);
    const r = await validateTelegramToken("", { fetchImpl });
    expect(r.ok).toBe(false);
  });

  test("malformed token rejected without a network call", async () => {
    const r = await validateTelegramToken("not-a-token", { fetchImpl: mockFetch([]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/format/);
  });

  test("happy path returns username + id", async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { id: 42, is_bot: true, username: "test_bot" } }),
      },
    ]);
    const r = await validateTelegramToken(VALID_SHAPE, { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.botUsername).toBe("test_bot");
      expect(r.botId).toBe(42);
    }
  });

  test("401 maps to clear error", async () => {
    const fetchImpl = mockFetch([{ ok: false, status: 401 }]);
    const r = await validateTelegramToken(VALID_SHAPE, { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("401");
  });

  test("non-bot account rejected", async () => {
    const fetchImpl = mockFetch([
      {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { id: 1, is_bot: false, username: "human" } }),
      },
    ]);
    const r = await validateTelegramToken(VALID_SHAPE, { fetchImpl });
    expect(r.ok).toBe(false);
  });

  test("timeout returns a timed-out error", async () => {
    const slowFetch: typeof fetch = ((_url: string, opts?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;
    const r = await validateTelegramToken(VALID_SHAPE, { fetchImpl: slowFetch, timeoutMs: 10 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/timed out/);
  });
});
