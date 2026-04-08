/**
 * Platform Orchestrator — multi-agent startup module.
 *
 * Primary entry point for the multi-agent platform.
 * Legacy daemon.ts has been removed.
 *
 * Startup sequence:
 *   1. Initialize shared LibSQLStore for memory
 *   2. Initialize MCP client
 *   3. Build tool registry (allTools + MCP tools)
 *   4. Initialize stores (CronStore, FeedStore, JobQueue)
 *   5. Load agent registry from agents/
 *   6. Create TransportManager
 *   7. For each agent: create memory, sub-agents, Agent, register handler
 *   8. Connect all transports
 *   9. Start PlatformScheduler
 *   10. Set up graceful shutdown
 */
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { Observability } from "@mastra/observability";
import { ArizeExporter, type ArizeExporterConfig } from "@mastra/arize";
import { ToolCallFilter, TokenLimiterProcessor } from "@mastra/core/processors";
import type { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { CronExpressionParser } from "cron-parser";

import { dataPath } from "../utils/paths.js";
import { initMCPClient, getMCPTools, disconnectMCP } from "../agent/mcp-client.js";
import { getModelForId } from "../agent/model.js";
import { allTools } from "../agent/tools/index.js";
import { loadSubAgents, resolveSkillPaths } from "../agents/loader.js";
import { Workspace, LocalFilesystem } from "@mastra/core/workspace";
import { createAgentMemory } from "../memory/mastra-memory.js";
import { CronStore } from "../scheduler/cron-store.js";
import { FeedStore } from "../feed/feed-store.js";
import { JobQueue } from "../scheduler/job-queue.js";
import { SettingsStore } from "../scheduler/settings-store.js";
import { AgentSettings } from "./agent-settings.js";
import { AgentRegistry } from "./agent-registry.js";
import { AgentStore } from "./agent-store.js";
import { TransportManager } from "./transport-manager.js";
import type { AgentRegistryConfig } from "./schemas.js";
import type { TelegramTransport } from "../transport/telegram-transport.js";
import type { IncomingMessage } from "../transport/types.js";
import { AgentRunner } from "./agent-runner.js";
import { registerConversationFlowHooks } from "../hooks/conversation-flow.js";
import { hookRegistry } from "../hooks/index.js";
import { parseApprovalButtonText, loadPendingToolApproval, updatePendingToolApprovalStatus } from "../agent/tool-approvals.js";
import { executeApprovedTool } from "../agent/tool-approval-executor.js";
import { transcribeAudio, type WhisperConfig } from "../media/transcribe.js";
import { uploadToTmpFiles } from "../media/upload.js";
import { expandEnvVars } from "../config.js";
import yaml from "yaml";
import { registerGlobalCronStore } from "../agent/tools/cron-tool.js";
import { startServer } from "../server.js";
import { buildPlatformPromptSections, buildPlatformSystemPrompt, buildGroupChatContext } from "./instructions.js";
import { JobExecutor } from "./job-executor.js";
import { SubAgentRegistry } from "./sub-agent-registry.js";
import { GroupIdentityProcessor, stripGroupIdentityTag } from "../agent/processors/group-identity-processor.js";
import { ImageStripperProcessor } from "../agent/processors/image-stripper-processor.js";
import { ReasoningStripperProcessor } from "../agent/processors/reasoning-stripper-processor.js";
import { ToolErrorGate } from "../agent/processors/tool-error-gate.js";
import { AsyncJobGuard } from "../agent/processors/async-job-guard.js";
import { setAllowedBinaries } from "../agent/tools/run-command-tool.js";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { logger } from "../utils/external-logger.js";
import { FilteredMastraLogger, installConsoleFilter } from "../utils/mastra-logger.js";

// Suppress noisy intentional aborts (e.g. AsyncJobGuard tripwire stack traces)
// at the console level — Mastra's input-processor workflow uses a private
// ExecutionEngine that bypasses the configured logger.
installConsoleFilter();

export { buildPlatformPromptSections, buildPlatformSystemPrompt };

// ── Public interfaces ─────────────────────────────────────────

export interface PlatformContext {
  registry: AgentRegistry;
  transports: TransportManager;
  cronStore: CronStore;
  feedStore: FeedStore;
  jobQueue: JobQueue;
  scheduler: PlatformScheduler;
  shutdown: () => Promise<void>;
}

// ── Cron description preprocessor ─────────────────────────────
//
// Replaces !`command` patterns in cron descriptions with their stdout.
// E.g., "Check unread: !`bash bin/check-unread.sh`" runs the command
// and injects the output before passing to the agent.

import { execSync } from "node:child_process";
import { isCommandAllowed } from "../agent/tools/run-command-tool.js";

function preprocessCommands(text: string): string {
  return text.replace(/!`([^`]+)`/g, (_match, cmd: string) => {
    const check = isCommandAllowed(cmd);
    if (!check.allowed) {
      return `[command blocked: binary "${check.blocked}" is not in the allowed list]`;
    }
    try {
      return execSync(cmd, { timeout: 15_000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      return `[command failed: ${msg}]`;
    }
  });
}

// ── PlatformScheduler ─────────────────────────────────────────

class PlatformScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private registry: AgentRegistry,
    private cronStore: CronStore,
    private runners: Map<string, AgentRunner>,
    private transports: TransportManager,
    private feedStore: FeedStore,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), 30_000);
    void this.tick();
    console.log("[scheduler] platform scheduler started, polling every 30s");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const config of this.registry.getAll()) {
        const runner = this.runners.get(config.id);
        const transport = this.transports.get(config.id);
        if (!runner || !transport) continue;

        const dueCrons = this.cronStore.getDueCrons(config.id);
        for (const job of dueCrons) {
          try {
            logger.info(`cron triggered: "${job.name}" (id=${job.id})`, { cronId: String(job.id), cronName: job.name, agent: config.id });
            const ownerAddress = {
              platform: "telegram" as const,
              id: String(config.transport.ownerId),
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- once flag not in CronJob type yet
            const isOneShot = !!(job as any).once;

            // Preprocess !`command` patterns in description before use
            const description = preprocessCommands(job.description);

            if (isOneShot) {
              // One-shot reminders: send text directly, no LLM call
              await transport.sendText(ownerAddress, description);
              this.cronStore.deleteCron(config.id, job.id);
            } else {
              // Recurring jobs: run through the agent
              const result = await runner.processMessage(
                description,
                String(config.transport.ownerId),
                "owner",
                { promptMode: "autonomous" },
              );
              if (result.text?.trim() && !isSuppressedResponse(result.text)) {
                await transport.sendText(ownerAddress, result.text);
              }
            }

            if (!isOneShot) {
              // Advance to next run time
              try {
                const nextRun = CronExpressionParser.parse(job.cron_expr, { tz: "Asia/Jerusalem" })
                  .next()
                  .getTime();
                this.cronStore.markRun(job.id, nextRun);
              } catch {
                this.cronStore.markRun(job.id, Date.now() + 86_400_000);
              }
            }

            this.feedStore.log(config.id, {
              source: "cron",
              sourceName: job.name,
              input: job.description,
              output: "executed",
              status: "delivered",
            });
          } catch (err) {
            console.error(
              `[scheduler] agent "${config.id}" job ${job.id} failed:`,
              err,
            );
            logger.error(`cron execution error: "${job.name}" (id=${job.id}) — ${err instanceof Error ? err.message : String(err)}`, { cronId: String(job.id), cronName: job.name, agent: config.id });
            this.feedStore.log(config.id, {
              source: "cron",
              sourceName: job.name,
              input: job.description,
              output: String(err),
              status: "error",
            });
          }
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}

// ── Agent factory ─────────────────────────────────────────────

/** Filter global tool registry to only include tools this agent is configured for. */
function resolveAgentTools(
  config: AgentRegistryConfig,
  allToolsRegistry: Record<string, unknown>,
  mcpToolFilters: Map<string, Set<string>>,
): Record<string, unknown> {
  const directToolIds = new Set(config.tools || []);
  const mcpServerNames = config.mcpServers || [];

  const filtered: Record<string, unknown> = {};
  for (const [id, tool] of Object.entries(allToolsRegistry)) {
    // Include if it's a directly listed tool
    if (directToolIds.has(id)) {
      filtered[id] = tool;
      continue;
    }
    // Include if it belongs to an allowed MCP server (respecting per-server tool filters)
    for (const serverName of mcpServerNames) {
      const prefix = `${serverName}_`;
      if (!id.startsWith(prefix)) continue;
      const allowedTools = mcpToolFilters.get(serverName);
      if (!allowedTools) {
        // No filter for this server — include all its tools
        filtered[id] = tool;
      } else {
        // Only include if the tool name (after prefix) is in the allowed list
        const toolName = id.slice(prefix.length);
        if (allowedTools.has(toolName)) {
          filtered[id] = tool;
        }
      }
    }
  }

  // If no tools or mcpServers configured, give all tools (backward compat)
  if (directToolIds.size === 0 && mcpServerNames.length === 0) {
    return allToolsRegistry;
  }

  return filtered;
}

/** Build a map of MCP server name → allowed tool names from mcp-servers.yaml */
function buildMcpToolFilters(): Map<string, Set<string>> {
  const filters = new Map<string, Set<string>>();
  try {
    const raw = fs.readFileSync("mcp-servers.yaml", "utf-8");
    const parsed = yaml.parse(raw) as { servers?: Record<string, unknown> } | null;
    const servers = parsed?.servers || {};
    for (const [name, serverConfig] of Object.entries(servers)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolsList = (serverConfig as any)?.tools as string[] | undefined;
      if (toolsList && Array.isArray(toolsList)) {
        filters.set(name, new Set(toolsList));
      }
    }
  } catch { /* no mcp-servers.yaml or invalid — no filters */ }
  return filters;
}

function createPlatformAgent(params: {
  config: AgentRegistryConfig;
  memory: Memory;
  subAgentRegistry: SubAgentRegistry;
  tools: Record<string, unknown>;
  registry: AgentRegistry;
  transports: TransportManager;
  mcpToolFilters: Map<string, Set<string>>;
  agentSettings: AgentSettings;
}): Agent {
  const { config, memory, subAgentRegistry, tools, registry, transports, mcpToolFilters, agentSettings } = params;

  // Tools every platform agent gets regardless of config
  const hasSubAgents = Object.keys(subAgentRegistry.get(config.id)).length > 0;
  const ALWAYS_AVAILABLE_TOOLS = [
    "cron", "send_media", "task_write", "task_check", "switch_model",
    // Handoff tools only when the agent has sub-agents to delegate to
    ...(hasSubAgents ? ["handoff_create", "handoff_read", "handoff_append"] : []),
  ];

  // Read tools/skills/MCP exclusively from settings.db (source of truth)
  const resolvedToolIds = agentSettings.getTools(config.id);
  const resolvedSkillNames = agentSettings.getSkills(config.id);
  const resolvedMcpServers = agentSettings.getMcpServers(config.id);

  // Separate workspace aliases from regular tool IDs
  const WORKSPACE_READ = "workspace_read";
  const WORKSPACE_WRITE = "workspace_write";
  const hasWorkspaceRead = resolvedToolIds.includes(WORKSPACE_READ);
  const hasWorkspaceWrite = resolvedToolIds.includes(WORKSPACE_WRITE);
  const configWithFilteredTools = {
    ...config,
    tools: [
      ...new Set([
        ...ALWAYS_AVAILABLE_TOOLS,
        ...resolvedToolIds.filter(t => t !== WORKSPACE_READ && t !== WORKSPACE_WRITE),
      ]),
    ],
    mcpServers: resolvedMcpServers,
  };

  const agentTools = resolveAgentTools(configWithFilteredTools, tools, mcpToolFilters);
  const toolCount = Object.keys(agentTools).length;

  // Resolve skills to workspace if configured
  const skillPaths = resolveSkillPaths(resolvedSkillNames);
  const hasSkills = skillPaths.length > 0;
  const needsWorkspace = hasSkills || hasWorkspaceRead || hasWorkspaceWrite;
  console.log(`[platform] agent "${config.id}" gets ${toolCount} tools${hasSkills ? `, ${skillPaths.length} skills` : ""}${needsWorkspace ? ` (workspace: ${hasWorkspaceWrite ? "read-write" : "read-only"})` : ""} [model: ${config.llm?.model || "default"}]`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra Agent constructor has complex types
  const agentOptions: Record<string, any> = {
    id: config.id,
    name: config.name,
    description: config.description,
    instructions: ({ requestContext }: { requestContext?: { get: (key: string) => unknown } }) => {
      const now = new Date().toLocaleString("en-IL", {
        timeZone: "Asia/Jerusalem",
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const rChatType = requestContext?.get("chatType") as string | undefined;
      const isGroup = rChatType === "group";
      const behavior = agentSettings.getBehavior(config.id);
      const promptSections = buildPlatformPromptSections({
        agentName: config.name,
        characterName: config.characterName,
        ownerName: config.ownerName,
        role: config.role,
        lastMessages: agentSettings.getLastMessages(config.id) ?? 12,
        isGroup,
        behavior,
      });
      const persona = registry.getPersona(config.id) || "";
      const lines: string[] = [`Current time: ${now} (Asia/Jerusalem)`];

      // Build delegation text (if sub-agents exist)
      const currentSubAgents = subAgentRegistry.get(config.id);
      const subAgentNames = Object.keys(currentSubAgents);
      let delegationBlock = "";
      if (subAgentNames.length > 0) {
        const rows = subAgentNames.map(name => {
          const sa = currentSubAgents[name];
          const desc = (typeof sa.getDescription === "function" ? sa.getDescription() : name) || name;
          return `| ${desc} | ${name} |`;
        });
        delegationBlock = `## Delegation

You have ${subAgentNames.length} sub-agents. Classify the request, then delegate.

| Intent | Agent |
|--------|-------|
${rows.join("\n")}

- Pick the single most specific match
- One sub-agent can handle multiple tool calls internally — don't split across agents
- Prefer fewer, well-scoped delegations — max 3 per request
- For single-domain tasks, one sub-agent call is enough

## Multi-step Delegation
For tasks requiring 2+ sub-agents:
1. \`task_write\` — plan the steps
2. \`handoff_create\` — create shared file with named sections
3. Delegate to sub-agents — each writes via \`handoff_append\`
4. \`handoff_read\` → synthesize → respond

For single sub-agent tasks, skip the handoff file.`;
      }

      for (const section of promptSections) {
        lines.push("", section.label === "Opening" ? section.content : `## ${section.label}\n\n${section.content}`);

        // Insert persona right after Opening
        if (section.label === "Opening" && persona) {
          lines.push("", "## Your Identity & Persona", "", persona);
        }

        // Insert group chat context right after Opening (after persona)
        if (section.label === "Opening") {
          const rJid = requestContext?.get("jid") as string | undefined;
          if (isGroup && rJid) {
            const allConfigs = registry.getAll();
            const otherAgents = allConfigs
              .filter(c => c.id !== config.id && agentSettings.getAllowedGroups(c.id).includes(rJid!))
              .map(c => ({
                name: c.characterName || c.name,
                description: c.description,
                botUsername: transports.get(c.id)?.botUsername || undefined,
              }));
            if (otherAgents.length > 0) {
              lines.push("", buildGroupChatContext(otherAgents));
            }
          }
        }

        // Insert delegation right after Memory
        if (section.label === "Memory" && delegationBlock) {
          lines.push("", delegationBlock);
        }

        // Insert skills guidance after Memory (only if agent has skills)
        if (section.label === "Memory" && hasSkills) {
          lines.push("", `## Skills\n\nYou have ${skillPaths.length} skill(s) assigned. Before fulfilling a user request, check if a matching skill exists using the workspace search tool. If a skill matches, read it and follow its instructions. If no skill matches, proceed as usual.`);
        }
      }

      return lines.join("\n");
    },
    model: ({ requestContext }: { requestContext?: { get: (key: string) => unknown } }) => {
      const globalTiers = agentSettings.getGlobalTiers() || {};
      const id = requestContext?.get("agentId") as string | undefined;
      // Resolve: override (settings) > tier (settings) > fallback
      const override = id ? agentSettings.getModel(id) : null;
      const tierKey = (id && agentSettings.getActiveTier(id)) || "low";
      const modelId = override || globalTiers[tierKey] || "anthropic/claude-haiku-4-5";
      const effort = id ? agentSettings.getReasoningEffort(id) : null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return getModelForId(modelId, { reasoningEffort: effort as any });
    },
    agents: () => params.subAgentRegistry.get(params.config.id),
    memory,
    tools: agentTools,
    inputProcessors: [
      new ImageStripperProcessor(),       // Strip base64 images from recalled history
      new AsyncJobGuard(),              // Stop loop after async job dispatch (e.g., coding agent)
      new ToolCallFilter(),             // Strip tool calls/results from recalled history (saves tokens)
      new TokenLimiterProcessor(170_000), // Prevent context overflow
      new ToolErrorGate(),              // Strip tools after repeated errors to force synthesis
    ],
    outputProcessors: [
      new ImageStripperProcessor(),
      new ReasoningStripperProcessor(),
      new GroupIdentityProcessor(config.characterName || config.name, config.role),
    ],
    defaultOptions: {
      maxSteps: agentSettings.getMaxSteps(config.id) ?? 30,
    },
  };

  if (needsWorkspace) {
    // Read-write only when workspace_write is explicitly enabled.
    // Skills-only agents (no workspace_read/write) get read-only access.
    const readOnly = !hasWorkspaceWrite;
    // If skills are in an external directory (GOLEM_SKILLS_DIR), disable containment
    // so Mastra can access skill files outside the project root.
    //
    // NOTE: Mastra Workspace basePath stays at process.cwd() so skills (which
    // live in the project root, outside the per-agent sandbox) remain
    // accessible. The per-agent sandbox is enforced separately via the
    // `repoPath` requestContext value, which code_agent and run_command read
    // to scope their cwd.
    const hasExternalSkills = hasSkills && skillPaths.some(p => !p.startsWith(process.cwd()));
    agentOptions.workspace = new Workspace({
      id: `${config.id}-workspace`,
      name: `${config.id} workspace`,
      filesystem: new LocalFilesystem({ basePath: process.cwd(), contained: !hasExternalSkills, readOnly }),
      skills: hasSkills ? skillPaths : undefined,
      bm25: hasSkills,
    });
    if (hasSkills) agentOptions.skillsFormat = "markdown";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic agent config construction
  return new Agent(agentOptions as any);
}

