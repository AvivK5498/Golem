/**
 * Smart message-history recall.
 *
 * Replaces a static `lastMessages: N` cap with a multi-level hierarchy:
 *
 *   1. maxTokens (highest priority, optional) — hard ceiling on total
 *      estimated tokens. Trims newest-backward until the budget fits.
 *   2. max — maximum message count. Caps the window result.
 *   3. windowDays + min — pick the candidate count from messages in the
 *      time window, falling back to MIN when the window is sparse.
 *
 * Properties:
 * - Quiet weeks still load at least MIN messages (Mastra loads the most
 *   recent ones regardless of date when the window is empty).
 * - Chatty hours are capped at MAX so we never load more rows than needed.
 * - maxTokens guarantees we never blow the context budget regardless of
 *   how many messages MAX allows or how dense each message is.
 * - Brand-new threads with fewer than MIN messages get whatever exists.
 *
 * The actual message loading is still done by Mastra's MessageHistory
 * processor — this helper only computes the right N to pass it.
 */
import type { Memory } from "@mastra/memory";
import type { MastraDBMessage } from "@mastra/core/agent";
import type { Tiktoken } from "js-tiktoken/lite";

/**
 * Lazy-init tiktoken encoder for accurate token counting.
 *
 * Mirrors Mastra's own internal pattern (chunk-JEF7ZU43.js): dynamic import
 * + globalThis cache. The o200k_base encoding is the GPT-4o/5 family
 * tokenizer — close enough for any modern OpenAI-compatible model. The
 * BPE rank table is ~1.5 MB so we only load it on first call.
 */
const TIKTOKEN_GLOBAL_KEY = "__golemTiktoken";
async function getTokenizer(): Promise<Tiktoken> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- globalThis untyped cache
  const g = globalThis as any;
  if (g[TIKTOKEN_GLOBAL_KEY]) return g[TIKTOKEN_GLOBAL_KEY];
  const { Tiktoken: TiktokenClass } = await import("js-tiktoken/lite");
  const o200k_base = (await import("js-tiktoken/ranks/o200k_base")).default;
  const enc = new TiktokenClass(o200k_base);
  g[TIKTOKEN_GLOBAL_KEY] = enc;
  return enc;
}

/**
 * Extract the model-visible text content from a Mastra DB message.
 * Walks the parts array and concatenates text fragments + tool args/results,
 * skipping JSON scaffolding the model never sees.
 */
function extractMessageText(msg: MastraDBMessage): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- content shape varies per part type
  const content = msg.content as any;
  if (typeof content === "string") return content;

  let s = "";
  const parts = content?.parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      if (typeof part.text === "string") s += part.text;
      if (part.args !== undefined) s += JSON.stringify(part.args);
      if (part.result !== undefined) s += JSON.stringify(part.result);
      if (typeof part.image === "string") s += "[image]"; // image marker, the model receives the image as tokenized vision input
    }
  }
  return s;
}

export interface SmartRecallConfig {
  /** Time window in days. Messages outside this window only count if needed to reach MIN. */
  windowDays: number;
  /** Minimum messages to load even if the window is sparse. */
  min: number;
  /** Maximum messages to load even if the window is saturated. */
  max: number;
  /**
   * Optional hard token ceiling for the entire history. When set, this
   * is the highest-priority constraint — count is trimmed newest-first
   * until total estimated tokens ≤ maxTokens.
   */
  maxTokens?: number;
}

export interface SmartRecallResult {
  /** The total number of messages found within the time window. */
  countInWindow: number;
  /** The clamped value to pass to lastMessages. */
  resolved: number;
  /** Why this value was chosen — useful for diagnostics/logging. */
  reason: "below_min" | "in_range" | "above_max" | "token_capped";
  /** Estimated tokens for the resolved message set (only when maxTokens was applied). */
  estimatedTokens?: number;
}

/**
 * Conversation tempo data — how long ago the previous user message was sent.
 *
 * Computed by walking the most recent N messages in the thread (DESC order)
 * and stopping at the first one with role === "user". Returns null when the
 * thread has no user messages yet (brand new conversation).
 */
export interface ConversationTempo {
  /** Milliseconds elapsed since the most recent user message. */
  msSinceLastUserMessage: number;
  /** Timestamp of the most recent user message. */
  lastUserMessageAt: Date;
}

/**
 * Find the most recent user message in this thread and compute the elapsed
 * time since it was sent. Returns null if no user message exists.
 *
 * Looks at the last 10 messages (cheap) — handles edge cases where there are
 * intervening assistant messages, tool results, or system messages between
 * the most recent message and the most recent user message.
 */
export async function getConversationTempo(
  memory: Memory,
  threadId: string,
  resourceId?: string,
): Promise<ConversationTempo | null> {
  const result = await memory.recall({
    threadId,
    ...(resourceId ? { resourceId } : {}),
    perPage: 10,
  });
  // Default order is DESC (newest first). Walk forward, return first user msg.
  for (const msg of result.messages) {
    if (msg.role === "user") {
      const ts = msg.createdAt instanceof Date ? msg.createdAt : new Date(msg.createdAt);
      return {
        msSinceLastUserMessage: Date.now() - ts.getTime(),
        lastUserMessageAt: ts,
      };
    }
  }
  return null;
}

