import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../../utils/paths.js";
import { unwrapService } from "../../platform/agent-runner.js";
import type { JobQueue } from "../../scheduler/job-queue.js";
import type { MessageTransport } from "../../transport/index.js";

// ---------------------------------------------------------------------------
// Job handler discovery
// ---------------------------------------------------------------------------
const HANDLERS_DIR = path.resolve("src/scheduler/handlers");
const JOB_HANDLER_TYPES: string[] = (() => {
  try {
    return fs.readdirSync(HANDLERS_DIR)
      .filter(f => f.endsWith(".ts") || f.endsWith(".js"))
      .map(f => f.replace(/(-runner|-handler)?\.(ts|js)$/, ""));
  } catch { return ["coding", "http-poll"]; }
})();

// ---------------------------------------------------------------------------
// restart tool
// ---------------------------------------------------------------------------

export interface RestartHandoff {
  reason: string;
  message?: string;
  timestamp: number;
  expiry: number;
}

export const restartTool = createTool({
  id: "restart",
  description:
    "Gracefully restart Golem via the launchd restart wrapper. " +
    "Use after config changes, code updates, or dependency installations that require a process restart. " +
    "The process exits cleanly and the restart wrapper brings it back within seconds.",
  inputSchema: z.object({
    reason: z.string().optional().describe("Why the restart is needed (shown in logs)"),
  }),
  execute: async (input) => {
    const reason = input.reason || "restart requested by agent";

    const handoffPath = dataPath("restart-handoff.json");
    const handoffData: RestartHandoff = {
      reason,
      message: "I'm back!",
      timestamp: Date.now(),
      expiry: Date.now() + 300_000,
    };

    try {
      fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
      fs.writeFileSync(handoffPath, JSON.stringify(handoffData, null, 2), "utf-8");
      console.log(`[restart] handoff file created for reason: ${reason}`);
    } catch (err) {
      console.warn(`[restart] failed to create handoff file: ${err instanceof Error ? err.message : String(err)}`);
    }

    const requestRestart = (globalThis as Record<string, unknown>).__golem_request_restart as (() => void) | undefined;
    if (requestRestart) {
      setTimeout(() => requestRestart(), 1000);
      return "I'll be back!";
    }

    return "Restart not available — Golem may not be running with the restart wrapper. Run with: ./bin/run-with-restart.sh";
  },
});

// ---------------------------------------------------------------------------
// store_secret tool
// ---------------------------------------------------------------------------

export const storeSecretTool = createTool({
  id: "store_secret",
  description:
    "Store a secret (API key, token, credential) in the .env file. " +
    "The key must be UPPER_SNAKE_CASE (e.g., RUNPOD_API_KEY, TAVILY_API_KEY). " +
    "The value is immediately available via process.env without a restart. " +
    "If the key already exists, set overwrite: true to replace it.",
  inputSchema: z.object({
    key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, "Key must be UPPER_SNAKE_CASE (e.g. RUNPOD_API_KEY)").describe(
      "Environment variable name in UPPER_SNAKE_CASE. Examples: 'RUNPOD_API_KEY', 'TAVILY_API_KEY', 'OPENROUTER_API_KEY'. " +
      "Must start with a letter and contain only A-Z, 0-9, and underscores."
    ),
    value: z.string().min(1, "Value cannot be empty").describe(
      "The secret value as a plain string (API token, key, credential). Stored verbatim in .env. " +
      "Do not URL-encode or quote the value — write it as it should appear to process.env."
    ),
    overwrite: z.boolean().optional().default(false).describe(
      "Set true to replace an existing key. Defaults to false: if the key already exists, the call returns an error."
    ),
  }),
  inputExamples: [
    { input: { key: "RUNPOD_API_KEY", value: "rp_xxxxxxxxxxxx" } },
    { input: { key: "TAVILY_API_KEY", value: "tvly-xxxxxxxxxxxx", overwrite: true } },
  ],
  execute: async (input) => {
    const envPath = path.resolve(".env");
    if (!fs.existsSync(envPath)) {
      return "Error: .env file not found.";
    }

    const content = fs.readFileSync(envPath, "utf-8");
    const lines = content.split("\n");
    const existingIdx = lines.findIndex((l) => l.startsWith(`${input.key}=`));

    if (existingIdx !== -1 && !input.overwrite) {
      return `Key "${input.key}" already exists in .env. Set overwrite: true to replace it.`;
    }

    process.env[input.key] = input.value;

    const newLine = `${input.key}=${input.value}`;
    if (existingIdx !== -1) {
      lines[existingIdx] = newLine;
    } else {
      if (lines.at(-1) === "") {
        lines.splice(-1, 0, newLine);
      } else {
        lines.push(newLine);
      }
    }

    fs.writeFileSync(envPath, lines.join("\n"), "utf-8");

    const masked = input.value.length > 8
      ? `${input.value.slice(0, 4)}...${input.value.slice(-4)}`
      : "****";
    return `Stored ${input.key}=${masked} in .env and process.env.`;
  },
});

// ---------------------------------------------------------------------------
// schedule_job tool
// ---------------------------------------------------------------------------

export const scheduleJobTool = createTool({
  id: "schedule_job",
  description:
    "Run a long-running task in the background (video generation, image processing, HTTP polling, etc). " +
    "The conversation continues immediately — the user gets a notification when the task completes. " +
    "Use this when a skill instructs you to dispatch a background job. " +
    "The skill will provide the exact type and input parameters to pass through.",
  inputSchema: z.object({
    type: z.enum(JOB_HANDLER_TYPES as [string, ...string[]]).describe(
      `The job handler to use. Available: ${JOB_HANDLER_TYPES.join(", ")}. ` +
      "Use 'http-poll' for API calls that need polling (video/image generation). " +
      "Use 'coding' only if code_agent is unavailable."
    ),
    input: z.record(z.string(), z.unknown()).describe(
      "Job parameters as specified by the skill. Pass through exactly what the skill instructions say — do not modify or guess the structure."
    ),
    timeoutMs: z.number().optional().default(600_000).describe("Timeout in ms (default: 10 min, max: 20 min for video generation)"),
    maxAttempts: z.number().optional().default(2).describe("Retry attempts on failure (default: 2)"),
  }),
  execute: async (input, context) => {
    const jobQueue = unwrapService<JobQueue>(context?.requestContext?.get("jobQueue" as never));
    if (!jobQueue) {
      return "Error: Job system not initialized. Cannot enqueue background jobs.";
    }

    const targetJid = context?.requestContext?.get("jid" as never) as unknown as string | undefined;
    if (!targetJid) {
      return "Error: target_jid is required for background jobs";
    }

    const transport = unwrapService<MessageTransport>(context?.requestContext?.get("transport" as never));
    const platform = transport?.platform || "telegram";
    const agentId = context?.requestContext?.get("agentId" as never) as unknown as string || "unknown";

    try {
      const jobId = jobQueue.enqueue(
        input.type,
        input.input,
        targetJid,
        agentId,
        { timeoutMs: input.timeoutMs!, maxAttempts: input.maxAttempts! },
        platform
      );

      // Signal AsyncJobGuard to stop the agent loop
      const rc = context?.requestContext;
      if (rc) rc.set("_asyncJobDispatched" as never, true as never);

      return `Background job "${input.type}" enqueued successfully (ID: ${jobId}). You'll receive updates as it processes.`;
    } catch (err) {
      return `Failed to enqueue job: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});

