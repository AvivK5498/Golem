import type { CodingResult, ProgressCallback } from "./runtime.js";
import { createBackend } from "./backends.js";

export interface SessionManagerConfig {
  maxConcurrentSessions: number;
  defaultAgent: string;
  model?: string;
}

export class CodingSessionManager {
  private activeSessions = 0;
  private queue: Array<{ resolve: () => void }> = [];
  private config: SessionManagerConfig;

  constructor(config: SessionManagerConfig) {
    this.config = config;
  }

  async execute(task: string, cwd: string, agentName?: string, onProgress?: ProgressCallback, model?: string): Promise<CodingResult> {
    // Wait for a slot if at capacity
    while (this.activeSessions >= this.config.maxConcurrentSessions) {
      await new Promise<void>((resolve) => this.queue.push({ resolve }));
    }

    this.activeSessions++;
    const backend = createBackend(agentName || this.config.defaultAgent);

    try {
      return await backend.execute(task, cwd, onProgress, model || this.config.model);
    } finally {
      this.activeSessions--;
      const next = this.queue.shift();
      if (next) next.resolve();
    }
  }

  async isAgentAvailable(agentName: string): Promise<boolean> {
    const backend = createBackend(agentName);
    return backend.isAvailable();
  }

  get activeCount(): number {
    return this.activeSessions;
  }

  get queuedCount(): number {
    return this.queue.length;
  }
}
