import { createRequire } from "node:module";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import fs from "node:fs";
import { dataPath } from "../../utils/paths.js";
import type { CronStore } from "../../scheduler/cron-store.js";

// Module-level fallback for sub-agents that don't have cronStore in requestContext
let globalCronStore: CronStore | null = null;
export function registerGlobalCronStore(store: CronStore): void {
  globalCronStore = store;
}

// ---------------------------------------------------------------------------
// Cron summary — read existing crons at load time for tool description
// ---------------------------------------------------------------------------
const CRON_SUMMARY: string = (() => {
  try {
    const dbPath = dataPath("crons.db");
    if (!fs.existsSync(dbPath)) return "No crons configured.";
    const req = createRequire(import.meta.url);
    const Database = typeof Bun !== "undefined" ? req("bun:sqlite").Database : req("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT id, name, cron_expr, paused FROM crons ORDER BY id").all() as Array<{ id: number; name: string; cron_expr: string; paused: number }>;
    db.close();
    if (rows.length === 0) return "No crons configured.";
    return rows.map(r => `#${r.id} "${r.name}" (${r.cron_expr})${r.paused ? " [PAUSED]" : ""}`).join("; ");
  } catch { return "Unable to read crons."; }
})();

/** Convert human-friendly intervals to cron expressions. */
function intervalToCron(interval: string): string | null {
  const match = interval.match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case "m": return num > 0 && num <= 59 ? `*/${num} * * * *` : null;
    case "h": return num > 0 && num <= 23 ? `0 */${num} * * *` : null;
    case "d": return num > 0 ? `0 0 */${num} * *` : null;
    default: return null;
  }
}

