import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { unwrapService } from "../../platform/agent-runner.js";
import { LOCAL_TZ, type CronStore } from "../../scheduler/cron-store.js";

// Module-level fallback for sub-agents that don't have cronStore in requestContext
let globalCronStore: CronStore | null = null;
export function registerGlobalCronStore(store: CronStore): void {
  globalCronStore = store;
}

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
    "Manage scheduled jobs (action=list/add/remove/pause/resume/run). When creating (action='add'), the MANDATORY `type` field selects behavior:\n" +
    "- type='reminder': your `message` is sent VERBATIM to the user at the scheduled time. No agent loop. Write the text in your own voice (\"Hey, time to call your mom 📞\"). Best for true reminders.\n" +
    "- type='agent_task': your `message` becomes the prompt for a fresh agent turn at the scheduled time. Full agent loop runs with all your tools. Best for scheduled work (\"Check open PRs and summarize\").\n" +
    `Times are interpreted in the host's local timezone (${LOCAL_TZ}); write them as the user says them. ` +
    "Call action='list' to see the current crons when needed.",
  inputSchema: z.object({
    action: z.enum(["list", "add", "remove", "pause", "resume", "run"]).describe(
      "Operation to perform: " +
      "'list' returns all crons, " +
      "'add' creates a new cron (requires type + schedule + message), " +
      "'remove' deletes by id, " +
      "'pause'/'resume' toggles a cron by id, " +
      "'run' fires a cron immediately by id without changing its schedule."
    ),
    type: z.enum(["reminder", "agent_task"]).optional().describe(
      "MANDATORY for action='add'. 'reminder' = your `message` will be sent VERBATIM to the user at the scheduled time (no agent loop runs). Write the message as if speaking to the user now. " +
      "'agent_task' = your `message` becomes the prompt for a fresh agent turn at the scheduled time (the full agent loop runs with all tools available). Use this for scheduled work, not reminders."
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
    message: z.string().optional().describe("Text sent verbatim (reminder) or agent prompt (agent_task) at scheduled time. Required for 'add'."),
    id: z.number().optional().describe("Cron ID for remove/pause/resume/run actions. Required for those actions, ignored for list/add."),
    once: z.boolean().optional().describe("If true, delete the job after it fires once. Defaults to false. Delay-kind jobs are always one-shot regardless."),
  }).superRefine((val, ctx) => {
    if (val.action === "add" && !val.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "type is required for action='add'. Use 'reminder' or 'agent_task'.",
        path: ["type"],
      });
    }
  }),
  inputExamples: [
    // reminder + delay: one-shot in N minutes ("remind me in 2m to drink water")
    { input: { action: "add", type: "reminder", name: "drink water", schedule: { kind: "delay", value: "2m" }, message: "Drink water 💧" } },
    // reminder + cron: recurring at a fixed time ("remind me every morning at 9 to take meds")
    { input: { action: "add", type: "reminder", name: "morning meds", schedule: { kind: "cron", value: "0 9 * * *" }, message: "Time for your morning meds 💊" } },
    // agent_task + delay: one-shot scheduled work
    { input: { action: "add", type: "agent_task", name: "follow-up check", schedule: { kind: "delay", value: "1h" }, message: "Check whether the deploy succeeded and summarize." } },
    // agent_task + cron: recurring scheduled work (classic cron use)
    { input: { action: "add", type: "agent_task", name: "daily PR status", schedule: { kind: "cron", value: "0 16 * * 1-5" }, message: "Check open PRs on project repo and summarize status." } },
    { input: { action: "list" } },
    { input: { action: "remove", id: 5 } },
  ],
  execute: async (input, context) => {

    const cronStore = unwrapService<CronStore>(context?.requestContext?.get("cronStore" as never)) || globalCronStore;
    if (!cronStore) return "Cron scheduling is not available.";
    const callerJid = context?.requestContext?.get("jid" as never) as unknown as string | undefined;
    const transport = unwrapService<{ platform?: string }>(context?.requestContext?.get("transport" as never));
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
        const taskKind = (input.type ?? "agent_task") === "reminder" ? "reminder" : "agent_turn";

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
            taskKind,
            targetJid,
            platform,
            once: true,
          });
          // Override next_run_at to the exact delay time
          cronStore.markRun(cron.id, fireAt);
          const label = taskKind === "reminder" ? "Reminder" : "Task";
          return `${label} #${cron.id} set${input.name ? ` ("${input.name}")` : ""}: fires at ${new Date(fireAt).toLocaleString("en-IL", { timeZone: "Asia/Jerusalem" })} (in ${input.schedule.value})`;
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
          CronExpressionParser.parse(cronExpr, { tz: LOCAL_TZ });
        } catch (err) {
          return `Invalid cron expression: ${cronExpr} (${err instanceof Error ? err.message : String(err)})`;
        }

        const cron = cronStore.addCron(agentId, {
          name: input.name || input.message.slice(0, 50),
          description: input.message,
          cronExpr,
          taskKind,
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
