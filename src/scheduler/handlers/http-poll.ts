/**
 * Generic HTTP poll handler — submit a request, poll for completion, deliver result.
 * Works with any async API: RunPod, Replicate, fal.ai, CircleCI, etc.
 */
import type { JobHandler, JobContext, JobResult } from "../job-types.js";
import { logger } from "../../utils/external-logger.js";

export interface HttpPollInput {
  /** Human-readable label for messages, e.g. "video generation" */
  label: string;

  // -- Submit --
  submitUrl: string;
  submitMethod?: "POST" | "PUT";
  submitHeaders?: Record<string, string>;
  submitBody?: unknown;
  /** Dot-path to extract job ID from submit response, e.g. "id" or "data.job.id" */
  jobIdPath: string;

  // -- Poll --
  /** URL template with ${jobId} placeholder, e.g. "https://api.example.com/status/${jobId}" */
  statusUrlTemplate: string;
  statusHeaders?: Record<string, string>;
  /** Dot-path to status field, e.g. "status" */
  statusPath: string;
  /** Status values that mean completed */
  completedStatuses: string[];
  /** Status values that mean failed */
  failedStatuses?: string[];
  /** Dot-path to extract the result on completion, e.g. "output.url" */
  resultPath: string;
  /** Dot-path to extract error message on failure */
  errorPath?: string;

  // -- Options --
  pollIntervalMs?: number;   // default 10000
  maxPollMs?: number;        // default 600000 (10 min)
}

/** Replace ${ENV_VAR} patterns with process.env values throughout an object. */
function resolveEnvVars<T>(obj: T): T {
  if (typeof obj === "string") {
    return obj.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, key) => {
      return process.env[key] ?? `\${${key}}`;
    }) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvVars) as T;
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = resolveEnvVars(v);
    }
    return result as T;
  }
  return obj;
}

