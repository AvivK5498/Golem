/**
 * Shared types for background job handlers.
 * Handlers implement JobHandler and are executed by the platform's job runner.
 */
import type { ChatAddress } from "../transport/types.js";

export interface JobHandler {
  type: string;
  maxConcurrent: number;
  timeoutMs: number;
  maxAttempts: number;
  execute(input: unknown, ctx: JobContext): Promise<JobResult>;
}

export interface JobContext {
  jobId: string;
  targetJid: string;
  targetAddress: ChatAddress;
  sendMessage: (address: ChatAddress, text: string) => Promise<void>;
  sendMedia: (address: ChatAddress, urlOrPath: string, caption?: string) => Promise<void>;
  sendMessageReturningId?: (address: ChatAddress, text: string) => Promise<number>;
  editMessage?: (address: ChatAddress, messageId: number, text: string) => Promise<void>;
  pinMessage?: (address: ChatAddress, messageId: number, silent?: boolean) => Promise<void>;
  unpinMessage?: (address: ChatAddress, messageId?: number) => Promise<void>;
  persistToMemory?: (entries: Array<{ role: "user" | "assistant"; text: string }>) => Promise<void>;
}

export interface JobResult {
  success: boolean;
  data?: unknown;
  error?: string;
  deliveredToUser?: boolean;
}