// ── Message routing ───────────────────────────────────────────

/** Suppress internal status responses that shouldn't be sent to the user */
function isSuppressedResponse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "(no response)" || trimmed === "(progressive)") return true;
  if (/^[A-Z_]+_OK$/.test(trimmed)) return true;
  return false;
}

const MESSAGE_DEDUP_TTL_MS = 60_000;

// Track which agents are handling which group messages (for dedup + bot-to-bot routing).
// Records BEFORE processing starts, not after — prevents race conditions.
const groupResponses = new Map<string, { agents: Set<string>; ts: number }>();
const GROUP_RESPONSE_TTL_MS = 120_000;

// Periodic cleanup instead of on-insertion O(n) scan
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of groupResponses) {
    if (now - v.ts > GROUP_RESPONSE_TTL_MS) groupResponses.delete(k);
  }
}, 30_000).unref();

function recordGroupResponse(chatId: string, messageId: string, agentId: string): void {
  const key = `${chatId}:${messageId}`;
  const entry = groupResponses.get(key) || { agents: new Set(), ts: Date.now() };
  entry.agents.add(agentId);
  groupResponses.set(key, entry);
}

function hasAgentRespondedToMessage(chatId: string, messageId: string, agentId: string): boolean {
  const key = `${chatId}:${messageId}`;
  return groupResponses.get(key)?.agents.has(agentId) ?? false;
}

