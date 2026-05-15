import { describe, expect, test } from "bun:test";

import { validateOpenRouterKey } from "./openrouter-validate.js";

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): typeof fetch {
  return ((async () => ({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: response.json ?? (async () => ({})),
  } as Response))) as unknown as typeof fetch;
}

describe("validateOpenRouterKey", () => {
  test("empty key rejected without a network call", async () => {
    const r = await validateOpenRouterKey("");
    expect(r.ok).toBe(false);
  });

  test("happy path returns ok with optional limit_remaining", async () => {
    const fetchImpl = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ data: { limit_remaining: 9.95, usage: 0.05 } }),
    });
    const r = await validateOpenRouterKey("sk-or-v1-xxx", { fetchImpl });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.limitRemaining).toBeCloseTo(9.95);
  });

  test("401 maps to clear error", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 401 });
    const r = await validateOpenRouterKey("sk-or-bad", { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("401");
  });

  test("500 returns generic HTTP error", async () => {
    const fetchImpl = mockFetch({ ok: false, status: 503 });
    const r = await validateOpenRouterKey("sk-or-x", { fetchImpl });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("503");
  });
});
