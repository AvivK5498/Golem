/**
 * Shared types for tool context.
 * Tool execution is handled by mastra-tools.ts via the Mastra Agent.
 */
import type { MessageTransport } from "../transport/index.js";
import type { CronStore } from "../scheduler/cron-store.js";
import type { JobQueue } from "../scheduler/job-queue.js";

export interface ToolContext {
  transport: MessageTransport;
  cronStore?: CronStore;
  jobQueue?: JobQueue;
  agentId?: string;
}
