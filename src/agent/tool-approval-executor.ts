import { RequestContext } from "@mastra/core/request-context";
import type { ToolContext } from "./tools.js";
import type { PendingToolApproval } from "./tool-approvals.js";
import { logger } from "../utils/external-logger.js";
import { runCommandTool } from "./tools/run-command-tool.js";
import { cronTool } from "./tools/cron-tool.js";
import { configUpdateTool } from "./tools/config-tool.js";
import { restartTool, storeSecretTool, scheduleJobTool } from "./tools/admin-tools.js";

function normalizeExecutionResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

function buildRequestContext(toolCtx: ToolContext, approval: PendingToolApproval): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set("approvalBypass" as never, true as never);
  requestContext.set("transport" as never, toolCtx.transport as never);
  requestContext.set("jid" as never, approval.jid as never);
  if (toolCtx.cronStore) {
    requestContext.set("cronStore" as never, toolCtx.cronStore as never);
  }
  if (toolCtx.jobQueue) {
    requestContext.set("jobQueue" as never, toolCtx.jobQueue as never);
  }
  if (toolCtx.agentId) {
    requestContext.set("agentId" as never, toolCtx.agentId as never);
  }
  return requestContext;
}

export async function executeApprovedTool(
  approval: PendingToolApproval,
  toolCtx: ToolContext,
): Promise<string> {
  const context = { requestContext: buildRequestContext(toolCtx, approval) };
  try { logger.info(`Tool approved, executing: ${approval.toolName}`, { tool: approval.toolName, approvalId: approval.id, agent: toolCtx.agentId || "unknown" }); } catch { /* ignore */ }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- approval.input is typed as unknown; tools validate internally via Zod
  const input = approval.input as any;
  switch (approval.toolName) {
    case "run_command":
      return normalizeExecutionResult(await runCommandTool.execute!(input, context));
    case "config_update":
      return normalizeExecutionResult(await configUpdateTool.execute!(input, context));
    case "restart":
      return normalizeExecutionResult(await restartTool.execute!(input, context));
    case "store_secret":
      return normalizeExecutionResult(await storeSecretTool.execute!(input, context));
    case "cron":
      return normalizeExecutionResult(await cronTool.execute!(input, context));
    case "schedule_job":
      return normalizeExecutionResult(await scheduleJobTool.execute!(input, context));
    default:
      return `Unsupported approved action: ${approval.toolName}`;
  }
}
