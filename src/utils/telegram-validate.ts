/**
 * Validate a Telegram bot token via the getMe endpoint.
 *
 * Consumed by both the onboarding wizard (bd v0n.23) and `golem doctor` (bd 49x)
 * so the same "is this token usable" rules apply at config time and run time.
 *
 * Cheap idempotent GET; rate-limited by Telegram per-bot but a single call from
 * the wizard or doctor stays comfortably under the limit.
 */

export interface TelegramValidationOk {
  ok: true;
  botUsername: string;
  botId: number;
}

export interface TelegramValidationErr {
  ok: false;
  error: string;
}

export type TelegramValidationResult = TelegramValidationOk | TelegramValidationErr;

interface GetMeResponse {
  ok: boolean;
  result?: { id: number; is_bot: boolean; username?: string; first_name?: string };
  description?: string;
}

interface Options {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/** Quick shape check before we send a network request. Matches `<digits>:<chars>`. */
export function looksLikeTelegramToken(token: string): boolean {
  return /^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token);
}

export async function validateTelegramToken(
  token: string,
  opts: Options = {},
): Promise<TelegramValidationResult> {
  const trimmed = token?.trim();
  if (!trimmed) return { ok: false, error: "token is empty" };
  if (!looksLikeTelegramToken(trimmed)) {
    return { ok: false, error: "token format invalid (expected <digits>:<base64ish>)" };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const resp = await fetchImpl(`https://api.telegram.org/bot${trimmed}/getMe`, {
      method: "GET",
      signal: ctrl.signal,
    });
    if (resp.status === 401) return { ok: false, error: "token rejected by Telegram (401)" };
    if (!resp.ok) return { ok: false, error: `Telegram returned HTTP ${resp.status}` };

    const body = (await resp.json()) as GetMeResponse;
    if (!body.ok || !body.result) {
      return { ok: false, error: body.description || "Telegram returned ok=false" };
    }
    if (!body.result.is_bot) {
      return { ok: false, error: "credentials are not for a bot account" };
    }
    return {
      ok: true,
      botId: body.result.id,
      botUsername: body.result.username ?? body.result.first_name ?? "<unknown>",
    };
  } catch (err: unknown) {
    if ((err as Error).name === "AbortError") return { ok: false, error: "request timed out" };
    return { ok: false, error: (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}
