/**
 * SubAgentResultCompactor — strips sub-agent internals from tool results.
 *
 * Runs in two phases:
 *   1. processInputStep — strips sub-agent payloads from historical messages
 *      BEFORE the LLM sees them on step 2+. This prevents 5-15K tokens of
 *      SKILL.md content, raw HTML, and intermediate CLI outputs from bloating
 *      the context on follow-up steps within the same turn.
 *
 *   2. processOutputResult — strips sub-agent payloads AFTER the turn completes,
 *      before messages are persisted to memory. This prevents bloat on future
 *      turns when lastMessages loads conversation history.
 *
 * When the primary agent delegates to a sub-agent (e.g., agent-google-workspace), Mastra
 * returns a JSON object as the tool result containing:
 *   - text: the sub-agent's final response (what the primary agent uses)
 *   - subAgentThreadId: internal thread ID
 *   - subAgentResourceId: internal resource ID
 *   - subAgentToolResults: array of every intermediate tool call the sub-agent made
 *
 * This processor replaces the full JSON with just the .text value.
 */
import type { Processor } from "@mastra/core/processors";
import type { MastraDBMessage } from "@mastra/core/agent";

/**
 * Try to extract .text from a sub-agent result JSON string.
 * Returns the extracted text, or null if the string isn't a sub-agent result.
 */
function extractSubAgentText(raw: string): string | null {
  // Quick heuristic: sub-agent results contain "subAgentToolResults"
  if (!raw.includes("subAgentToolResults")) return null;

  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.text === "string" &&
      ("subAgentToolResults" in parsed || "subAgentThreadId" in parsed)
    ) {
      return parsed.text;
    }
  } catch {
    // JSON parse failed — try a regex extraction as fallback.
    // The .text field is always first in the serialized object.
    // Match: {"text":"...","subAgent
    const match = raw.match(/^\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"subAgent/);
    if (match) {
      try {
        // Unescape the JSON string value
        return JSON.parse(`"${match[1]}"`);
      } catch {
        // If unescape fails, return raw match (still better than the full blob)
        return match[1];
      }
    }
  }
  return null;
}

/**
 * Process a single content part, compacting sub-agent results.
 */
function compactPart(part: Record<string, unknown>): Record<string, unknown> {
  // Handle tool-invocation parts (format 2 messages)
  if (part.type === "tool-invocation" && part.toolInvocation) {
    const inv = part.toolInvocation as Record<string, unknown>;
    if (inv.state === "result" && typeof inv.result === "string") {
      const extracted = extractSubAgentText(inv.result);
      if (extracted !== null) {
        return {
          ...part,
          toolInvocation: { ...inv, result: extracted },
        };
      }
    }
    // Also handle result as object (some serialization paths)
    if (inv.state === "result" && typeof inv.result === "object" && inv.result !== null) {
      const resultObj = inv.result as Record<string, unknown>;
      if (typeof resultObj.text === "string" && ("subAgentToolResults" in resultObj || "subAgentThreadId" in resultObj)) {
        return {
          ...part,
          toolInvocation: { ...inv, result: resultObj.text },
        };
      }
    }
  }

  // Handle text parts in tool role messages (stringified JSON as text)
  if (part.type === "text" && typeof part.text === "string") {
    const extracted = extractSubAgentText(part.text);
    if (extracted !== null) {
      return { ...part, text: extracted };
    }
  }

  return part;
}

/**
 * Compact all sub-agent results in a message array.
 * Returns { messages, compactedCount }.
 */
function compactMessages(messages: MastraDBMessage[]): { messages: MastraDBMessage[]; compactedCount: number } {
  let compactedCount = 0;

  const result = messages.map((msg) => {
    const rawContent = (msg as { content?: unknown }).content;

    // Case 1: content is a plain string (tool role with JSON string content)
    if (typeof rawContent === "string") {
      const extracted = extractSubAgentText(rawContent);
      if (extracted !== null) {
        compactedCount++;
        return { ...(msg as Record<string, unknown>), content: extracted } as unknown as MastraDBMessage;
      }
      return msg;
    }

    // Case 2: content has parts array (format 2 messages)
    const content = rawContent as { parts?: unknown[]; [key: string]: unknown } | undefined;
    if (!Array.isArray(content?.parts)) return msg;

    let changed = false;
    const newParts = content.parts.map((rawPart) => {
      const part = rawPart as Record<string, unknown>;
      const compacted = compactPart(part);
      if (compacted !== part) changed = true;
      return compacted;
    });

    if (changed) {
      compactedCount++;
      return { ...msg, content: { ...content, parts: newParts } } as unknown as MastraDBMessage;
    }
    return msg;
  });

  return { messages: result, compactedCount };
}

export class SubAgentResultCompactor implements Processor {
  readonly id = "sub-agent-result-compactor";

  /**
   * Input phase: strip sub-agent payloads from historical messages on step 1+
   * so the LLM doesn't see 5-15K tokens of SKILL.md/CLI output from step 1's delegation.
   * Step 0 is skipped — no historical sub-agent results exist yet.
   */
  processInputStep({
    messages,
  }: {
    messages: MastraDBMessage[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }): MastraDBMessage[] | void {

    const { messages: compacted, compactedCount } = compactMessages(messages);
    if (compactedCount > 0) {
      console.log(`[sub-agent-compactor] Stripped ${compactedCount} sub-agent payload(s) on input`);
    }
    return compactedCount > 0 ? compacted : undefined;
  }

  /**
   * Output phase: strip sub-agent payloads before messages are persisted to memory.
   */
  processOutputResult({
    messages,
  }: {
    messages: MastraDBMessage[];
  }): MastraDBMessage[] {
    const { messages: compacted, compactedCount } = compactMessages(messages);
    if (compactedCount > 0) {
      console.log(`[sub-agent-compactor] Compacted ${compactedCount} sub-agent result(s) before persistence`);
    }
    return compacted;
  }
}
