import { randomUUID } from "node:crypto";

/**
 * Serializes a single text message into the Mastra format-2 shape and saves it.
 *
 * @param memory - A Mastra Memory instance (typed loosely; callers use `as any`).
 * @param opts.role - Message role, defaults to 'assistant'.
 * @param opts.threadId - The thread to save into.
 * @param opts.resourceId - The resource (user) the thread belongs to.
 * @param opts.text - The message body.
 * @param opts.createdAt - Optional timestamp; defaults to now. Pass a backdated Date for seeding historical messages.
 */
export async function saveMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  memory: any,
  {
    role = "assistant",
    threadId,
    resourceId,
    text,
    createdAt,
  }: {
    role?: "user" | "assistant";
    threadId: string;
    resourceId: string;
    text: string;
    createdAt?: Date;
  }
): Promise<void> {
  if (memory == null) return;

  const msg = {
    id: randomUUID(),
    role,
    threadId,
    resourceId,
    createdAt: createdAt ?? new Date(),
    content: { format: 2, parts: [{ type: "text", text }] },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await memory.saveMessages({ messages: [msg] } as any);
}

/**
 * Thin alias for `saveMessage` that always uses role='assistant'.
 * Used by the reminder scheduler (Task 4) after delivering a reminder
 * so the agent has continuity on the next user turn.
 */
export async function saveAssistantMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  memory: any,
  opts: { threadId: string; resourceId: string; text: string }
): Promise<void> {
  return saveMessage(memory, { role: "assistant", ...opts });
}
