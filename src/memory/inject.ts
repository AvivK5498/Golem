/**
 * Inject out-of-band messages into Mastra Memory.
 *
 * Used when messages are sent outside of agent.generate() — e.g. job worker
 * deliveries, task timer reminders, admin command responses — so the agent
 * can reference them on subsequent turns via lastMessages / semanticRecall.
 */
import type { Memory } from "@mastra/memory";
import { randomUUID } from "node:crypto";
import type { ChatAddress } from "../transport/types.js";
import { makeThreadId } from "../transport/address-utils.js";

/**
 * Persist a message directly into Mastra Memory storage.
 *
 * - If `memory` is undefined (memory disabled), this is a silent no-op.
 * - If the thread does not yet exist it is created automatically.
 * - Errors are caught and logged — this must never break the caller.
 */
export async function injectOutOfBandMessage(
  memory: Memory | undefined,
  threadIdOrAddress: string | ChatAddress,
  role: "user" | "assistant",
  text: string,
  resourceId?: string,
): Promise<void> {
  if (!memory) return;

  // Resolve thread ID: ChatAddress -> platform-qualified, string -> use as-is
  const threadId = typeof threadIdOrAddress === "string"
    ? threadIdOrAddress
    : makeThreadId(threadIdOrAddress);

  const resolvedResourceId = resourceId || threadId;

  try {
    // Ensure the thread exists (getThreadById returns null if missing)
    const existing = await memory.getThreadById({ threadId });
    if (!existing) {
      await memory.saveThread({
        thread: {
          id: threadId,
          resourceId: resolvedResourceId,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }

    await memory.saveMessages({
      messages: [
        {
          id: randomUUID(),
          role,
          createdAt: new Date(),
          threadId,
          resourceId: resolvedResourceId,
          content: {
            format: 2,
            parts: [{ type: "text" as const, text }],
          },
        },
      ],
    });
  } catch (err) {
    console.error("[memory] failed to inject out-of-band message:", err);
  }
}
