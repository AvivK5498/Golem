/**
 * Validate an OpenRouter API key by calling /api/v1/key.
 *
 * Returns 200 with usage/limit info when valid, 401 when not. Consumed by
 * `golem doctor` and (potentially) the onboarding wizard.
 */

export interface OpenRouterValidationOk {
  ok: true;
  /** Optional remaining credit, when OpenRouter returns it. */
  limitRemaining?: number;
}

export interface OpenRouterValidationErr {
  ok: false;
  error: string;
}

export type OpenRouterValidationResult = OpenRouterValidationOk | OpenRouterValidationErr;

interface Options {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface KeyResponse {
  data?: { limit_remaining?: number; usage?: number };
}

const DEFAULT_TIMEOUT_MS = 5_000;

export async function validateOpenRouterKey(
  key: string,
  opts: Options = {},
): Promise<OpenRouterValidationResult> {
  const trimmed = key?.trim();
  if (!trimmed) return { ok: false, error: "key is empty" };

  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const resp = await fetchImpl("https://openrouter.ai/api/v1/key", {
      method: "GET",
      headers: { Authorization: `Bearer ${trimmed}` },
      signal: ctrl.signal,
    });
    if (resp.status === 401) return { ok: false, error: "key rejected by OpenRouter (401)" };
    if (!resp.ok) return { ok: false, error: `OpenRouter returned HTTP ${resp.status}` };

    const body = (await resp.json()) as KeyResponse;
    return { ok: true, limitRemaining: body.data?.limit_remaining };
  } catch (err: unknown) {
    if ((err as Error).name === "AbortError") return { ok: false, error: "request timed out" };
    return { ok: false, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}
