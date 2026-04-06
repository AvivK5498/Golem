/**
 * Sub-Agent Loader
 *
 * Reads agents.yaml and creates Mastra Agent instances.
 * Each sub-agent gets only the tools listed in its config.
 * Skills are isolated per sub-agent via a dedicated Workspace instance
 * that only discovers the skills listed in that agent's config.
 * The parent agent registers them via `agents: {}` — they become callable tools automatically.
 */
import { Agent } from "@mastra/core/agent";
import type { MastraDBMessage } from "@mastra/core/agent";
import type { Processor } from "@mastra/core/processors";
import { Workspace, LocalFilesystem } from "@mastra/core/workspace";
import { getMastraModelId, getModelForId } from "../agent/model.js";
import { allTools } from "../agent/tools/index.js";
import { getMCPTools } from "../agent/mcp-client.js";
import { loadSkills } from "../skills/loader.js";
import { getSkillsDir } from "../utils/paths.js";
import { ToolRateLimitGuard } from "../agent/processors/tool-rate-limit-guard.js";
import { FinalStepGuard } from "../agent/processors/final-step-guard.js";
import { ToolErrorGate } from "../agent/processors/tool-error-gate.js";
import { OwnerStepBudgetProcessor } from "../agent/processors/owner-step-budget.js";
import { logger } from "../utils/external-logger.js";
import { isTransientApiError } from "../utils/api-errors.js";
import { TOOL_ERROR_COUNT_KEY } from "../agent/tools/error-tagging.js";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

// Sub-agent retry + fallback configuration
const SUBAGENT_FALLBACK_MODEL = process.env.SUBAGENT_FALLBACK_MODEL || "openai/gpt-4.1-mini";
const SUBAGENT_MAX_RETRIES = parseInt(process.env.SUBAGENT_MAX_RETRIES || "2");
const SUBAGENT_BASE_RETRY_MS = parseInt(process.env.SUBAGENT_BASE_RETRY_MS || "5000");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentConfig {
  description: string;
  instructions?: string;
  model?: string;
  temperature?: number;
  reasoningEffort?: "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
  tools: string[];
  skills?: string[];
  maxSteps?: number;
}

interface AgentsYaml {
  agents: Record<string, AgentConfig>;
  defaults?: {
    instructions?: string;
  };
}

// ---------------------------------------------------------------------------
// Reflection rule — appended to every sub-agent's instructions
// ---------------------------------------------------------------------------

const GLOBAL_SUFFIX = `

Return results only. On error: stop, report what failed and why.
If you cannot find what you need after a few attempts, stop and say so. Do not explore endlessly. A clear "I couldn't find this" is better than a hallucinated answer.
If the delegating agent provides a handoff file path, use handoff_append to write your full results to that file. Then respond with a short confirmation only — the file is the deliverable, not your response text.`;

// ---------------------------------------------------------------------------
// Context isolation processor — strips inherited parent conversation history
// ---------------------------------------------------------------------------

/**
 * Mastra injects the parent agent's full conversation into sub-agents via
 * memory inheritance and shared RequestContext. This processor runs inside
 * each sub-agent's generate flow (after all message injection) and strips
 * everything except system messages and the most recent user message (the
 * delegation task prompt).
 *
 * Important: mutates the messageList via removeByIds() instead of returning
 * a new array. Returning a raw MastraDBMessage[] causes Mastra to lose the
 * messageList's threadId/resourceId metadata, which breaks the OM processor.
 */
const contextIsolationProcessor: Processor<string> & { id: string; processInput: Processor<string>["processInput"] } = {
  id: "sub-agent-context-isolation",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processInput({ messages, messageList, requestContext }: { messages: MastraDBMessage[]; messageList: any; requestContext?: any }) {
    // Mark this requestContext as a sub-agent so approval flags don't leak to parent
    if (requestContext?.set) {
      requestContext.set("__subAgentContext" as never, true as never);
      // Snapshot parent's error counter so sub-agent errors don't leak back
      const parentErrorCount = (requestContext.get(TOOL_ERROR_COUNT_KEY) ?? 0) as number;
      requestContext.set("__parentErrorCount" as never, parentErrorCount as never);
      // Reset error counter for the sub-agent's own tracking
      requestContext.set(TOOL_ERROR_COUNT_KEY, 0 as never);
      console.log("[sub-agent-isolation] marked requestContext as sub-agent");
    } else {
      console.warn("[sub-agent-isolation] requestContext not available in processInput!");
    }
    // Find IDs of messages to REMOVE (everything except system + last user)
    const lastUserMessage = [...messages]
      .reverse()
      .find((m: MastraDBMessage) => m.role === "user");
    const lastUserId = lastUserMessage?.id;

    const idsToRemove = messages
      .filter((m: MastraDBMessage) => {
        if (m.role === "system") return false; // keep system
        if (m.id === lastUserId) return false; // keep last user
        return true; // remove everything else
      })
      .map((m: MastraDBMessage) => m.id)
      .filter(Boolean) as string[];

    if (idsToRemove.length > 0) {
      messageList.removeByIds(idsToRemove);
    }

    // Return the messageList to preserve threadId/resourceId metadata
    return messageList;
  },
};

