/**
 * Codex OAuth credential store.
 *
 * Sources credentials from one of two places, preferring the official Codex CLI
 * file when present:
 *
 *   1. ~/.codex/auth.json (official Codex CLI) — READ-ONLY mirror.
 *      Never refreshed by us. The Codex CLI manages its own refresh on the
 *      same machine; if we also refreshed, we'd race with it and one of the
 *      processes would randomly get logged out (OpenClaw's "token sink"
 *      pattern). When this source is in use, we re-read the file on every
 *      `getValidAccessToken()` call so that any refresh the CLI just did
 *      gets picked up immediately.
 *
 *   2. data/codex-credentials.json (our own copy via codex-auth.ts) — managed
 *      by us. We refresh it via pi-ai's refreshOpenAICodexToken when expired.
 *
 * Why this matters: ChatGPT OAuth providers commonly mint a NEW refresh token
 * during refresh and invalidate the old one. If two processes on the same
 * machine refresh independently, they end up logging each other out. Mirroring
 * the CLI's source of truth eliminates that race entirely.
 *
 * Concurrency: in-process refreshes are serialized via an in-memory promise
 * chain. The Golem daemon runs as a single launchd process, so no cross-process
 * coordination is needed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dataPath } from "../utils/paths.js";

const OUR_CREDS_PATH = dataPath("codex-credentials.json");
const CODEX_CLI_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");
const REFRESH_SAFETY_MARGIN_MS = 5 * 60_000; // refresh 5 minutes before actual expiry

export type CodexAuthSource = "codex-cli" | "golem";

export interface CodexCredentials {
  access: string;
  refresh: string;
  expires: number;       // ms since epoch
  accountId: string;
  source: CodexAuthSource;
}

// ── JWT helpers (no signature check — we trust the local file) ─────────

const JWT_CLAIM_PATH = "https://api.openai.com/auth";

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

function getExpiresMsFromJwt(accessToken: string): number {
  const payload = decodeJwtPayload(accessToken);
  // exp is in seconds since epoch (RFC 7519)
  const exp = payload?.exp;
  if (typeof exp !== "number") {
    throw new Error("Codex access token has no `exp` claim");
  }
  return exp * 1000;
}

function getAccountIdFromJwt(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claims = (payload as any)?.[JWT_CLAIM_PATH];
  const accountId = claims?.chatgpt_account_id;
  if (typeof accountId !== "string" || !accountId) {
    throw new Error("Codex access token has no chatgpt_account_id claim");
  }
  return accountId;
}

// ── Source loaders ──────────────────────────────────────────────────

interface CodexCliAuthFile {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

function loadFromCodexCli(): CodexCredentials | null {
  if (!fs.existsSync(CODEX_CLI_AUTH_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(CODEX_CLI_AUTH_PATH, "utf-8")) as CodexCliAuthFile;
    const t = raw.tokens;
    if (!t?.access_token || !t?.refresh_token || !t?.account_id) return null;
    const expires = getExpiresMsFromJwt(t.access_token);
    return {
      access: t.access_token,
      refresh: t.refresh_token,
      expires,
      accountId: t.account_id,
      source: "codex-cli",
    };
  } catch {
    return null;
  }
}

interface GolemCredsFile {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

function loadFromGolem(): CodexCredentials | null {
  if (!fs.existsSync(OUR_CREDS_PATH)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(OUR_CREDS_PATH, "utf-8")) as GolemCredsFile;
    if (!raw.access || !raw.refresh) return null;
    const accountId = raw.accountId || getAccountIdFromJwt(raw.access);
    return {
      access: raw.access,
      refresh: raw.refresh,
      expires: raw.expires,
      accountId,
      source: "golem",
    };
  } catch {
    return null;
  }
}

function saveGolemCreds(c: CodexCredentials) {
  const dir = path.dirname(OUR_CREDS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const out: GolemCredsFile = {
    access: c.access,
    refresh: c.refresh,
    expires: c.expires,
    accountId: c.accountId,
  };
  fs.writeFileSync(OUR_CREDS_PATH, JSON.stringify(out, null, 2));
  try { fs.chmodSync(OUR_CREDS_PATH, 0o600); } catch { /* best effort */ }
}