function getByPath(obj: unknown, path: string): unknown {
  let current = obj;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m${sec.toString().padStart(2, "0")}s` : `${sec}s`;
}

export const httpPollHandler: JobHandler = {
  type: "http-poll",
  maxConcurrent: 5,
  timeoutMs: 25 * 60 * 1000,
  maxAttempts: 2,

  async execute(input: unknown, ctx: JobContext): Promise<JobResult> {
    const raw = input as HttpPollInput;
    // Resolve ${ENV_VAR} references in string values so API keys
    // aren't stored in the job queue — only the variable name is stored.
    const cfg = resolveEnvVars(raw);
    const label = cfg.label || "background job";
    const pollInterval = cfg.pollIntervalMs ?? 10_000;
    const maxPoll = cfg.maxPollMs ?? 600_000;
    const startTime = Date.now();
    logger.info(`http-poll job started: ${label}`, { jobId: ctx.jobId, jobType: "http-poll" });
    const canEdit = !!ctx.sendMessageReturningId && !!ctx.editMessage;

    let pinnedMessageId: number | null = null;
    const header = `⚡ **${label}** started\n`;

    // -- Pin initial message --
    if (canEdit) {
      try {
        pinnedMessageId = await ctx.sendMessageReturningId!(
          ctx.targetAddress,
          header + "_Submitting..._",
        );
        await ctx.pinMessage?.(ctx.targetAddress, pinnedMessageId, true);
      } catch {
        // fall through to non-edit path
      }
    }
    if (!pinnedMessageId) {
      await ctx.sendMessage(ctx.targetAddress, header + "Submitting...").catch(() => {});
    }

    const editPinned = async (body: string) => {
      if (canEdit && pinnedMessageId) {
        await ctx.editMessage!(ctx.targetAddress, pinnedMessageId, header + body).catch(() => {});
      }
    };

    // -- Submit --
    let submitResponse: unknown;
    try {
      const res = await fetch(cfg.submitUrl, {
        method: cfg.submitMethod || "POST",
        headers: {
          "Content-Type": "application/json",
          ...cfg.submitHeaders,
        },
        body: cfg.submitBody ? JSON.stringify(cfg.submitBody) : undefined,
      });

      if (!res.ok) {
        const errText = await res.text();
        const msg = `Submit failed (${res.status}): ${errText.slice(0, 500)}`;
        logger.error(`http-poll submit failed: ${label} — ${msg.slice(0, 200)}`, { jobId: ctx.jobId, jobType: "http-poll" });
        await editPinned(`❌ ${msg}`);
        await ctx.unpinMessage?.(ctx.targetAddress, pinnedMessageId!).catch(() => {});
        return { success: false, error: msg };
      }

      submitResponse = await res.json();
    } catch (err) {
      const msg = `Submit error: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(`http-poll submit error: ${label} — ${msg.slice(0, 200)}`, { jobId: ctx.jobId, jobType: "http-poll" });
      await editPinned(`❌ ${msg}`);
      await ctx.unpinMessage?.(ctx.targetAddress, pinnedMessageId!).catch(() => {});
      return { success: false, error: msg };
    }

    const jobId = String(getByPath(submitResponse, cfg.jobIdPath) ?? "");
    if (!jobId) {
      const msg = `No job ID at path "${cfg.jobIdPath}" in response: ${JSON.stringify(submitResponse).slice(0, 300)}`;
      await editPinned(`❌ ${msg}`);
      await ctx.unpinMessage?.(ctx.targetAddress, pinnedMessageId!).catch(() => {});
      return { success: false, error: msg };
    }

    await editPinned(`Submitted (ID: \`${jobId}\`)\n_Polling..._`);

    // -- Poll --
    const statusUrl = cfg.statusUrlTemplate.replace("${jobId}", jobId);
    const failedStatuses = new Set((cfg.failedStatuses ?? ["FAILED", "ERROR"]).map((s) => s.toUpperCase()));
    const completedStatuses = new Set(cfg.completedStatuses.map((s) => s.toUpperCase()));
    let lastStatus = "";
    let pollCount = 0;

    while (Date.now() - startTime < maxPoll) {
      await new Promise((r) => setTimeout(r, pollInterval));
      pollCount++;

      let statusResponse: unknown;
      try {
        const res = await fetch(statusUrl, {
          headers: cfg.statusHeaders,
        });
        if (!res.ok) {
          console.error(`[http-poll] status check ${pollCount} failed: ${res.status}`);
          continue; // transient — keep polling
        }
        statusResponse = await res.json();
      } catch (err) {
        console.error(`[http-poll] status check ${pollCount} error: ${err}`);
        continue;
      }

      const rawStatus = String(getByPath(statusResponse, cfg.statusPath) ?? "UNKNOWN");
      const normalizedStatus = rawStatus.toUpperCase();
      lastStatus = rawStatus;

      // Update pinned message on every poll tick (shows live elapsed time)
      const elapsed = formatElapsed(Date.now() - startTime);
      await editPinned(
        `Submitted (ID: \`${jobId}\`)\n` +
        `\`[${elapsed}]\` Status: **${rawStatus}**`,
      );

      // -- Completed --
      if (completedStatuses.has(normalizedStatus)) {
        const result = getByPath(statusResponse, cfg.resultPath);
        const elapsed = formatElapsed(Date.now() - startTime);
        logger.info(`http-poll completed: ${label} (${elapsed}, ${pollCount} polls)`, { jobId: ctx.jobId, jobType: "http-poll" });

        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        const finalBody =
          `✅ **Done** (${elapsed})\n` +
          `ID: \`${jobId}\`\n` +
          `Result: ${resultStr}`;

        await editPinned(finalBody);
        await ctx.unpinMessage?.(ctx.targetAddress, pinnedMessageId!).catch(() => {});

        // Persist to conversation memory
        if (ctx.persistToMemory) {
          await ctx.persistToMemory([
            { role: "user", text: `[${label}]` },
            { role: "assistant", text: `${label} completed: ${resultStr}` },
          ]).catch(() => {});
        }

        return {
          success: true,
          data: { jobId, result, statusResponse },
          deliveredToUser: true,
        };
      }

      // -- Failed --
      if (failedStatuses.has(normalizedStatus)) {
        const errorMsg = cfg.errorPath
          ? String(getByPath(statusResponse, cfg.errorPath) ?? rawStatus)
          : rawStatus;
        const elapsed = formatElapsed(Date.now() - startTime);
        logger.error(`http-poll failed: ${label} (${elapsed}) — ${errorMsg.slice(0, 200)}`, { jobId: ctx.jobId, jobType: "http-poll" });

        await editPinned(`❌ **Failed** (${elapsed})\nID: \`${jobId}\`\nError: ${errorMsg}`);
        await ctx.unpinMessage?.(ctx.targetAddress, pinnedMessageId!).catch(() => {});

        return { success: false, error: errorMsg };
      }

      // Otherwise keep polling (IN_QUEUE, IN_PROGRESS, RUNNING, etc.)
    }

    // -- Timeout --
    const elapsed = formatElapsed(Date.now() - startTime);
    logger.error(`http-poll timeout: ${label} (${elapsed}, ${pollCount} polls) — last status: ${lastStatus}`, { jobId: ctx.jobId, jobType: "http-poll" });
    await editPinned(`⏰ **Timed out** (${elapsed})\nID: \`${jobId}\`\nLast status: ${lastStatus}`);
    await ctx.unpinMessage?.(ctx.targetAddress, pinnedMessageId!).catch(() => {});

    return { success: false, error: `Polling timed out after ${elapsed}. Last status: ${lastStatus}` };
  },
};
