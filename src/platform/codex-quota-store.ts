/**
 * Codex quota store — captures the latest x-codex-* response headers from
 * Codex API calls and persists them so the UI can show usage meters.
 *
 * No alerting, no auto-failover, no rate-limit gating. Just a snapshot of
 * the most recent response's quota state, written atomically to disk so it
 * survives daemon restarts.
 *
 * The Codex API exposes two rolling windows on every response:
 *   - PRIMARY:   5h window (300 minutes) — short-term burst allowance
 *   - SECONDARY: 7d window (10080 minutes) — weekly cumulative cap
 *
 * Each carries:
 *   - x-codex-primary-used-percent / -secondary-used-percent
 *   - x-codex-primary-reset-after-seconds / -secondary-reset-after-seconds
 *   - x-codex-primary-window-minutes / -secondary-window-minutes
 *   - x-codex-primary-reset-at / -secondary-reset-at  (unix epoch seconds)
 *   - x-codex-plan-type
 *   - x-codex-active-limit
 *   - x-codex-credits-* (balance, has_credits, unlimited)
 */
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../utils/paths.js";

const QUOTA_PATH = dataPath("codex-quota.json");

export interface CodexQuotaWindow {
  /** Length of the rolling window in minutes (e.g. 300 for 5h, 10080 for 7d). */
  windowMinutes: number;
  /** Percent of the window's allowance currently used (0-100). */
  usedPercent: number;
  /** Seconds until this window resets. */
  resetAfterSeconds: number;
  /** Unix epoch seconds at which this window resets. */
  resetAt: number;
}

export interface CodexQuotaSnapshot {
  /** Plan tier reported by the API (e.g. "plus", "pro", "pro_plus"). */
  planType: string | null;
  /** Which limit bucket this account is currently subject to (e.g. "codex"). */
  activeLimit: string | null;
  /** True if the plan has an unlimited credits flag. */
  creditsUnlimited: boolean;
  /** True if the plan has any credits balance available. */
  creditsHasCredits: boolean;
  /** Optional credits balance string (often empty even when has_credits is true). */
  creditsBalance: string | null;
  /** Short-term (typically 5h) rolling window. */
  primary: CodexQuotaWindow | null;
  /** Long-term (typically 7d) rolling window. */
  secondary: CodexQuotaWindow | null;
  /** Wall-clock ms timestamp when this snapshot was captured. */
  capturedAt: number;
}

// ── Header parsing ──────────────────────────────────────────

/**
 * Parse a Headers object (or plain Record) into a CodexQuotaSnapshot.
 * Returns null if the response doesn't carry the x-codex-* family at all
 * (e.g. an error response or a non-Codex endpoint).
 */
export function parseCodexQuotaHeaders(
  headers: Headers | Record<string, string | undefined>,
): CodexQuotaSnapshot | null {
  const get = (k: string): string | undefined => {
    if (headers instanceof Headers) return headers.get(k) ?? undefined;
    return headers[k] ?? headers[k.toLowerCase()];
  };

  const planType = get("x-codex-plan-type");
  if (!planType) return null; // Not a Codex response

  const num = (k: string): number | null => {
    const v = get(k);
    if (v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const bool = (k: string): boolean => {
    const v = get(k);
    return v === "True" || v === "true" || v === "1";
  };

  const buildWindow = (prefix: "primary" | "secondary"): CodexQuotaWindow | null => {
    const windowMinutes = num(`x-codex-${prefix}-window-minutes`);
    const usedPercent = num(`x-codex-${prefix}-used-percent`);
    const resetAfterSeconds = num(`x-codex-${prefix}-reset-after-seconds`);
    const resetAt = num(`x-codex-${prefix}-reset-at`);
    if (windowMinutes === null || usedPercent === null || resetAfterSeconds === null || resetAt === null) {
      return null;
    }
    return { windowMinutes, usedPercent, resetAfterSeconds, resetAt };
  };

  return {
    planType,
    activeLimit: get("x-codex-active-limit") ?? null,
    creditsUnlimited: bool("x-codex-credits-unlimited"),
    creditsHasCredits: bool("x-codex-credits-has-credits"),
    creditsBalance: get("x-codex-credits-balance") ?? null,
    primary: buildWindow("primary"),
    secondary: buildWindow("secondary"),
    capturedAt: Date.now(),
  };
}

// ── Persistence ─────────────────────────────────────────────

/**
 * Cache invalidation strategy: re-read the file when its mtime changes.
 * Multiple processes can write to this file (the daemon AND the test-harness
 * for example), so a one-time load on startup misses cross-process updates.
 * mtime-based caching gives us fresh reads with near-zero overhead.
 */
let _cache: CodexQuotaSnapshot | null = null;
let _cacheMtime = 0;

function ensureDataDir(): void {
  const dir = path.dirname(QUOTA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadFromDisk(): CodexQuotaSnapshot | null {
  if (!fs.existsSync(QUOTA_PATH)) {
    _cache = null;
    _cacheMtime = 0;
    return null;
  }
  try {
    const stat = fs.statSync(QUOTA_PATH);
    const mtime = stat.mtimeMs;
    if (mtime !== _cacheMtime) {
      const raw = fs.readFileSync(QUOTA_PATH, "utf-8");
      _cache = JSON.parse(raw) as CodexQuotaSnapshot;
      _cacheMtime = mtime;
    }
    return _cache;
  } catch {
    _cache = null;
    _cacheMtime = 0;
    return null;
  }
}

/**
 * Atomic write: tmp file + rename. Single-process daemon, no locking needed.
 */
function persistToDisk(snapshot: CodexQuotaSnapshot): void {
  ensureDataDir();
  const tmp = `${QUOTA_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tmp, QUOTA_PATH);
}

/**
 * Update the stored snapshot from a Codex response's headers. Best-effort:
 * never throws, never blocks. Caller should fire-and-forget after a successful
 * Codex API call. Only writes when the parsed snapshot looks valid.
 */
export function updateCodexQuota(
  headers: Headers | Record<string, string | undefined>,
): void {
  try {
    const snapshot = parseCodexQuotaHeaders(headers);
    if (!snapshot) return;
    persistToDisk(snapshot);
    // After we write, the next loadFromDisk() call will pick up the new
    // mtime automatically — no in-memory cache fiddling needed.
  } catch {
    // Quota tracking is decorative; never let a write failure break a turn.
  }
}

/**
 * Read the most recent quota snapshot. Returns null when no Codex turn has
 * happened since the daemon started AND no persisted snapshot exists.
 */
export function getCodexQuota(): CodexQuotaSnapshot | null {
  return loadFromDisk();
}

/**
 * Compute the live reset-after-seconds for a window, accounting for the time
 * elapsed since the snapshot was captured. The stored `resetAfterSeconds` is
 * stale by `(now - capturedAt) / 1000` seconds; we subtract that.
 *
 * Returns 0 when the window has already reset.
 */
export function liveResetAfterSeconds(
  window: CodexQuotaWindow,
  capturedAt: number,
): number {
  const elapsed = Math.floor((Date.now() - capturedAt) / 1000);
  return Math.max(0, window.resetAfterSeconds - elapsed);
}