export const cronTool = createTool({
  id: "cron",
  description:
    "Manage scheduled jobs: add, remove, pause, resume, run, list. " +
    "Schedule kinds: 'delay' = fire once after a duration (2m/30m/1h/3h — best for 'remind me in X'), " +
    "'every' = recurring interval (15m/30m/1h/2h/6h/1d), " +
    "'cron' = cron expression (0 9 * * 1-5). " +
    "All jobs trigger a full agent turn with the message as prompt. " +
    "For 'in X minutes/hours' requests, always use schedule.kind='delay'. " +
    "Cron expressions are in local time (Asia/Jerusalem) — write times as the user says them, no UTC conversion needed. " +
    "Set once=true for one-shot cron jobs that auto-delete after firing. Delay jobs are always one-shot. " +
    `Current crons: ${CRON_SUMMARY}`,
  inputSchema: z.object({
    action: z.enum(["list", "add", "remove", "pause", "resume", "run"]).describe(
      "Operation to perform: " +
      "'list' returns all crons, " +
      "'add' creates a new cron (requires schedule + message), " +
      "'remove' deletes by id, " +
      "'pause'/'resume' toggles a cron by id, " +
      "'run' fires a cron immediately by id without changing its schedule."
    ),
    name: z.string().optional().describe("Human-readable job name. Required for 'add'."),
    schedule: z.object({
      kind: z.enum(["every", "cron", "delay"]).describe(
        "Schedule type: " +
        "'delay' = fire ONCE after a duration (use for 'remind me in X' requests), " +
        "'every' = recurring at a fixed interval, " +
        "'cron' = recurring on a cron expression. " +
        "For one-time reminders always pick 'delay'."
      ),
      value: z.string().describe("Interval (15m/30m/1h/2h/6h/1d), cron expression (0 9 * * 1-5), or delay (2m/30m/1h/3h)"),
    }).optional().describe("Schedule definition. Required for 'add', ignored for other actions."),
    message: z.string().optional().describe("Agent prompt to execute on each run. Required for 'add'."),
    id: z.number().optional().describe("Cron ID for remove/pause/resume/run actions. Required for those actions, ignored for list/add."),
    once: z.boolean().optional().describe("If true, delete the job after it fires once (for reminders). Defaults to false. Delay-kind jobs are always one-shot regardless."),
  }),
  inputExamples: [
    { input: { action: "add", name: "check PR status", schedule: { kind: "every", value: "2h" }, message: "Check open PRs on project repo and summarize status" } },
    { input: { action: "add", name: "daily standup", schedule: { kind: "cron", value: "0 16 * * 1-5" }, message: "Send the daily standup summary" } },
    { input: { action: "add", name: "remind dishes", schedule: { kind: "delay", value: "2m" }, message: "Reminder: Clean the dishes" } },
    { input: { action: "list" } },
    { input: { action: "remove", id: 5 } },
  ],
  execute: async (input, context) => {

    const cronStore = (context?.requestContext?.get("cronStore" as never) as unknown as CronStore | undefined) || globalCronStore;
    if (!cronStore) return "Cron scheduling is not available.";
    const callerJid = context?.requestContext?.get("jid" as never) as unknown as string | undefined;
    const transport = context?.requestContext?.get("transport" as never) as unknown as { platform?: string } | undefined;
    const agentId = context?.requestContext?.get("agentId" as never) as unknown as string;
    if (!agentId) return "Error: agent identity not available in request context. Cannot manage crons.";

    switch (input.action) {
      case "list": {
        const crons = cronStore.listCrons(agentId);
        if (crons.length === 0) return "No cron jobs.";
        return crons.map((c) => {
          const paused = c.paused ? " [PAUSED]" : "";
          const nextRun = c.next_run_at ? ` (next: ${new Date(c.next_run_at).toISOString()})` : "";
          return `#${c.id} "${c.name}": ${c.cron_expr}${nextRun}${paused}`;
        }).join("\n");
      }

      case "add": {
        if (!input.schedule || !input.message) return "schedule and message are required for add action.";

        const targetJid = callerJid || "";
        const platform = transport?.platform || "telegram";

        // Handle delay-based scheduling (e.g., "2m", "1h") — one-shot by default
        if (input.schedule.kind === "delay") {
          const delayMatch = input.schedule.value.match(/^(\d+)(m|h|d)$/);
          if (!delayMatch) return `Invalid delay: ${input.schedule.value}. Use: 2m, 30m, 1h, 3h, 1d.`;
          const num = parseInt(delayMatch[1], 10);
          const unit = delayMatch[2];
          const ms = unit === "m" ? num * 60_000 : unit === "h" ? num * 3_600_000 : num * 86_400_000;
          const fireAt = Date.now() + ms;
          // Use a dummy cron expr that won't match again — the once flag handles cleanup
          const dummyCron = "0 0 31 2 *"; // Feb 31 = never
          const cron = cronStore.addCron(agentId, {
            name: input.name || input.message.slice(0, 50),
            description: input.message,
            cronExpr: dummyCron,
            taskKind: "agent_turn",
            targetJid,
            platform,
            once: true,
          });
          // Override next_run_at to the exact delay time
          cronStore.markRun(cron.id, fireAt);
          return `Reminder #${cron.id} set${input.name ? ` ("${input.name}")` : ""}: fires at ${new Date(fireAt).toLocaleString("en-IL", { timeZone: "Asia/Jerusalem" })} (in ${input.schedule.value})`;
        }

        let cronExpr: string;
        if (input.schedule.kind === "every") {
          const converted = intervalToCron(input.schedule.value);
          if (!converted) return `Invalid interval: ${input.schedule.value}. Use: 15m, 30m, 1h, 2h, 6h, 12h, 1d.`;
          cronExpr = converted;
        } else {
          cronExpr = input.schedule.value;
        }

        try {
          const { CronExpressionParser } = await import("cron-parser");
          CronExpressionParser.parse(cronExpr, { tz: "Asia/Jerusalem" });
        } catch (err) {
          return `Invalid cron expression: ${cronExpr} (${err instanceof Error ? err.message : String(err)})`;
        }

        const cron = cronStore.addCron(agentId, {
          name: input.name || input.message.slice(0, 50),
          description: input.message,
          cronExpr,
          taskKind: "agent_turn",
          targetJid,
          platform,
          once: input.once,
        });
        const onceLabel = input.once ? " (one-shot, auto-deletes after firing)" : "";
        return `Cron #${cron.id} created${input.name ? ` ("${input.name}")` : ""}: ${cronExpr}${onceLabel} [next: ${cron.next_run_at ? new Date(cron.next_run_at).toISOString() : "unknown"}]`;
      }

      case "remove": {
        if (!input.id) return "id is required for remove action.";
        const removed = cronStore.deleteCron(agentId, input.id);
        return removed ? `Cron #${input.id} removed.` : `Cron #${input.id} not found.`;
      }

      case "pause": {
        if (!input.id) return "id is required for pause action.";
        const paused = cronStore.pauseCron(agentId, input.id);
        return paused ? `Cron #${input.id} paused.` : `Cron #${input.id} not found.`;
      }

      case "resume": {
        if (!input.id) return "id is required for resume action.";
        const resumed = cronStore.resumeCron(agentId, input.id);
        return resumed ? `Cron #${input.id} resumed.` : `Cron #${input.id} not found.`;
      }

      case "run": {
        if (!input.id) return "id is required for run action.";
        const cron = cronStore.getCron(agentId, input.id);
        if (!cron) return `Cron #${input.id} not found.`;
        cronStore.updateCron(agentId, input.id, { next_run_at: Date.now() - 1000 });
        return `Cron #${input.id} ("${cron.name}") queued — the scheduler will execute it within 30 seconds. Nothing else to do.`;
      }

      default:
        return `Unknown action: ${input.action}`;
    }
  },
});