// ---------------------------------------------------------------------------
// Tool resolver
// ---------------------------------------------------------------------------

/**
 * Resolve tool names from the YAML config to actual tool objects.
 * Supports exact names and wildcard patterns (e.g., "mastra_workspace_*").
 */
function resolveTools(
  toolNames: string[],
  availableTools: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const name of toolNames) {
    if (name.endsWith("*")) {
      // Wildcard — match all tools starting with the prefix
      const prefix = name.slice(0, -1);
      for (const [id, tool] of Object.entries(availableTools)) {
        if (id.startsWith(prefix)) {
          resolved[id] = tool;
        }
      }
    } else if (availableTools[name]) {
      resolved[name] = availableTools[name];
    } else {
      console.warn(`[agent-loader] tool "${name}" not found, skipping`);
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Skill workspace builder
// ---------------------------------------------------------------------------

/**
 * Resolve skill names to directory paths using the skill loader.
 * Returns absolute paths to individual skill directories.
 */
export function resolveSkillPaths(skillNames: string[]): string[] {
  if (skillNames.length === 0) return [];

  const skillsDir = getSkillsDir();
  const defaultSkillsDir = path.resolve("skills");
  const skillDirs = skillsDir !== defaultSkillsDir ? [skillsDir, defaultSkillsDir] : [skillsDir];
  const allSkillEntries = loadSkills(skillDirs);
  const resolved: string[] = [];

  for (const name of skillNames) {
    const skill = allSkillEntries.find((s) => s.name === name);
    if (!skill) {
      console.warn(`[agent-loader] skill "${name}" not found, skipping`);
      continue;
    }
    if (!skill.eligible) {
      console.warn(`[agent-loader] skill "${name}" not eligible (missing requirements), skipping`);
      continue;
    }
    resolved.push(skill.dir);
  }

  return resolved;
}


// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the sub-agents YAML config path.
 * When agentId is provided, look for a per-agent file first.
 * Falls back to root agents.yaml with a warning (legacy path).
 */
export function getSubAgentsYamlPath(agentId?: string): string {
  if (agentId) {
    const perAgentPath = path.resolve(`agents/${agentId}/sub-agents.yaml`);
    if (fs.existsSync(perAgentPath)) return perAgentPath;
    console.warn(`[loader] no sub-agents.yaml for agent "${agentId}" — expected at ${perAgentPath}`);
  }
  const rootPath = path.resolve("agents.yaml");
  if (!fs.existsSync(rootPath)) {
    console.warn(`[loader] no root agents.yaml found either — no sub-agents will be loaded`);
  }
  return rootPath;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load sub-agent definitions from agents.yaml and create Agent instances.
 *
 * @param agentId - Optional platform agent ID; when set, loads per-agent sub-agents first
 * @param dynamicTools - Additional tools registered at runtime (MCP, run_workflow)
 * @returns Map of agent ID → Agent instance
 */
export function loadSubAgents(
  agentId: string | undefined,
  dynamicTools: Record<string, unknown> = {},
  preloadedConfig?: Record<string, unknown> | null,
): Record<string, Agent> {
  let config: AgentsYaml;

  if (preloadedConfig) {
    // Use config from SQLite AgentStore
    config = preloadedConfig as unknown as AgentsYaml;
  } else {
    // Fallback: read from filesystem
    const configPath = getSubAgentsYamlPath(agentId);
    if (!fs.existsSync(configPath)) {
      console.log("[agent-loader] no sub-agents config found, skipping");
      return {};
    }
    const raw = fs.readFileSync(configPath, "utf-8");
    config = yaml.parse(raw) as AgentsYaml;
  }

  if (!config.agents || typeof config.agents !== "object") {
    console.warn("[agent-loader] agents.yaml has no agents defined");
    return {};
  }

  // Build the full tool registry: custom tools + MCP tools + dynamic tools
  const toolRegistry: Record<string, unknown> = {
    ...allTools,
    ...getMCPTools(),
    ...dynamicTools,
  };

  const defaultInstructions = config.defaults?.instructions || "Complete the task and return results only.";
  const agents: Record<string, Agent> = {};
  const defaultModel = getMastraModelId();

  // Collect MCP tool names grouped by server for the apis agent
  const mcpTools = getMCPTools();

  // Extract human-readable capability labels from MCP tool names
  // e.g., "letsfg_search_flights" → "flights", "weather_weather_forecast" → "weather"
  const mcpCapabilities = new Set<string>();
  const NOISE_WORDS = new Set(["search", "get", "list", "resolve", "query", "fetch", "find", "lookup"]);
  for (const toolName of Object.keys(mcpTools)) {
    const parts = toolName.split("_").slice(1); // strip server prefix
    for (const part of parts) {
      if (part.length > 2 && !NOISE_WORDS.has(part)) {
        mcpCapabilities.add(part);
        break; // first meaningful word is enough
      }
    }
  }

  for (const [id, agentConfig] of Object.entries(config.agents)) {
    // Special marker: _mcp_apis injects all MCP tools dynamically
    const isMcpApisAgent = agentConfig.tools?.includes("_mcp_apis");
    let tools: Record<string, unknown>;
    let description = agentConfig.description;

    if (isMcpApisAgent) {
      // Inject all MCP tools + any other explicitly listed tools
      const explicitToolIds = (agentConfig.tools || []).filter(t => t !== "_mcp_apis");
      tools = {
        ...resolveTools(explicitToolIds, toolRegistry),
        ...mcpTools,
      };
      // Dynamic description: inject human-readable capabilities
      if (mcpCapabilities.size > 0) {
        description = `Query external APIs — ${[...mcpCapabilities].join(", ")}. ${agentConfig.description}`;
      }
    } else {
      tools = resolveTools(agentConfig.tools || [], toolRegistry);
    }

    // Always inject handoff_append — sub-agents need it when the main agent creates a handoff file
    if (toolRegistry["handoff_append"] && !tools["handoff_append"]) {
      tools["handoff_append"] = toolRegistry["handoff_append"];
    }

    const toolCount = Object.keys(tools).length;

    if (toolCount === 0) {
      if (isMcpApisAgent) {
        console.log(`[agent-loader] agent "${id}" has no MCP tools yet, skipping`);
      } else {
        console.warn(`[agent-loader] agent "${id}" has no resolved tools, skipping`);
        try { logger.warn(`Sub-agent load skipped (no tools): ${id}`, { subAgent: id }); } catch { /* ignore */ }
      }
      continue;
    }

    const instructions = (agentConfig.instructions || defaultInstructions) + GLOBAL_SUFFIX;
    // Server-side model fallback: OpenRouter tries the fallback model instantly
    // when the primary is unavailable — no client round-trip penalty.
    // Per-sub-agent reasoningEffort overrides the supervisor/env default.
    const agentModel = agentConfig.model
      ? getModelForId(agentConfig.model, {
          fallbackModels: [SUBAGENT_FALLBACK_MODEL],
          reasoningEffort: agentConfig.reasoningEffort,
        })
      : defaultModel;

    // Resolve skills to individual directory paths for workspace isolation
    const skillPaths = resolveSkillPaths(agentConfig.skills || []);

    const agentOptions: Record<string, unknown> = {
      id: `sub-${id}`,
      name: id,
      description,
      model: agentModel,
      instructions,
      tools: tools as Record<string, never>,
      inputProcessors: [contextIsolationProcessor, new ToolRateLimitGuard(), new FinalStepGuard(), new OwnerStepBudgetProcessor({ alwaysActive: true }), new ToolErrorGate()],
      outputProcessors: [],
      defaultOptions: {
        maxSteps: agentConfig.maxSteps ?? 8,
        ...(agentConfig.temperature != null && {
          modelSettings: { temperature: agentConfig.temperature },
        }),
      },
    };

    // Workspace access: same granularity as platform agents.
    // workspace_read/workspace_write in tools[] control filesystem access.
    // Skills auto-grant read-only workspace.
    const configuredTools = agentConfig.tools || [];
    const hasWorkspaceRead = configuredTools.includes("workspace_read");
    const hasWorkspaceWrite = configuredTools.includes("workspace_write");
    const hasSkills = skillPaths.length > 0;
    const needsWorkspace = hasWorkspaceRead || hasWorkspaceWrite || hasSkills;

    if (needsWorkspace) {
      const readOnly = !hasWorkspaceWrite;
      agentOptions.workspace = new Workspace({
        id: `sub-${id}-workspace`,
        name: `${id} workspace`,
        filesystem: new LocalFilesystem({ basePath: process.cwd(), contained: true, readOnly }),
        skills: hasSkills ? skillPaths : undefined,
        bm25: hasSkills,
      });
      if (hasSkills) agentOptions.skillsFormat = "markdown";
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agents[id] = new Agent(agentOptions as any);

    // Prevent parent memory inheritance — sub-agents are ephemeral.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agents[id] as any).__setMemory = () => {};

    // Wrap generate() with logging + retry + fallback for transient API errors.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalGenerate = (agents[id] as any).generate.bind(agents[id]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (agents[id] as any).generate = async (messages: any, options: any) => {
      const startMs = Date.now();
      const rc = options?.requestContext;
      // Extract prompt from the last user message for logging context
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastUserMsg = Array.isArray(messages) ? [...messages].reverse().find((m: any) => m.role === "user") : null;
      const promptText = typeof lastUserMsg?.content === "string"
        ? lastUserMsg.content
        : Array.isArray(lastUserMsg?.content)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (lastUserMsg.content.find((p: any) => p.type === "text")?.text || "")
          : "";
      logger.info(`Sub-agent ${id} started: ${promptText}`, { subAgent: id, model: agentConfig.model || "default" });

      for (let attempt = 0; attempt <= SUBAGENT_MAX_RETRIES; attempt++) {
        try {
          // Model failover is handled server-side by OpenRouter's `models` array.
          // Client retries only cover full request failures (network, 429, etc.).
          const result = await originalGenerate(messages, options);
          // Restore parent's error counter so sub-agent errors don't poison the parent
          if (rc?.set && rc?.get) {
            const parentCount = (rc.get("__parentErrorCount" as never) ?? 0) as number;
            rc.set(TOOL_ERROR_COUNT_KEY, parentCount as never);
          }
          const latencyMs = Date.now() - startMs;
          const resultText = typeof result?.text === "string" ? result.text : "";
          const stepCount = Array.isArray(result?.steps) ? result.steps.length : 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolCount = Array.isArray(result?.steps) ? result.steps.reduce((n: number, s: any) => n + (Array.isArray(s.toolCalls) ? s.toolCalls.length : 0), 0) : 0;
          const finishReason = result?.finishReason || "unknown";
          const logLevel = resultText ? "info" : "warn";
          logger[logLevel](`Sub-agent ${id} ${finishReason}: ${resultText || "(empty)"}`, {
            subAgent: id, latencyMs: String(latencyMs), retries: String(attempt),
            finishReason, steps: String(stepCount), tools: String(toolCount),
            resultEmpty: String(!resultText),
          });
          return result;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (isTransientApiError(err) && attempt < SUBAGENT_MAX_RETRIES) {
            const delayMs = SUBAGENT_BASE_RETRY_MS * Math.pow(2, attempt);
            logger.warn(`Sub-agent ${id} transient error: ${errMsg} → retry ${attempt + 1}/${SUBAGENT_MAX_RETRIES}`, {
              subAgent: id, error: errMsg, attempt: String(attempt + 1),
            });
            await new Promise(r => setTimeout(r, delayMs));
            continue;
          }
          // Restore parent's error counter even on failure
          if (rc?.set && rc?.get) {
            const parentCount = (rc.get("__parentErrorCount" as never) ?? 0) as number;
            rc.set(TOOL_ERROR_COUNT_KEY, parentCount as never);
          }
          logger.error(`Sub-agent ${id} failed: ${errMsg}`, { subAgent: id, model: agentConfig.model || "default" });
          throw err;
        }
      }
    };

    const extras: string[] = [];
    if (agentConfig.model) extras.push(`model=${agentConfig.model}`);
    if (skillPaths.length > 0) extras.push(`skills=${agentConfig.skills!.join(",")}`);
    const extraStr = extras.length > 0 ? `, ${extras.join(", ")}` : "";

    console.log(
      `[agent-loader] loaded sub-agent: ${id} (${toolCount} tools, maxSteps=${agentConfig.maxSteps ?? 8}${extraStr})`,
    );
    try { logger.info(`Sub-agent loaded: ${id}`, { subAgent: id, tools: String(toolCount), maxSteps: String(agentConfig.maxSteps ?? 8) }); } catch { /* ignore */ }
  }

  console.log(
    `[agent-loader] ${Object.keys(agents).length} sub-agents loaded${agentId ? ` for "${agentId}"` : ""}`,
  );

  return agents;
}