/**
 * Categorize an elapsed-ms duration into one of four discrete bands.
 * Used to give small models a cleaner signal than raw durations.
 *
 * - active: < 2 minutes (live exchange)
 * - recent: 2 minutes – 2 hours (still warm)
 * - stale:  2 hours – 24 hours (came back later in the day)
 * - cold:   > 24 hours (real gap, references may be past)
 */
export type TempoBand = "active" | "recent" | "stale" | "cold";

export function categorizeTempo(ms: number): TempoBand {
  if (ms < 2 * 60_000) return "active";
  if (ms < 2 * 3_600_000) return "recent";
  if (ms < 24 * 3_600_000) return "stale";
  return "cold";
}

/**
 * Render an elapsed-ms duration as a short, natural string.
 *
 * Examples:
 *   3_000          → "just now"
 *   90_000         → "1m"
 *   4_320_000      → "1h 12m"
 *   86_400_000     → "1 day"
 *   259_200_000    → "3 days"
 *   1_209_600_000  → "2 weeks"
 */
export function formatElapsedHuman(ms: number): string {
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMin = minutes % 60;
  if (hours < 24) {
    return remainderMin > 0 ? `${hours}h ${remainderMin}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 14) return days === 1 ? "1 day" : `${days} days`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return weeks === 1 ? "1 week" : `${weeks} weeks`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

/**
 * Count the exact token cost of a single message using the provided tiktoken
 * encoder. Synchronous — loads no resources. Caller is responsible for
 * obtaining the encoder via `getTokenizer()` once before the loop.
 */
function countMessageTokensWith(msg: MastraDBMessage, encoder: Tiktoken): number {
  try {
    const text = extractMessageText(msg);
    return encoder.encode(text).length;
  } catch {
    return 0;
  }
}

/**
 * Public async helper: load the tokenizer (cached) and count exact tokens
 * for a single message. Useful for tests and one-off counting; production
 * code in `computeSmartLastMessages` loads the encoder once outside the loop.
 */
export async function estimateMessageTokens(msg: MastraDBMessage): Promise<number> {
  const enc = await getTokenizer();
  return countMessageTokensWith(msg, enc);
}

/**
 * Compute the smart `lastMessages` value for this turn.
 *
 * Two phases:
 *   1. Window-based count: one cheap recall (perPage: 1) reading `total`
 *      to count messages in the time window, clamped between min and max.
 *   2. (Only when maxTokens is set) Token-aware trim: recall the candidate
 *      messages, walk newest-first accumulating estimated tokens, return
 *      the largest count whose total fits the budget.
 *
 * Phase 2 adds one extra DB read of up to `candidate` messages — at typical
 * settings (max=40) this is microseconds. Phase 2 is skipped entirely when
 * maxTokens is undefined, preserving the cheap path.
 */
export async function computeSmartLastMessages(
  memory: Memory,
  threadId: string,
  cfg: SmartRecallConfig,
  resourceId?: string,
): Promise<SmartRecallResult> {
  // ── Phase 1: window-based count ──
  const start = new Date(Date.now() - cfg.windowDays * 86_400_000);
  const countResult = await memory.recall({
    threadId,
    ...(resourceId ? { resourceId } : {}),
    perPage: 1,
    filter: { dateRange: { start } },
  });
  const countInWindow = countResult.total;

  let candidate: number;
  let reason: SmartRecallResult["reason"];
  if (countInWindow < cfg.min) {
    candidate = cfg.min;
    reason = "below_min";
  } else if (countInWindow > cfg.max) {
    candidate = cfg.max;
    reason = "above_max";
  } else {
    candidate = countInWindow;
    reason = "in_range";
  }

  // No token cap → return the count-based candidate as-is.
  if (cfg.maxTokens === undefined) {
    return { countInWindow, resolved: candidate, reason };
  }

  // ── Phase 2: token-aware trim ──
  // Load the candidate-most-recent messages (default DESC = newest first).
  // Note: we ignore the date filter here — we want the absolute newest N,
  // matching exactly what Mastra's MessageHistory processor will load when
  // we pass `lastMessages: N` back in the override.
  if (candidate === 0) {
    return { countInWindow, resolved: 0, reason, estimatedTokens: 0 };
  }
  const messagesResult = await memory.recall({
    threadId,
    ...(resourceId ? { resourceId } : {}),
    perPage: candidate,
  });
  const messages = messagesResult.messages;

  // Load the tokenizer once before the loop. The encoder is cached on
  // globalThis so subsequent calls (across turns) hit a fast path.
  const encoder = await getTokenizer();

  // Walk newest → oldest, accumulating tokens. Stop before the next would
  // overflow. The kept count is the resolved value.
  let tokensSoFar = 0;
  let kept = 0;
  for (const msg of messages) {
    const t = countMessageTokensWith(msg, encoder);
    if (tokensSoFar + t > cfg.maxTokens) break;
    tokensSoFar += t;
    kept++;
  }

  // If trimming actually reduced the count, mark the reason as token_capped.
  // Otherwise the original window/clamp reason still applies.
  if (kept < candidate) {
    return {
      countInWindow,
      resolved: kept,
      reason: "token_capped",
      estimatedTokens: tokensSoFar,
    };
  }
  return {
    countInWindow,
    resolved: candidate,
    reason,
    estimatedTokens: tokensSoFar,
  };
}
