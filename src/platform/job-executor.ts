/**
 * Platform JobExecutor — polls JobQueue and dispatches to handlers.
 *
 * Replaces the legacy JobWorker with platform-aware transport resolution.
 * Handlers (coding-runner, http-poll) are loaded from scheduler/handlers/.
 */
import fs from "node:fs";
import path from "node:path";
import type { JobQueue, Job } from "../scheduler/job-queue.js";
import type { JobHandler, JobContext, JobResult } from "../scheduler/job-types.js";
import type { TransportManager } from "./transport-manager.js";
import type { AgentRunner } from "./agent-runner.js";
import type { ChatAddress } from "../transport/types.js";
import { logger } from "../utils/external-logger.js";

const POLL_INTERVAL_MS = 5_000;
const MAX_GLOBAL_CONCURRENT = 5;

export interface JobExecutorDeps {
  jobQueue: JobQueue;
  transports: TransportManager;
  runners: Map<string, AgentRunner>;
  handlersDir?: string;
  /** Re-trigger the agent with a synthetic message on job completion. */
  onJobComplete?: (address: ChatAddress, jobType: string, result: JobResult, jobInput: unknown) => Promise<void>;
}

export class JobExecutor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers = new Map<string, JobHandler>();
  private deps: JobExecutorDeps;

  constructor(deps: JobExecutorDeps) {
    this.deps = deps;
  }

  /** Register a handler for a job type. */
  registerHandler(handler: JobHandler): void {
    this.handlers.set(handler.type, handler);
    logger.info(`handler registered: ${handler.type}`, { jobType: handler.type });
  }

  /** Load all handlers from a directory (e.g., scheduler/handlers/). */
  async loadHandlersFromDir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      console.log(`[job-executor] handlers directory not found: ${dir}`);
      return;
    }
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".ts") || f.endsWith(".js"));
    for (const file of files) {
      try {
        const abs = path.resolve(dir, file);
        const mod = await import(`file://${abs}?t=${Date.now()}`);
        for (const value of Object.values(mod)) {
          if (this.isJobHandler(value)) {
            this.registerHandler(value as JobHandler);
          }
        }
      } catch (err) {
        console.error(`[job-executor] failed to load handler from ${file}:`, err);
        logger.error(`handler load failed: ${file} — ${err instanceof Error ? err.message : String(err)}`, { jobType: file });
      }
    }
    logger.info(`loaded ${this.handlers.size} handler(s)`, { dir });
  }

  private isJobHandler(obj: unknown): obj is JobHandler {
    if (!obj || typeof obj !== "object") return false;
    const h = obj as Record<string, unknown>;
    return (
      typeof h.type === "string" &&
      typeof h.maxConcurrent === "number" &&
      typeof h.timeoutMs === "number" &&
      typeof h.maxAttempts === "number" &&
      typeof h.execute === "function"
    );
  }

  /** Start polling the job queue. */
  start(): void {
    if (this.timer) return;

    // Handle orphaned "running" jobs from a previous crash
    const orphaned = this.deps.jobQueue.getRunningJobs?.() ?? [];
    for (const job of orphaned) {
      const addr = this.addressFromJob(job);
      if (job.attempt + 1 < job.max_attempts) {
        this.deps.jobQueue.requeueForRetry(job.id);
        console.log(`[job-executor] job ${job.id} (${job.type}) interrupted by restart, requeued (attempt ${job.attempt + 1}/${job.max_attempts})`);
        logger.warn(`orphan requeued: ${job.type} job ${job.id} (attempt ${job.attempt + 1}/${job.max_attempts})`, { jobId: String(job.id), jobType: job.type, agent: job.agent_id || "" });
        this.sendBestEffort(addr, `🔄 Background ${job.type} job interrupted by restart — retrying automatically.`, job.agent_id);
      } else {
        this.deps.jobQueue.markFailed(job.id, "Process restarted while job was running (final attempt)");
        console.log(`[job-executor] marked orphaned job ${job.id} (${job.type}) as failed`);
        logger.warn(`orphan failed: ${job.type} job ${job.id} — final attempt exhausted`, { jobId: String(job.id), jobType: job.type, agent: job.agent_id || "" });
        this.sendBestEffort(addr, `⚠️ Background ${job.type} job was interrupted by a restart.`, job.agent_id);
      }
      // Unpin stuck progress messages
      this.resolveTransport(addr, job.agent_id)?.unpinMessage?.(addr).catch(() => {});
    }

    console.log("[job-executor] started, polling every 5s");
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log("[job-executor] stopped");
    }
  }

  getRegisteredTypes(): string[] {
    return [...this.handlers.keys()];
  }

  // ── Tick loop ─────────────────────────────────────────────

  private async tick(): Promise<void> {
    try {
      // 1. Handle timed-out jobs
      for (const job of this.deps.jobQueue.getTimedOutJobs()) {
        const addr = this.addressFromJob(job);
        if (job.attempt + 1 < job.max_attempts) {
          this.deps.jobQueue.requeueForRetry(job.id);
          logger.warn(`job timeout, retrying: ${job.type} job ${job.id} (attempt ${job.attempt + 1}/${job.max_attempts})`, { jobId: String(job.id), jobType: job.type, agent: job.agent_id || "" });
        } else {
          this.deps.jobQueue.markFailed(job.id, "Job timed out");
          logger.error(`job timeout, failed: ${job.type} job ${job.id} — all ${job.max_attempts} attempts exhausted`, { jobId: String(job.id), jobType: job.type, agent: job.agent_id || "" });
          this.sendBestEffort(addr, `Background job failed: timed out after ${job.max_attempts} attempts`, job.agent_id);
        }
      }

      // 2. Check global running count
      let totalRunning = this.deps.jobQueue.getRunningCount();
      if (totalRunning >= MAX_GLOBAL_CONCURRENT) return;

      // 3. Dequeue and execute
      for (const handler of this.handlers.values()) {
        const runningForType = this.deps.jobQueue.getRunningCount(handler.type);
        const slots = Math.min(
          handler.maxConcurrent - runningForType,
          MAX_GLOBAL_CONCURRENT - totalRunning,
        );
        if (slots <= 0) continue;

        const jobs = this.deps.jobQueue.dequeueForType(handler.type, slots);
        for (const job of jobs) {
          this.deps.jobQueue.markRunning(job.id);
          totalRunning++;
          logger.info(`job started: ${job.type} job ${job.id}`, { jobId: String(job.id), jobType: job.type, agent: job.agent_id || "" });
          // Fire and forget
          this.executeJob(handler, job).catch(err => {
            console.error(`[job-executor] unhandled error in job ${job.id}:`, err);
            logger.error(`job unhandled error: ${job.type} job ${job.id} — ${err instanceof Error ? err.message : String(err)}`, { jobId: String(job.id), jobType: job.type, agent: job.agent_id || "" });
          });
        }
      }
    } catch (err) {
      console.error("[job-executor] tick error:", err);
    }
  }

  // ── Job execution ─────────────────────────────────────────

  private async executeJob(handler: JobHandler, job: Job): Promise<void> {
    const addr = this.addressFromJob(job);
    const transport = this.resolveTransport(addr, job.agent_id);

    const sendMsg = transport
      ? async (a: ChatAddress, text: string) => { await transport.sendText(a, text); }
      : async (_a: ChatAddress, _text: string) => { console.warn("[job-executor] no transport for job", job.id); };

    const ctx: JobContext = {
      jobId: job.id,
      targetJid: job.target_jid,
      targetAddress: addr,
      sendMessage: sendMsg,
      sendMedia: transport
        ? async (a, urlOrPath, caption) => { await transport.sendMedia(a, { type: "document", filePath: urlOrPath, mimeType: "application/octet-stream", filename: caption }); }
        : async () => {},
      sendMessageReturningId: transport?.sendTextReturningId
        ? async (a, text) => transport.sendTextReturningId!(a, text)
        : undefined,
      editMessage: transport?.editMessage
        ? async (a, mid, text) => transport.editMessage!(a, mid, text)
        : undefined,
      pinMessage: transport?.pinMessage
        ? async (a, mid, silent) => transport.pinMessage!(a, mid, silent)
        : undefined,
      unpinMessage: transport?.unpinMessage
        ? async (a, mid) => transport.unpinMessage!(a, mid!)
        : undefined,
      persistToMemory: undefined, // TODO: wire up per-agent memory persistence
    };

    try {
      const input = JSON.parse(job.input);
      const result = await handler.execute(input, ctx);

      if (result.success) {
        this.deps.jobQueue.markCompleted(job.id, result.data);
        logger.info(`job completed: ${job.type} job ${job.id}`, { jobId: String(job.id), jobType: job.type, agent: job.agent_id || "" });
        if (!result.deliveredToUser) {
          await sendMsg(addr, `Background job completed: ${job.type}`);
        }
        if (this.deps.onJobComplete) {
          await this.deps.onJobComplete(addr, job.type, result, input).catch(err => {
            console.error(`[job-executor] onJobComplete failed for ${job.id}:`, err);
          });
        }
      } else {
        throw new Error(result.error || "Job handler returned failure");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[job-executor] job ${job.id} failed (attempt ${job.attempt + 1}/${job.max_attempts}):`, message);
      logger.error(`job failed: ${job.type} job ${job.id} (attempt ${job.attempt + 1}/${job.max_attempts}) — ${message}`, { jobId: String(job.id), jobType: job.type, agent: job.agent_id || "" });

      if (job.attempt + 1 < job.max_attempts) {
        this.deps.jobQueue.requeueForRetry(job.id);
      } else {
        this.deps.jobQueue.markFailed(job.id, message);
        await sendMsg(addr, `Background job failed: ${message}`).catch(() => {});
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  private addressFromJob(job: Job): ChatAddress {
    return {
      platform: (job.platform as "telegram") || "telegram",
      id: job.target_jid,
    };
  }

  /** Find the transport for a job, using agent_id when available. */
  private resolveTransport(addr: ChatAddress, agentId?: string | null) {
    // 1. Direct lookup by agent_id (fast path for jobs with agent_id set)
    if (agentId) {
      const t = this.deps.transports.get(agentId);
      if (t) return t;
    }

    // 2. Fallback: match by ownerId (for legacy jobs without agent_id)
    for (const [id, runner] of this.deps.runners) {
      const ownerId = String(runner.getOwnerId());
      if (ownerId === addr.id) {
        return this.deps.transports.get(id);
      }
    }

    // No match — caller handles undefined with no-op functions
    console.warn(`[job-executor] no transport found for addr=${addr.id} agentId=${agentId ?? "none"}`);
    return undefined;
  }

  private sendBestEffort(addr: ChatAddress, text: string, agentId?: string | null): void {
    const t = this.resolveTransport(addr, agentId);
    t?.sendText(addr, text).catch(() => {});
  }
}
