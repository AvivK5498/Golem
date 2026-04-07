import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { CodingSessionManager } from "./session-manager.js";
import type { ProgressCallback } from "./runtime.js";
import type { JobQueue } from "../scheduler/job-queue.js";
import type { MessageTransport } from "../transport/interface.js";

let sessionManager: CodingSessionManager | null = null;
let progressSender: ProgressCallback | null = null;
let progressFlusher: (() => Promise<void>) | null = null;

export function setCodingSessionManager(mgr: CodingSessionManager): void {
  sessionManager = mgr;
}

export function getCodingSessionManager(): CodingSessionManager | null {
  return sessionManager;
}

/**
 * Register a function that sends live progress updates to the owner.
 * Called by the daemon after transports are initialized.
 */
export function setCodingProgressSender(sender: ProgressCallback, flusher?: () => Promise<void>): void {
  progressSender = sender;
  progressFlusher = flusher ?? null;
}

export const codeAgentTool = createTool({
  id: "code_agent",
  description:
    "Delegate a coding task to Claude Code. Runs asynchronously — returns immediately with a job ID. " +
    "Progress updates appear as a pinned message that refreshes every 15s. " +
    "The full result is injected into conversation context when the task completes. " +
    "Use for writing code, editing source files, debugging, refactoring, running tests, " +
    "or installing dependencies. The coding agent works within the project directory. " +
    "Do NOT use this for tasks you can accomplish with your own tools — " +
    "for monitoring/polling use cron + web_fetch instead. " +
    "Use this instead of run_command for anything beyond simple shell commands.",
  inputSchema: z.object({
    task: z.string().describe("Natural language coding task description. Use markdown: *bold* for headers, `code` for file/function names, bullet points for steps."),
    effort: z.enum(["low", "high"]).describe(
      "low = Sonnet (single-file edits, small fixes, tests, config changes). " +
      "high = Opus (multi-file features, complex refactors, deep debugging, architectural work)."
    ),
    cwd: z.string().optional().describe("Working directory for the coding agent (default: process.cwd())"),
  }),
  inputExamples: [
    { input: { task: "Add input validation to the `createUser` function in `src/api/users.ts`. Reject empty email and name fields with descriptive error messages.", effort: "low" } },
    { input: { task: "Refactor the scheduler module to support priority queues. Update `src/scheduler/job-queue.ts` and add tests.", effort: "high" } },
  ],
  execute: async (input, context) => {
    console.log(`[coding] code_agent invoked: effort=${input.effort}, task=${input.task.slice(0, 120)}`);

    if (!sessionManager) {
      console.error("[coding] code_agent failed: sessionManager is null — coding system not initialized");
      return "Coding agent system is not available. Ensure Claude Code is installed (`npm install -g @anthropic-ai/claude-code`).";
    }

    // Auto-resolve cwd: repo path from integration takes priority (agent can't escape the repo).
    // Falls back to LLM-provided cwd, then process.cwd().
    const repoPath = context?.requestContext?.get("repoPath" as never) as unknown as string | undefined;
    const cwd = repoPath || input.cwd || process.cwd();
    const model = input.effort === "high" ? "claude-opus-4-6" : "claude-sonnet-4-6";
    console.log(`[coding] resolved cwd=${cwd}, model=${model}`);

    // Try async dispatch via job queue
    const jobQueue = context?.requestContext?.get("jobQueue" as never) as unknown as JobQueue | undefined;
    if (jobQueue) {
      const targetJid = context?.requestContext?.get("jid" as never) as unknown as string | undefined;
      if (!targetJid) return "Error: target_jid is required for async coding tasks";
      const transport = context?.requestContext?.get("transport" as never) as unknown as MessageTransport | undefined;
      const platform = transport?.platform || "telegram";

      const eventSource = context?.requestContext?.get("eventSource" as never) as unknown as string | undefined;
      const slackThreadId = context?.requestContext?.get("slackThreadId" as never) as unknown as string | undefined;

      // Dedup: block if a coding job is already queued or running (cross-turn, persisted in SQLite).
      const hasActive = jobQueue.hasActiveJob("coding", (existing: unknown) => {
        const e = existing as { task?: string };
        return !!e.task; // any active coding job blocks new ones
      });
      if (hasActive) {
        return "A coding task is already running. Wait for it to complete before dispatching another.";
      }

      // Per-turn dedup: block parallel tool calls within the same step.
      const rc = context?.requestContext;
      if (rc) {
        const alreadyDispatched = rc.get("_asyncJobDispatched" as never) as unknown as boolean | undefined;
        if (alreadyDispatched) {
          return "A coding task was already dispatched this turn. Wait for it to complete before dispatching another.";
        }
        rc.set("_asyncJobDispatched" as never, true as never);
      }

      const agentId = context?.requestContext?.get("agentId" as never) as unknown as string || "unknown";
      const jobId = jobQueue.enqueue(
        "coding",
        { task: input.task, cwd, model, ...(eventSource ? { _eventSource: eventSource } : {}), ...(slackThreadId ? { _slackThreadId: slackThreadId } : {}) },
        targetJid,
        agentId,
        { timeoutMs: 1_200_000, maxAttempts: 1 },
        platform,
      );

      console.log(`[coding] job dispatched: id=${jobId}, agent=${agentId}, target=${targetJid}, platform=${platform}`);
      return `Coding task dispatched (job ${jobId}, ${input.effort} effort → ${model}). Progress will appear as a pinned message. Result will be injected into our conversation when done.`;
    }

    // Fallback: synchronous execution (no job queue available)
    console.log("[coding] no job queue available, executing synchronously");
    try {
      const result = await sessionManager.execute(input.task, cwd, "claude", progressSender ?? undefined, model);
      if (progressFlusher) await progressFlusher().catch(() => {});
      console.log(`[coding] sync execution done: success=${result.success}, duration=${Math.round(result.durationMs / 1000)}s`);
      const truncated = result.output.length > 10_000
        ? result.output.slice(0, 10_000) + "\n...[output truncated at 10KB]"
        : result.output;
      return `[${result.agent}] ${result.success ? "OK" : "FAILED"} (${Math.round(result.durationMs / 1000)}s)\n${truncated}`;
    } catch (err) {
      if (progressFlusher) await progressFlusher().catch(() => {});
      console.error("[coding] sync execution error:", err instanceof Error ? err.stack || err.message : String(err));
      return `Coding agent error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});
