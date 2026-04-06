// ---------------------------------------------------------------------------
// Tools barrel — assembles allTools, re-exports everything
// ---------------------------------------------------------------------------

export { toolError, wrapAllTools } from "./error-tagging.js";
export type { ToolErrorResult } from "./error-tagging.js";

// Re-export the ToolRequestContext interface
export { type ToolRequestContext } from "./types.js";

import { wrapAllTools } from "./error-tagging.js";
import { sendMediaTool } from "./skill-tools.js";
import { runCommandTool } from "./run-command-tool.js";
import { cronTool } from "./cron-tool.js";
import { configUpdateTool } from "./config-tool.js";
import { restartTool, storeSecretTool, scheduleJobTool } from "./admin-tools.js";
import { codeAgentTool } from "../../coding/tool.js";
import { taskWriteTool, taskCheckTool } from "./task-tools.js";
import { handoffCreateTool, handoffAppendTool, handoffReadTool } from "./handoff-tools.js";
import { switchModelTool } from "./model-tier-tool.js";

export const allTools = wrapAllTools({
  send_media: sendMediaTool,
  run_command: runCommandTool,
  cron: cronTool,
  code_agent: codeAgentTool,
  config_update: configUpdateTool,
  restart: restartTool,
  schedule_job: scheduleJobTool,
  store_secret: storeSecretTool,
  task_write: taskWriteTool,
  task_check: taskCheckTool,
  handoff_create: handoffCreateTool,
  handoff_read: handoffReadTool,
  handoff_append: handoffAppendTool,
  switch_model: switchModelTool,
});

/**
 * Tools available directly on the primary agent (router).
 * All task-specific tools have been migrated to sub-agents defined in agents.yaml.
 * The primary agent keeps only workspace tools (injected by Mastra) and sub-agent delegation.
 */
export const alwaysAvailableTools = wrapAllTools({
  // No direct tools — the primary agent delegates to sub-agents.
  // Workspace tools (mastra_workspace_*) are injected automatically by Mastra's Workspace.
  // Sub-agents are injected automatically via the agents: {} property.
  task_write: taskWriteTool,
  task_check: taskCheckTool,
  handoff_create: handoffCreateTool,
  handoff_read: handoffReadTool,
  switch_model: switchModelTool,
});