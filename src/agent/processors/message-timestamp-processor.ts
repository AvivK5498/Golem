/**
 * MessageTimestampProcessor — prepends an absolute timestamp to each historical
 * user message so the agent can reason about per-message timing.
 *
 * The marker format is `[Apr 18 09:35] ` (or `[Apr 18 2025 09:35] ` when the
 * message is from a previous year). Absolute markers are stable across turns,
 * so they don't invalidate the Anthropic prompt cache. The agent already knows
 * the current wall-clock time from the system prompt's dynamic block and can
 * compute elapsed itself.
 *
 * Lifecycle:
 * - processInput: runs once per turn, before the LLM call. Walks the messages
 *   array, finds user messages, prepends `[Apr 18 09:35] ` to the first text
 *   part. Returns NEW message objects so persistence is unaffected.
 *
 * Skipped:
 * - When the agent's tempo setting is off (gated by `memoryTempoEnabled`).
 * - The most recent user message (current turn — no marker needed).
 * - Assistant messages (only user message timing matters for tempo).
 * - Messages without createdAt or with non-parts content shapes.
 *
 * The DB stays clean: this transformation runs in-memory between recall and
 * the model call, never reaching storage.
 */
import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/memory";

const TZ = "Asia/Jerusalem";

const ABS_MARKER_FMT_SAMEYEAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const ABS_MARKER_FMT_OLDYEAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatAbsoluteMarker(date: Date, now: Date): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  const fmt = sameYear ? ABS_MARKER_FMT_SAMEYEAR : ABS_MARKER_FMT_OLDYEAR;
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  const month = get("month");
  const day = get("day");
  const year = sameYear ? "" : ` ${get("year")}`;
  const hour = get("hour");
  const minute = get("minute");
  return `${month} ${day}${year} ${hour}:${minute}`;
}

// Match either the new absolute marker `[Apr 18 09:35] ` or the legacy
// relative marker `[3 minutes ago] ` so we don't double-stamp messages that
// were saved with the old format and recalled now.
const MARKER_DETECTOR = /^\[(?:[A-Z][a-z]{2} \d{1,2}(?: \d{4})? \d{2}:\d{2}|[^\]]* ago)\] /;

export class MessageTimestampProcessor implements Processor {
  id = "message-timestamp";

  async processInput({ messages, requestContext }: {
    messages: MastraDBMessage[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- requestContext shape varies
    requestContext?: { get: (key: string) => any };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): Promise<MastraDBMessage[]> {
    // Gate: only run when tempo awareness is enabled for this agent.
    if (!requestContext?.get("memoryTempoEnabled")) return messages;

    const lastUserIdx = findLastUserIdx(messages);
    if (lastUserIdx < 0) return messages;

    const now = new Date();
    let changed = false;
    const out: MastraDBMessage[] = messages.map((msg, idx) => {
      // Skip the current turn and any non-user messages.
      if (idx === lastUserIdx) return msg;
      if ((msg as { role?: string }).role !== "user") return msg;

      const createdAtRaw = (msg as { createdAt?: Date | string }).createdAt;
      if (!createdAtRaw) return msg;
      const createdAt = createdAtRaw instanceof Date ? createdAtRaw : new Date(createdAtRaw);
      // Suppress markers for messages within the same minute as now — the
      // agent can see those as "current" without needing a stamp.
      if (now.getTime() - createdAt.getTime() < 60_000) return msg;

      const marker = `[${formatAbsoluteMarker(createdAt, now)}] `;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- content shape varies
      const content = msg.content as any;
      if (!content || typeof content !== "object" || !Array.isArray(content.parts)) {
        return msg;
      }
      let prepended = false;
      const newParts = content.parts.map((part: { type?: string; text?: string }) => {
        if (!prepended && part.type === "text" && typeof part.text === "string") {
          prepended = true;
          // Already stamped (either new absolute or legacy relative format) — pass through.
          if (MARKER_DETECTOR.test(part.text)) return part;
          return { ...part, text: marker + part.text };
        }
        return part;
      });
      if (!prepended) return msg;
      changed = true;
      return { ...msg, content: { ...content, parts: newParts } } as MastraDBMessage;
    });

    return changed ? out : messages;
  }
}

function findLastUserIdx(messages: MastraDBMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if ((messages[i] as { role?: string }).role === "user") return i;
  }
  return -1;
}
