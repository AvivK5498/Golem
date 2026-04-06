// ---------------------------------------------------------------------------
// Task tracking tools — task_write (full-replacement) and task_check
// ---------------------------------------------------------------------------

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { setTaskState, getTaskState, clearTaskState, type TaskItem } from "../task-state.js";

// ---------------------------------------------------------------------------
// task_write — replace the task list for the current thread
// ---------------------------------------------------------------------------

export const taskWriteTool = createTool({
  id: "task_write",
  description:
    "Write or update the task list for the current conversation. " +
    "Use full-replacement semantics: every call replaces the entire list. " +
    "Create a task list before starting any multi-step work (3+ actions). " +
    "Update status as you progress.",
  inputSchema: z.object({
    tasks: z.array(
      z.object({
        content: z.string().describe("Short description of the task step"),
        status: z.enum(["pending", "in_progress", "completed"]).describe("Current status"),
        activeForm: z.string().default("").describe("What is currently being done for this step"),
      }),
    ).describe("Full task list (replaces previous)"),
  }),
  inputExamples: [
    {
      input: {
        tasks: [
          { content: "Search for recent news articles", status: "in_progress", activeForm: "running web_search" },
          { content: "Summarize key findings", status: "pending", activeForm: "" },
          { content: "Send summary to user", status: "pending", activeForm: "" },
        ],
      },
    },
  ],
  execute: async (input, context) => {
    const jid = context?.requestContext?.get("jid" as never) as unknown as string | undefined;
    if (!jid) {
      return "No thread context available — task list not saved.";
    }

    const tasks: TaskItem[] = input.tasks.map((t) => ({
      content: t.content,
      status: t.status,
      activeForm: t.activeForm ?? "",
    }));

    setTaskState(jid, tasks);

    const counts = {
      pending: tasks.filter((t) => t.status === "pending").length,
      in_progress: tasks.filter((t) => t.status === "in_progress").length,
      completed: tasks.filter((t) => t.status === "completed").length,
    };

    return `Task list updated: ${counts.completed}/${tasks.length} completed, ${counts.in_progress} in progress, ${counts.pending} pending.`;
  },
});

// ---------------------------------------------------------------------------
// task_check — check completion status of the current task list
// ---------------------------------------------------------------------------

export const taskCheckTool = createTool({
  id: "task_check",
  description:
    "Check the completion status of the current task list. " +
    "Call before reporting completion to verify all steps are done.",
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const jid = context?.requestContext?.get("jid" as never) as unknown as string | undefined;
    if (!jid) {
      return "No thread context available.";
    }

    const state = getTaskState(jid);
    if (!state || state.tasks.length === 0) {
      return "No active task list.";
    }

    const pending = state.tasks.filter((t) => t.status === "pending");
    const inProgress = state.tasks.filter((t) => t.status === "in_progress");
    const completed = state.tasks.filter((t) => t.status === "completed");
    const allDone = pending.length === 0 && inProgress.length === 0;

    const lines = [
      `Status: ${completed.length}/${state.tasks.length} completed.`,
    ];

    if (inProgress.length > 0) {
      lines.push(`In progress: ${inProgress.map((t) => t.content).join(", ")}`);
    }
    if (pending.length > 0) {
      lines.push(`Pending: ${pending.map((t) => t.content).join(", ")}`);
    }

    if (allDone) {
      lines.push("All tasks completed.");
      clearTaskState(jid);
    } else {
      lines.push("Not all tasks are complete — continue working.");
    }

    return lines.join("\n");
  },
});