/** Extract @mentions from text, ignoring code blocks and URLs */
function extractMentionsFromText(text: string): string[] {
  // Strip code blocks first
  const cleaned = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
  // Match @username preceded by whitespace or start of line
  const mentions: string[] = [];
  const regex = /(?:^|\s)@([a-zA-Z0-9_]{5,})/g;
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    mentions.push(match[1].toLowerCase());
  }
  return mentions;
}

function registerAgentTransport(
  runner: AgentRunner,
  transport: TelegramTransport,
  config: AgentRegistryConfig,
  deps: { cronStore: CronStore; feedStore: FeedStore; jobQueue: JobQueue; registry: AgentRegistry; agentStore: AgentStore; transports: TransportManager; runners: Map<string, AgentRunner>; agentSettings: AgentSettings },
): void {
  registerConversationFlowHooks(transport, runner.agentId);

  // Per-agent message deduplication
  const recentMessageIds = new Map<string, number>();

  transport.onMessage(async (msg: IncomingMessage) => {
    // Ignore the bot's own outgoing messages (pinned progress updates, status edits, etc.)
    if (msg.fromMe) return;

    // ── 1. Message deduplication ──────────────────────────────
    const dedupeKey = msg.id ? `${msg.from.platform}:${msg.from.id}:${msg.id}` : "";
    if (dedupeKey) {
      const now = Date.now();
      for (const [key, seenAt] of recentMessageIds) {
        if (now - seenAt > MESSAGE_DEDUP_TTL_MS) recentMessageIds.delete(key);
      }
      if (recentMessageIds.has(dedupeKey)) {
        console.log(`[${runner.agentId}] duplicate message suppressed`);
        return;
      }
      recentMessageIds.set(dedupeKey, now);
    }

    // ── 2. Chat classification + admin group promotion ───────
    let chatType = runner.classifyMessage(msg);
    const runtimeAdminGroups = deps.agentSettings.getAdminGroups(config.id);
    const runtimeAllowedGroups = deps.agentSettings.getAllowedGroups(config.id);
    if (chatType === "group" && runtimeAdminGroups.includes(msg.from.id)) {
      chatType = "owner";
    }

    // Auto-detect ownerId: if ownerId is 0 (placeholder) and this is a DM, capture it
    const isDM = msg.from.platform === "telegram" && !msg.from.id.startsWith("-");
    if (config.transport.ownerId === 0 && chatType === "unknown" && isDM) {
      const detectedId = parseInt(msg.from.id, 10);
      if (detectedId > 0) {
        console.log(`[${runner.agentId}] auto-detected ownerId: ${detectedId}`);
        config.transport.ownerId = detectedId;
        chatType = "owner";
        // Persist to SQLite
        try {
          const storedConfig = deps.agentStore.getConfig(config.id);
          if (storedConfig) {
            storedConfig.transport.ownerId = detectedId;
            deps.agentStore.updateConfig(config.id, storedConfig);
          }
        } catch (err) {
          console.warn(`[${runner.agentId}] failed to persist ownerId: ${err}`);
        }
      }
    }

    // ── 3. Access gate (per-agent allowedGroups) ──────────────
    if (runtimeAllowedGroups.length > 0) {
      if (chatType !== "owner" && (chatType !== "group" || !runtimeAllowedGroups.includes(msg.from.id))) {
        return;
      }
    } else if (chatType !== "owner") {
      return;
    }

    // ── 4. Group chat classification ──────────────────────────
    if (chatType === "group") {
      const botUser = transport.botUsername;
      const msgText = (msg.text || "").toLowerCase();
      const atMentioned = botUser && (msg.mentions || []).includes(botUser.toLowerCase());
      // Also detect text name mentions by agent name, character name, or ID
      const agentNames = [config.name, config.characterName, config.id].filter(Boolean).map(n => n!.toLowerCase());
      const nameMentioned = agentNames.some(name => msgText.includes(name));
      const isMentioned = atMentioned || nameMentioned;

      // Skip bot messages (unless this bot was mentioned)
      // Fix #8: Only allow messages from authorized agent bots
      if (msg.senderIsBot) {
        const authorizedBotIds = new Set(deps.registry.getAll().map(c => String(deps.transports.get(c.id)?.botId || "")));
        const senderBotId = msg.sender?.id || "";
        if (!authorizedBotIds.has(senderBotId) && !isMentioned) return;
        if (!isMentioned) return;
      }

      // If another bot was @mentioned (not this one), stay silent
      const hasMentions = (msg.mentions || []).length > 0;
      if (hasMentions && !atMentioned) return;

      // If another agent's name is mentioned (not this one), check if this agent's name is also mentioned
      const allConfigs = deps.registry.getAll();
      const otherNames = allConfigs
        .filter(c => c.id !== config.id)
        .flatMap(c => [c.name, c.characterName, c.id].filter(Boolean).map(n => n!.toLowerCase()));
      const otherNameMentioned = otherNames.some(name => msgText.includes(name));
      if (otherNameMentioned && !nameMentioned) return;

      // Owner-only in groups
      const senderId = msg.sender?.id;
      const ownerId = String(config.transport.ownerId);
      const fromOwner = senderId === ownerId;
      // Allow bot-to-bot mentions (agent-to-agent), but only 1 hop
      const fromAgentBot = msg.senderIsBot;
      if (!fromOwner && !fromAgentBot) return;

      // If not @mentioned, classify with LLM
      if (!isMentioned) {
        const { shouldAgentRespond } = await import("./group-classifier.js");
        // Build context: this agent + other agents in this group
        const allConfigs = deps.registry.getAll();
        const groupId = msg.from.id;
        const otherAgents = allConfigs
          .filter(c => c.id !== config.id && c.allowedGroups.includes(groupId))
          .map(c => ({ id: c.id, name: c.characterName || c.name, description: c.description }));
        const thisAgent = { id: config.id, name: config.characterName || config.name, description: config.description };

        const shouldRespond = await shouldAgentRespond(thisAgent, otherAgents, msg.text || "", deps.agentSettings.getGlobalNanoModel());
        if (!shouldRespond) return;
      }
    }

    // ── 5. Tool approval callbacks (owner only) ──────────────
    const approvalAction = msg.text ? parseApprovalButtonText(msg.text) : null;
    if (approvalAction && chatType === "owner") {
      const approval = loadPendingToolApproval(approvalAction.id);
      if (!approval) {
        await transport.sendText(msg.from, "Approval request not found or expired.");
        return;
      }
      if (approvalAction.action === "deny") {
        updatePendingToolApprovalStatus(approval.id, "denied");
        await transport.sendText(msg.from, `Denied.\n\n${approval.summary}`);
        return;
      }
      updatePendingToolApprovalStatus(approval.id, "approved");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ToolContext shape varies
      const result = await executeApprovedTool(approval, { transport, cronStore: deps.cronStore, feedStore: deps.feedStore, jobQueue: deps.jobQueue, agentId: runner.agentId } as any);
      updatePendingToolApprovalStatus(approval.id, "executed");
      await transport.sendText(msg.from, result);
      return;
    }

    // ── 6. Media processing ──────────────────────────────────
    let effectiveText = msg.text || "";
    let imageData: { base64: string; mimeType: string; filePath?: string } | undefined;

    if (msg.media?.type === "audio" && msg.media.filePath) {
      const whisperCfg: WhisperConfig = {
        enabled: deps.agentSettings.getGlobal("global.whisper.enabled") === "true",
        apiKey: expandEnvVars(deps.agentSettings.getGlobal("global.whisper.apiKey") || ""),
        endpoint: deps.agentSettings.getGlobal("global.whisper.endpoint") || "https://api.groq.com/openai/v1/audio/transcriptions",
        model: deps.agentSettings.getGlobal("global.whisper.model") || "whisper-large-v3-turbo",
        timeoutMs: Number(deps.agentSettings.getGlobal("global.whisper.timeoutMs")) || 30000,
      };
      const transcription = await transcribeAudio(msg.media.filePath, whisperCfg);
      if (transcription.ok && transcription.text) {
        console.log(`[${runner.agentId}] transcribed audio: "${transcription.text.slice(0, 80)}..."`);
        effectiveText = `[Voice note transcript]\n${transcription.text}`;
      } else {
        // Bypass the agent loop entirely — send error directly to user and stop
        const errorDetail = transcription.errorMessage || transcription.errorCode || "unknown error";
        console.warn(`[${runner.agentId}] audio transcription failed: ${errorDetail}`);
        await transport.sendText(msg.from, `Voice note could not be transcribed: ${errorDetail}`);
        return;
      }
    } else if (msg.media?.type === "image" && msg.media.filePath) {
      console.log(`[${runner.agentId}] processing image with vision`);
      // Explicit `Buffer` annotation: fs.readFileSync returns Buffer<ArrayBufferLike>
      // and sharp.toBuffer() returns Buffer<NonSharedBuffer>; TS won't reconcile
      // them via control-flow narrowing without an explicit widening.
      let buffer: Buffer = fs.readFileSync(msg.media.filePath);

      // Re-encode oversize images. Mastra's TokenLimiterProcessor counts file
      // parts by JSON.stringify'ing them and tokenizing the base64 blob, which
      // means a 200KB JPEG consumes ~180K tokens — exceeding the 170K budget
      // and causing the user message to be silently dropped from the prompt.
      // Cap at ~80KB (~73K tokens) to leave room for system prompts and
      // recalled history. JPEG compression is content-dependent, so we walk
      // an iterative ladder until the encoded size fits.
      const MAX_IMAGE_BYTES = 80 * 1024;
      if (buffer.length > MAX_IMAGE_BYTES) {
        const original = buffer.length;
        const ladder: Array<{ width: number; quality: number }> = [
          { width: 1280, quality: 75 },
          { width: 1024, quality: 65 },
          { width: 800, quality: 55 },
          { width: 640, quality: 55 },
          { width: 512, quality: 60 },
        ];
        try {
          for (const { width, quality } of ladder) {
            buffer = await sharp(msg.media.filePath)
              .rotate() // honor EXIF orientation before stripping metadata
              .resize({ width, withoutEnlargement: true })
              .jpeg({ quality })
              .toBuffer();
            if (buffer.length <= MAX_IMAGE_BYTES) break;
          }
          console.log(`[${runner.agentId}] image re-encoded ${original} → ${buffer.length} bytes`);
        } catch (err) {
          console.warn(`[${runner.agentId}] sharp re-encode failed (${err instanceof Error ? err.message : String(err)}), sending original`);
          buffer = fs.readFileSync(msg.media.filePath);
        }
      }

      // Pass the (possibly re-encoded) buffer as base64. Do NOT set filePath:
      // agent-runner.ts re-reads filePath if present, which would defeat the
      // re-encode by reloading the original from disk.
      const base64 = buffer.toString("base64");
      imageData = { base64, mimeType: "image/jpeg" };
      // Fix #9: embed media reference for group history persistence
      effectiveText = chatType === "group" ? `[Image attached] ${msg.text || ""}` : (msg.text || "");
    } else if (msg.media?.type === "video" && msg.media.filePath) {
      try {
        const url = await uploadToTmpFiles(msg.media.filePath);
        effectiveText = `[Video uploaded: ${url}]\n${msg.text || ""}`;
      } catch {
        effectiveText = `[Video received but upload failed]\n${msg.text || ""}`;
      }
    }

    // ── 6b. Group message identity tags ────────────────────
    // Prepend sender identity so agents reading group history know who wrote what.
    if (chatType === "group" && effectiveText) {
      const senderName = msg.sender?.displayName || "User";
      effectiveText = `[${senderName}] ${effectiveText}`;
    }

    // Fix #1/#3: Record BEFORE processing to prevent race conditions in bot-to-bot routing
    if (chatType === "group") {
      recordGroupResponse(msg.from.id, msg.id, runner.agentId);
    }

    // ── 7. Agent processing with typing indicators ───────────
    await runner.queueMessage(msg.from.id, async () => {
      await hookRegistry.emit("before_agent", {
        jid: msg.from.id,
        platform: transport.platform,
        promptMode: "full",
        agentId: runner.agentId,
      });

      try {
        const result = await runner.processMessage(
          effectiveText,
          msg.from.id,
          chatType,
          {
            sender: msg.sender?.displayName,
            imageData,
            // Disable progressive messaging in group chats (too noisy)
            ...(chatType !== "group" && {
              onProgressText: async (text: string) => {
                await transport.sendText(msg.from, text);
              },
            }),
          },
        );
        if (result.text?.trim() && !isSuppressedResponse(result.text)) {
          // If progressive messaging already sent part of the response, only send the new portion
          let finalText = result.text;
          if (result.progressivelySentText && result.text.startsWith(result.progressivelySentText)) {
            finalText = result.text.slice(result.progressivelySentText.length).trim();
          }
          // Strip group identity tag before sending to user
          if (chatType === "group") {
            finalText = stripGroupIdentityTag(finalText, config.characterName || config.name, config.role);
          }
          if (finalText && !isSuppressedResponse(finalText)) {
            await transport.sendText(msg.from, finalText);
          }

          // Bot-to-bot routing: if the response @mentions another agent,
          // trigger that agent directly (Telegram doesn't deliver bot-to-bot messages).
          // Fix #1: max 1 hop — routed responses do NOT trigger further routing.
          // Fix #4: use context-aware mention extraction (skips code blocks/URLs).
          if (chatType === "group" && result.text) {
            const mentionedUsernames = extractMentionsFromText(result.text);
            for (const mentionedUsername of mentionedUsernames) {
              for (const [otherId, otherTransport] of [...deps.transports.getAll()]) {
                if (otherId === runner.agentId) continue;
                if (otherTransport.botUsername?.toLowerCase() !== mentionedUsername) continue;

                const otherRunner = deps.runners.get(otherId);
                const otherConfig = deps.registry.get(otherId);
                if (!otherRunner || !otherConfig) break;

                // Skip if target already handled this message
                if (hasAgentRespondedToMessage(msg.from.id, msg.id, otherId)) {
                  logger.info(`Bot-to-bot routing skipped (already responded): ${runner.agentId} → ${otherId}`, { from: runner.agentId, to: otherId });
                  break;
                }

                // Record target BEFORE routing (prevents double-routing)
                recordGroupResponse(msg.from.id, msg.id, otherId);

                logger.info(`Bot-to-bot routing: ${runner.agentId} → ${otherId}`, { from: runner.agentId, to: otherId });
                otherTransport.sendTypingIndicator?.(msg.from).catch(() => {});

                const mentionStr = `@${mentionedUsername}`;
                const mentionIdx = result.text.toLowerCase().indexOf(mentionStr);
                const afterMention = mentionIdx >= 0 ? result.text.slice(mentionIdx + mentionStr.length).trim() : "";
                const fromName = config.characterName || config.name;
                const taggedText = afterMention
                  ? `[This message was sent to you from ${fromName} as part of a group chat, respond naturally.] ${afterMention}`
                  : `[${fromName} mentioned you in a group chat. Respond based on the conversation context.]`;

                // Fire and forget — routed response does NOT trigger further bot-to-bot routing (1-hop limit)
                otherRunner.processMessage(taggedText, msg.from.id, "group", { sender: fromName })
                  .then(async otherResult => {
                    if (otherResult.text?.trim() && !isSuppressedResponse(otherResult.text)) {
                      const otherFinal = stripGroupIdentityTag(otherResult.text, otherConfig.characterName || otherConfig.name, otherConfig.role);
                      if (otherFinal) await otherTransport.sendText(msg.from, otherFinal);
                    }
                  })
                  .catch(err => {
                    logger.error(`Bot-to-bot routing failed: ${err instanceof Error ? err.message : String(err)}`, { from: runner.agentId, to: otherId });
                  });
                break;
              }
            }
          }
        }
      } finally {
        await hookRegistry.emit("agent_end", {
          jid: msg.from.id,
          platform: transport.platform,
          agentId: runner.agentId,
        });
      }
    });
  });
}

