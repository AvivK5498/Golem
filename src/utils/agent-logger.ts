import { appendFileSync, statSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { dataPath } from "./paths.js";

const LOG_FILE = dataPath("agent.log");
const MAX_SIZE = 500 * 1024; // 500KB

/**
 * Central logger for agent activity that can be read back via read_file tool.
 * Logs to data/agent.log with automatic rotation when file exceeds 500KB.
 *
 * Usage:
 *   agentLog("agent", "LLM call started", { provider: "anthropic", model: "claude-4" });
 *   agentLog("guardrail", "Moderation blocked", { reason: "hate speech detected" });
 *   agentLog("heartbeat", "processing HEARTBEAT.md");
 */
export function agentLog(category: string, message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const line = data
    ? `[${timestamp}] [${category}] ${message} ${JSON.stringify(data)}`
    : `[${timestamp}] [${category}] ${message}`;

  console.log(line); // Also log to console for real-time monitoring

  try {
    const dir = "data";
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Rotate if too large
    if (existsSync(LOG_FILE)) {
      const stats = statSync(LOG_FILE);
      if (stats.size > MAX_SIZE) {
        renameSync(LOG_FILE, LOG_FILE + ".old");
      }
    }

    appendFileSync(LOG_FILE, line + "\n");
  } catch (err) {
    console.error(`[agent-logger] Write failed: ${err}`);
  }
}
