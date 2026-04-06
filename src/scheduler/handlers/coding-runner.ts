import { generateText } from "ai";
import { getNanoModel } from "../../agent/model.js";
import type { JobHandler, JobContext, JobResult } from "../job-types.js";
import { logger } from "../../utils/external-logger.js";

const PROGRESS_INTERVAL = 15_000; // edit pinned message every 15s

/** Ask a nano model to summarize raw tool activity into a short update. */
async function summarizeProgress(task: string, rawLines: string[]): Promise<string> {
  try {
    const { text } = await generateText({
      model: getNanoModel(),
      temperature: 0,
      maxOutputTokens: 150,
      system:
        "You summarize coding agent activity into a 1-2 sentence progress update. " +
        "Be concise and specific — mention file names (basename only) and what actions were taken. " +
        "No filler words. Example: 'Reading telegram-transport.ts and telegram-format.ts, then editing sendText to add HTML formatting.'",
      prompt: `Task: ${task.slice(0, 200)}\n\nRecent tool activity:\n${rawLines.join("\n")}`,
    });
    return text.trim() || rawLines.join("\n");
  } catch {
    return rawLines.join("\n"); // fallback to raw on error
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m${sec.toString().padStart(2, "0")}s` : `${sec}s`;
}

export const codingRunnerHandler: JobHandler = {
  type: "coding",
  maxConcurrent: 2,
  timeoutMs: 600_000, // 10 minutes
  maxAttempts: 3,
  async execute(input: unknown, ctx: JobContext): Promise<JobResult> {
    const { getCodingSessionManager } = await import("../../coding/tool.js");
    const mgr = getCodingSessionManager();
    if (!mgr) {
      logger.error("coding job failed: coding system not initialized", { jobId: ctx.jobId, jobType: "coding" });
      return { success: false, error: "Coding system not initialized" };
    }

    const { task, cwd, model } = input as { task: string; cwd: string; model?: string };
    logger.info(`coding job started: ${task.slice(0, 100)}`, { jobId: ctx.jobId, jobType: "coding" });
    const startTime = Date.now();
    const canEdit = !!ctx.sendMessageReturningId && !!ctx.editMessage;

    // Accumulated progress lines for the pinned message
    const allUpdates: string[] = [];
    let pinnedMessageId: number | null = null;
    const pendingLines: string[] = [];
    let lastEditTime = Date.now();

    // Send initial pinned message
    const header = `⚡ *Coding task started*\n${task.length > 500 ? task.slice(0, 500) + "..." : task}\n`;

    if (canEdit) {
      try {
        pinnedMessageId = await ctx.sendMessageReturningId!(ctx.targetAddress, header + "\n_Starting..._");
        await ctx.pinMessage?.(ctx.targetAddress, pinnedMessageId, true);
      } catch (err) {
        console.error("[coding-runner] failed to send/pin initial message:", err);
      }
    } else {
      await ctx.sendMessage(ctx.targetAddress, header).catch(() => {});
    }

    // Progress callback — batch and edit the pinned message
    const onProgress = async (message: string) => {
      pendingLines.push(message);
      const now = Date.now();

      if (now - lastEditTime >= PROGRESS_INTERVAL && pendingLines.length > 0) {
        const batch = pendingLines.splice(0);
        lastEditTime = now;

        const summary = await summarizeProgress(task, batch);
        const elapsed = formatElapsed(now - startTime);
        allUpdates.push(`\`[${elapsed}]\` ${summary}`);

        if (canEdit && pinnedMessageId) {
          const body = allUpdates.join("\n");
          await ctx.editMessage!(ctx.targetAddress, pinnedMessageId, header + "\n" + body).catch(() => {});
        }
      }
    };

    // Execute the coding task
    const result = await mgr.execute(task, cwd, "claude", onProgress, model);

    // Build the result FIRST so we can return early if post-processing crashes.
    // The job-worker calls markCompleted after execute() returns, so returning
    // success here is the critical path — everything after is best-effort.
    const jobResult: JobResult = {
      success: result.success,
      data: { output: result.output, agent: result.agent, durationMs: result.durationMs },
      deliveredToUser: true,
    };

    if (result.success) {
      logger.info(`coding job completed (${formatElapsed(result.durationMs)})`, { jobId: ctx.jobId, jobType: "coding" });
    } else {
      logger.error(`coding job failed (${formatElapsed(result.durationMs)}): ${(result.output || "unknown error").slice(0, 200)}`, { jobId: ctx.jobId, jobType: "coding" });
    }

    // Best-effort: flush progress, edit pinned message, persist to memory.
    // If any of this crashes (e.g., Telegram API error), the job is still marked completed.
    try {
      if (pendingLines.length > 0) {
        const summary = await summarizeProgress(task, pendingLines);
        const elapsed = formatElapsed(Date.now() - startTime);
        allUpdates.push(`\`[${elapsed}]\` ${summary}`);
      }

      const duration = formatElapsed(result.durationMs);
      const status = result.success ? "✅ Coding agent finished" : "❌ Coding agent failed";

      const finalMessage = `${header}\n${status} (${duration})`;

      if (canEdit && pinnedMessageId) {
        await ctx.editMessage!(ctx.targetAddress, pinnedMessageId, finalMessage).catch(() => {});
        try {
          await ctx.unpinMessage?.(ctx.targetAddress, pinnedMessageId);
          console.log(`[coding-runner] unpinned message ${pinnedMessageId}`);
        } catch (unpinErr) {
          console.error(`[coding-runner] failed to unpin message ${pinnedMessageId}:`, unpinErr instanceof Error ? unpinErr.message : unpinErr);
        }
      } else {
        await ctx.sendMessage(ctx.targetAddress, finalMessage).catch(() => {});
      }

      if (ctx.persistToMemory) {
        const userText = `[Coding task] ${task}`;
        const assistantText = finalMessage;

        await ctx.persistToMemory([
          { role: "user", text: userText },
          { role: "assistant", text: assistantText },
        ]).catch((err) => {
          console.error("[coding-runner] failed to persist to memory:", err);
        });
      }
    } catch (postErr) {
      console.error("[coding-runner] post-processing failed (job still marked complete):", postErr);
    }

    return jobResult;
  },
};