// ── Main startup ──────────────────────────────────────────────

export async function startPlatform(): Promise<PlatformContext> {
  console.log("[platform] starting multi-agent platform...");
  logger.info("platform starting");
  const startedAt = Date.now();

  // 1. Shared memory storage
  const sharedStorage = new LibSQLStore({
    id: "platform-memory",
    url: `file:${dataPath("platform-memory.db")}`,
  });

  // 2. Initialize MCP client
  await initMCPClient();

  // 3. Build tool registry
  const tools: Record<string, unknown> = {
    ...allTools,
    ...getMCPTools(),
  };

  // 3b. Build per-MCP-server tool filters from mcp-servers.yaml
  const mcpToolFilters = buildMcpToolFilters();

  // 4. Initialize stores
  const cronStore = new CronStore(dataPath("crons.db"));
  registerGlobalCronStore(cronStore);
  const feedStore = new FeedStore(dataPath("feed.db"));
  const jobQueue = new JobQueue(dataPath("jobs.db"));
  const settingsStore = new SettingsStore(dataPath("settings.db"));
  const agentSettings = new AgentSettings(settingsStore);

  // 5. Load agent registry from SQLite (migrates from filesystem on first run)
  const agentStore = new AgentStore(dataPath("agents.db"));
  const registry = new AgentRegistry(agentStore);
  registry.loadAll();

  const agentConfigs = registry.getAll();
  setAllowedBinaries(agentSettings.getAllowedBinaries());
  if (agentConfigs.length === 0) {
    console.log("[platform] no agents configured yet — create one via the web UI at http://localhost:3015");
  }

  // 6. Create TransportManager
  const transports = new TransportManager();
  transports.createAll(registry);

  // 6b. Initialize coding session manager so run_coding_task tool works
  {
    const { CodingSessionManager } = await import("../coding/session-manager.js");
    const { setCodingSessionManager } = await import("../coding/tool.js");
    setCodingSessionManager(new CodingSessionManager({
      maxConcurrentSessions: 3,
      defaultAgent: "claude",
    }));
    console.log("[platform] coding session manager initialized");
  }

  // 7. For each agent: create memory, sub-agents, agent instance, runner, register handler
  const runners = new Map<string, AgentRunner>();
  const subAgentRegistry = new SubAgentRegistry(loadSubAgents, getMCPTools(), agentStore);

  for (const config of agentConfigs) {
    console.log(`[platform] initializing agent "${config.id}"...`);
    logger.info(`initializing agent "${config.id}"`, { agent: config.id });

    const memoryTemplate = agentStore.getMemoryTemplate(config.id);
    const memory = createAgentMemory(config, sharedStorage, agentSettings, memoryTemplate);
    subAgentRegistry.load(config.id);

    const agent = createPlatformAgent({
      config,
      memory,
      subAgentRegistry,
      tools,
      registry,
      transports,
      mcpToolFilters,
      agentSettings,
    });

    registry.registerInstance(config.id, agent);

    const transport = transports.get(config.id);
    if (transport) {
      const runner = new AgentRunner({
        agent,
        config,
        registry,
        transport,
        feedStore,
        cronStore,
        jobQueue,
        settingsStore,
        agentSettings,
      });
      runners.set(config.id, runner);
      registerAgentTransport(runner, transport, config, { cronStore, feedStore, jobQueue, registry, agentStore, transports, runners, agentSettings });
    } else {
      console.warn(
        `[platform] no transport for agent "${config.id}", skipping message handler`,
      );
      logger.warn(`no transport for agent "${config.id}", skipping message handler`, { agent: config.id });
    }

    console.log(`[platform] agent "${config.id}" initialized`);
    logger.info(`agent "${config.id}" initialized`, { agent: config.id });
  }

  // 8. Initialize Mastra with observability (Phoenix tracing)
  const phoenixEnabled = agentSettings.getGlobal("global.observability.enabled") === "true";
  const phoenixEndpoint = agentSettings.getGlobal("global.observability.endpoint");
  const phoenixProject = agentSettings.getGlobal("global.observability.projectName");
  const phoenixService = "golem-agent";

  let observability: Observability | undefined;
  if (phoenixEnabled) {
    const exporterConfig: ArizeExporterConfig = {};
    if (phoenixEndpoint) exporterConfig.endpoint = phoenixEndpoint;
    if (phoenixProject) exporterConfig.projectName = phoenixProject;
    const exporter = Object.keys(exporterConfig).length > 0 ? new ArizeExporter(exporterConfig) : new ArizeExporter();
    console.log(`[observability] Phoenix enabled (service=${phoenixService}, endpoint=${phoenixEndpoint || "default"})`);
    observability = new Observability({
      configs: {
        phoenix: {
          serviceName: phoenixService,
          exporters: [exporter],
          includeInternalSpans: false,
        },
      },
    });
  }

  // Collect all agent instances for Mastra registration
  const agentInstances: Record<string, Agent> = {};
  for (const config of agentConfigs) {
    const instance = registry.getInstance(config.id) as Agent | undefined;
    if (instance) agentInstances[config.id] = instance;
  }

  new Mastra({
    agents: agentInstances,
    observability,
    logger: new FilteredMastraLogger({ name: "Mastra", level: "info" }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mastra constructor types are complex
  } as any);

  // 9. Connect all transports
  // 9a. Register group discovery handlers — store discovered groups in SQLite
  for (const config of agentConfigs) {
    const t = transports.get(config.id);
    if (t) {
      t.onGroupDiscovery((groupId, groupName) => {
        const key = `discovered_groups`;
        const existing = agentSettings.getStore().getJson<Record<string, string>>(config.id, key) || {};
        existing[groupId] = groupName;
        agentSettings.getStore().setJson(config.id, key, existing);
        logger.info(`Group discovered: ${groupName} (${groupId})`, { agent: config.id, groupId });
      });
    }
  }

  await transports.connectAll();

  // 9b. Start job executor — polls JobQueue and dispatches to handlers
  const jobExecutor = new JobExecutor({
    jobQueue,
    transports,
    runners,
  });
  await jobExecutor.loadHandlersFromDir(path.resolve("src/scheduler/handlers"));
  jobExecutor.start();

  // 10. Start scheduler
  const scheduler = new PlatformScheduler(
    registry,
    cronStore,
    runners,
    transports,
    feedStore,
  );
  scheduler.start();

  // 10b. Proactive check-in system
  const { ProactiveChecker } = await import("./proactive-checker.js");
  const proactiveChecker = new ProactiveChecker({
    runners,
    transports,
    registry,
    agentSettings,
    feedStore,
  });
  proactiveChecker.start();

  // 11. HTTP server with agent-scoped webhook routing
  // Routes: /hooks/{agentId}/{source} with scenario classification
  const configuredDefault = agentSettings.getDefaultAgent();
  const defaultAgentId = configuredDefault && runners.has(configuredDefault)
    ? configuredDefault
    : agentConfigs[0]?.id;
  if (defaultAgentId) {
    logger.info(`default webhook agent: ${defaultAgentId}`);
  }

  const server = startServer({
    startedAt,
    cronStore,
    feedStore,
    jobQueue,
    registry,
    agentStore,
    transports,
    agentSettings,
    proactiveChecker,
    subAgentRegistry,
    onWebhookMessage: async (text: string, source: string, requestId: string) => {
      // Parse agentId from source if prefixed (e.g., "myagent:github")
      // Otherwise route to default agent
      let agentId = defaultAgentId;
      let actualSource = source;

      const colonIdx = source.indexOf(":");
      if (colonIdx > 0) {
        const prefix = source.slice(0, colonIdx);
        if (runners.has(prefix)) {
          agentId = prefix;
          actualSource = source.slice(colonIdx + 1);
        }
      }

      const runner = runners.get(agentId);
      if (!runner) {
        console.error(`[webhook] no runner for agent "${agentId}"`);
        logger.error(`webhook: no runner for agent "${agentId}"`, { agent: agentId });
        return `Webhook failed: agent "${agentId}" not found`;
      }

      const transport = transports.get(agentId);
      const annotatedText =
        `[Webhook from "${actualSource}" (id: ${requestId})]\n` +
        `This is an automated webhook. Your text response will be delivered to the user automatically.\n` +
        `If the webhook specifies an action, perform it using your tools or sub-agents.\n` +
        `Otherwise, just return the webhook content as-is.\n\n` +
        text;

      try {
        // Use owner's chat ID so webhook messages persist in the owner's conversation thread
        const agentConfig = registry.get(agentId);
        const ownerChatId = agentConfig ? String(agentConfig.transport.ownerId) : String(runner.agentId);
        const result = await runner.processMessage(
          annotatedText,
          ownerChatId,
          "owner",
          { promptMode: "full" },
        );

        // Send result to owner via transport
        if (result.text?.trim() && !isSuppressedResponse(result.text) && transport) {
          const config = registry.get(agentId);
          if (config) {
            const ownerAddress = { platform: "telegram" as const, id: String(config.transport.ownerId) };
            await transport.sendText(ownerAddress, `🔔 Webhook (${actualSource})\n\n${result.text}`);
          }
        }
        return result.text || "(no response)";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[webhook] agent "${agentId}" failed:`, msg);
        logger.error(`webhook processing failed: ${msg}`, { agent: agentId });
        return `Webhook processing failed: ${msg}`;
      }
    },
  });

  // 11. Graceful shutdown
  async function doShutdown(): Promise<void> {
    console.log("[platform] shutting down...");
    logger.info("platform shutting down");
    jobExecutor.stop();
    scheduler.stop();
    proactiveChecker.stop();
    server.close();
    await transports.disconnectAll();
    await disconnectMCP();
    console.log("[platform] shutdown complete");
    logger.info("platform shutdown complete");
    await logger.flush();
  }

  let shutdownCalled = false;
  const handleSignal = () => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    void doShutdown().then(() => process.exit(0));
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  // Register restart callback (exit code 75 triggers restart via run-with-restart.sh)
  const RESTART_EXIT_CODE = 75;
  (globalThis as Record<string, unknown>).__golem_request_restart = () => {
    console.log("[platform] restart requested — shutting down with code 75");
    void doShutdown().then(() => process.exit(RESTART_EXIT_CODE));
  };

  const ctx: PlatformContext = {
    registry,
    transports,
    cronStore,
    feedStore,
    jobQueue,
    scheduler,
    shutdown: doShutdown,
  };

  console.log(
    `[platform] started with ${agentConfigs.length} agent(s)`,
  );
  logger.info(`platform started with ${agentConfigs.length} agent(s)`);

  return ctx;
}