/**
 * Load the most-current credentials from whichever source is available.
 * Codex CLI takes precedence — if both files exist, the CLI is the source
 * of truth so we don't fight its refresh cycle.
 */
export function loadCredentials(): CodexCredentials | null {
  return loadFromCodexCli() ?? loadFromGolem();
}

// ── Refresh logic with in-process mutex ─────────────────────────────

let _refreshInFlight: Promise<CodexCredentials> | null = null;

async function refreshGolemCreds(refresh: string): Promise<CodexCredentials> {
  // pi-ai uses lazy dynamic imports of node:crypto/node:http; one microtask
  // is enough for them to settle (see codex-auth.ts for the same workaround).
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
  const { refreshOpenAICodexToken } = await import("@mariozechner/pi-ai/oauth");
  const fresh = await refreshOpenAICodexToken(refresh);
  const accountId = (fresh as { accountId?: string }).accountId
    || getAccountIdFromJwt(fresh.access);
  const result: CodexCredentials = {
    access: fresh.access,
    refresh: fresh.refresh,
    expires: fresh.expires,
    accountId,
    source: "golem",
  };
  saveGolemCreds(result);
  return result;
}

/**
 * Get a valid access token, refreshing if it's expired or close to expiring.
 *
 * Behavior depends on the source:
 *  - codex-cli: re-read the file each call. If expired, re-read once more in
 *    case the CLI just refreshed in the background. If still expired, throw.
 *    We never refresh CLI-sourced credentials ourselves.
 *  - golem: refresh via pi-ai when expired, persist back to disk.
 *
 * In-process refreshes are serialized so concurrent agent turns don't
 * trigger duplicate refresh requests.
 */
export async function getValidAccessToken(): Promise<CodexCredentials> {
  const now = Date.now();
  const initial = loadCredentials();
  if (!initial) {
    throw new Error(
      "No Codex credentials found. Run 'npx tsx src/codex-auth.ts' or sign in via the Codex CLI.",
    );
  }

  // Healthy enough to use directly
  if (initial.expires - now > REFRESH_SAFETY_MARGIN_MS) {
    return initial;
  }

  // Codex CLI source: never refresh, just re-read
  if (initial.source === "codex-cli") {
    const reread = loadFromCodexCli();
    if (reread && reread.expires - now > REFRESH_SAFETY_MARGIN_MS) {
      return reread;
    }
    throw new Error(
      "Codex CLI credential is expired and Golem will not refresh it (the CLI manages its own refresh). " +
      "Run `codex login` to refresh, or remove ~/.codex/auth.json to fall back to Golem-managed creds.",
    );
  }

  // Golem source: refresh via pi-ai. Serialize concurrent callers.
  if (_refreshInFlight) return _refreshInFlight;
  _refreshInFlight = (async () => {
    try {
      return await refreshGolemCreds(initial.refresh);
    } finally {
      _refreshInFlight = null;
    }
  })();
  return _refreshInFlight;
}

/**
 * Diagnostic: where are credentials sourced from right now?
 * Returns null if no credentials at all.
 */
export function describeCredentialSource(): { source: CodexAuthSource; path: string; expiresIn: string } | null {
  const c = loadCredentials();
  if (!c) return null;
  const ms = c.expires - Date.now();
  const expiresIn = ms <= 0
    ? "EXPIRED"
    : ms < 60_000
      ? `${Math.floor(ms / 1000)}s`
      : ms < 3_600_000
        ? `${Math.floor(ms / 60_000)}m`
        : ms < 86_400_000
          ? `${Math.floor(ms / 3_600_000)}h`
          : `${Math.floor(ms / 86_400_000)}d`;
  return {
    source: c.source,
    path: c.source === "codex-cli" ? CODEX_CLI_AUTH_PATH : OUR_CREDS_PATH,
    expiresIn,
  };
}
