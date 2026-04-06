/**
 * Shared agent utilities — instruction building, tool resolution, memory helpers.
 *
 * The legacy agent singleton and processCommand orchestration have been removed.
 * Per-agent instances are now created in platform/platform.ts via createPlatformAgent().
 */
import { RequestContext } from "@mastra/core/request-context";
import type { MastraMemory } from "@mastra/core/memory";
import { allTools, alwaysAvailableTools } from "./mastra-tools.js";
import type { ChatType } from "./filter.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { agentLog } from "../utils/agent-logger.js";
import { formatTaskList } from "./task-state.js";
import type { MastraDBMessage } from "@mastra/core/agent";

// ── Prompt modes for internal LLM calls ─────────────────────

/**
 * Controls how much context is included in the system prompt.
 * - "full": All sections (persona, memory, conversation, chat type, skills). Default for owner messages.
 * - "autonomous": Lean prompt for automated runs (cron tasks, webhooks). Reduced tools, read-only memory.
 */
export type PromptMode = "full" | "autonomous";

// ── ImageData ──────────────────────────────────────────────

/** Optional image data passed when a user sends an image. */
export interface ImageData {
  base64: string;
  mimeType: string;
  filePath?: string;
}

export interface GroupTurnMeta {
  messageCount: number;
  shouldRefreshPersona: boolean;
  burstSize?: number;
}

// ── Persona loading from PERSONA.md ──────────────────────────

const PERSONA_PATH = path.resolve("personas/OWNER.md");

function loadPersona(): string | null {
  if (!fs.existsSync(PERSONA_PATH)) return null;
  return fs.readFileSync(PERSONA_PATH, "utf-8");
}

const PERSONA_DIR = path.resolve("personas");

function loadPersonaForChatType(chatType: ChatType): string | null {
  const typeMap: Record<ChatType, string> = {
    owner: "OWNER.md",
    group: "GROUP.md",
    client: "CLIENT.md",
    unknown: "DEFAULT.md",
  };
  const filename = typeMap[chatType] || "DEFAULT.md";
  const filePath = path.join(PERSONA_DIR, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf-8");
  }
  const defaultPath = path.join(PERSONA_DIR, "DEFAULT.md");
  if (fs.existsSync(defaultPath)) {
    return fs.readFileSync(defaultPath, "utf-8");
  }
  return null;
}

/**
 * Extract the content under an H2 section (## SectionName) from markdown.
 */
export function extractSection(markdown: string, sectionName: string): string | null {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^## ${escaped}\\s*\\n([\\s\\S]*?)(?=^## |$)`, "m");
  const match = markdown.match(regex);
  if (!match) return null;
  return match[1].trimEnd();
}


const MEDIA_CONTEXT_INSTRUCTIONS = `
- For image/media requests, deliver the actual file using send_media. A text-only status update is not a successful completion.
- If the current message includes an attached image, analyze it via vision context first. Do not use filesystem to inspect raw image bytes.
- Voice notes are transcribed to text before they reach you. Treat transcript content as the user's message and never claim you "can't hear audio" when a transcript is present.
`;

const ONBOARDING_PROMPT = `You are a newly set up personal assistant. This is your first conversation with your owner.

Your goal is to learn about them and configure yourself. In this conversation:
1. Introduce yourself warmly
2. Ask the owner's name
3. Ask what they'd like to call you (your agent name)
4. Ask about their communication style preferences (casual/formal, verbose/concise)
5. Ask about their typical tasks and how you can help
6. Ask what kinds of things they'd like automated or delegated


As you learn each piece of information, use the workspace write tool to create and populate the personas/OWNER.md sections:
- **Identity**: Your name, role, relationship
- **Owner**: Their name, preferences, timezone
- **Tone & Style**: Communication approach
- **Boundaries**: What you should/shouldn't do
- **Notes**: Anything else worth remembering

Once you've gathered enough to create a useful persona, confirm that setup is complete.
`;

const NON_OWNER_PROMPT =
  "You are a friendly chatbot. Have a natural conversation. You do not have access to any tools, scheduling, or admin features. Just chat helpfully and politely.";

// ── Tool resolution ────────────────────────────────────────

type ToolRegistry = Record<string, unknown>;

export const GROUP_ALLOWED_TOOL_IDS = [
  "web_search",
  "web_fetch",
] as const;

function pickToolsById(ids: readonly string[]): ToolRegistry {
  const tools: ToolRegistry = {};
  for (const id of ids) {
    if (id in allTools) {
      tools[id] = allTools[id as keyof typeof allTools];
    }
  }
  return tools;
}

/** Tools excluded from autonomous mode — destructive/config ops that shouldn't run unattended. */
const AUTONOMOUS_EXCLUDED_TOOLS = new Set([
  "delete_path",
  "config_update",
  "restart",
  "store_secret",
]);

export function resolveToolsForRequest(
  chatType: ChatType | undefined,
  promptMode: PromptMode | undefined,
): ToolRegistry {
  const effectiveMode = promptMode;

  if (chatType === "owner") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: Record<string, any> = { ...alwaysAvailableTools };

    // Autonomous mode: strip destructive/config tools
    if (effectiveMode === "autonomous") {
      for (const name of AUTONOMOUS_EXCLUDED_TOOLS) {
        delete tools[name];
      }
    }

    return tools;
  }

  if (chatType === "group") {
    return pickToolsById(GROUP_ALLOWED_TOOL_IDS);
  }

  return {};
}

// ── Dynamic instructions builder ────────────────────────────

/**
 * Build the system prompt dynamically for each request.
 * Reads chatType and other context from the RequestContext.
 */
export function buildInstructions(requestContext: RequestContext): string {
  const chatType = requestContext.get("chatType" as never) as ChatType | undefined;
  const promptMode = (requestContext.get("promptMode" as never) as PromptMode | undefined) || "full";
  const senderId = requestContext.get("senderId" as never) as string | undefined;
  const senderDisplayName = requestContext.get("senderDisplayName" as never) as string | undefined;
  const senderPlatform = requestContext.get("senderPlatform" as never) as string | undefined;
  const isOwner = chatType === "owner";
  const effectiveMode = promptMode;
  const isAutonomous = effectiveMode === "autonomous";
  const isInternal = isAutonomous;
  const nowLocal = requestContext.get("nowLocal" as never) as string | undefined;
  const timezone = requestContext.get("timezone" as never) as string | undefined;
  const resetConversation = requestContext.get("resetConversation" as never) as boolean | undefined;
  const timeBlock = nowLocal
    ? `Current time: ${nowLocal} (${timezone || "unknown timezone"})`
    : timezone
      ? `Timezone: ${timezone}`
      : null;

  // -- Base persona --
  let base: string;
  if (!isOwner && chatType) {
    const persona = loadPersonaForChatType(chatType);
    base = persona || NON_OWNER_PROMPT;
  } else {
    const persona = loadPersona();
    if (persona === null) {
      base = ONBOARDING_PROMPT;
    } else {
      base = persona;
    }
  }


  // Inject media handling instructions only when image/media context is present
  const hasMediaContext = !!requestContext.get("imageFilePath" as never);
  if (hasMediaContext) {
    base += MEDIA_CONTEXT_INSTRUCTIONS;
  }

  // -- Group chat context (full mode only) --
  if (!isInternal) {
    const groupMessageCount =
      chatType === "group"
        ? (requestContext.get("groupMessageCount" as never) as number | undefined)
        : undefined;
    const groupShouldRefreshPersona =
      chatType === "group"
        ? (requestContext.get("groupShouldRefreshPersona" as never) as boolean | undefined)
        : undefined;
    const groupBurstSize =
      chatType === "group"
        ? (requestContext.get("groupBurstSize" as never) as number | undefined)
        : undefined;

    if (chatType === "group" && groupShouldRefreshPersona) {
      base +=
        "\n\n[HIGH PRIORITY: Persona maintenance tick]\n" +
        "- This is a scheduled maintenance turn (~every 10 group messages).\n" +
        "- Before finalizing your user reply, decide whether a stable relationship/preference/dynamic fact was learned.\n" +
        "- If yes, apply one small precise update to personas/GROUP.md using the workspace write tool.\n" +
        "- If no stable fact emerged, skip the file update.\n" +
        "- Maintenance is silent: never mention GROUP.md, file edits, maintenance ticks, or internal memory updates in the user-facing message.";
    }

    if (chatType) {
      const chatContextMap: Partial<Record<ChatType, string>> = {
        unknown: "This is an unknown contact. Be polite but brief.",
        group:
          "You are in a group chat. Lurk by default and respond only when directly addressed or when a short, clearly useful intervention is needed. Avoid repeating yourself across adjacent turns.",
      };
      const ctx = chatContextMap[chatType];
      if (ctx) {
        base += `\n\n[Chat context: ${ctx}]`;
      }
    }
    if (chatType === "group") {
      base +=
        "\n\nGroup behavior requirements:\n" +
        "- If this turn contains a clustered batch of messages, respond to all actionable points in the cluster (not only the last line).\n" +
        "- Keep replies concise and avoid repeating the same claim across consecutive turns.\n" +
        "- If you used web_search/web_fetch in this turn, include at least one source link naturally in your reply.\n" +
        "- If a persona maintenance tick is active, perform the maintenance decision before finalizing the reply.";

      if (groupBurstSize && groupBurstSize > 1) {
        base += `\n- This is a clustered turn containing ${groupBurstSize} user messages.`;
      }

      if (typeof groupMessageCount === "number") {
        base += `\n\n[Group message counter: ${groupMessageCount}]`;
      }
    }
    if (chatType === "group" && senderId) {
      const senderBits = [
        senderDisplayName ? `name=${senderDisplayName}` : null,
        `id=${senderId}`,
        senderPlatform ? `platform=${senderPlatform}` : null,
      ].filter(Boolean);
      base += `\n\n[Group sender context: ${senderBits.join(", ")}]`;
    }
  }

  if (timeBlock) {
    base += `\n\n${timeBlock}`;
  }

  if (isOwner && promptMode === "full" && resetConversation) {
    base +=
      "\n\nTreat the current user message as a fresh request." +
      " Ignore recent task context, remembered task state, and the immediately preceding conversation unless the user explicitly asks you to continue or reference them.";
  }

  // Active task list — inject for owner mode so the model sees progress state
  if (isOwner && !isAutonomous) {
    const jid = requestContext.get("jid" as never) as string | undefined;
    if (jid) {
      const taskBlock = formatTaskList(jid);
      if (taskBlock) {
        base += taskBlock;
      }
    }
  }

  // Parallel tool calls
  if (isOwner || isInternal) {
    base += `\n\nYou can call multiple tools in a single response. When multiple independent operations are needed and there are no dependencies between them, invoke all relevant tools simultaneously rather than one at a time. For example, if you need to search the web for 3 things, make all 3 web_search calls in a single step.`;
  }

  return base;
}

export function shouldTreatAsFreshRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  return [
    /treat .* as(?: if it(?:'s| is))? (?:a )?(?:completely )?new request/,
    /treat .* as fresh/,
    /ignore (?:the )?(?:old|previous|prior|earlier) (?:conversation|context|messages|history)/,
    /start (?:again|over) (?:from scratch)?/,
    /from scratch/,
    /don't use (?:old|previous|prior|earlier) (?:context|conversation|history)/,
  ].some((pattern) => pattern.test(normalized));
}

// ── Time instruction block ─────────────────────────────────

export function buildCurrentTimeInstructionBlock(params: {
  nowIso?: string;
  nowLocal?: string;
  nowUnix?: number;
  timezone?: string;
}): string | null {
  const { nowIso, nowLocal, nowUnix, timezone } = params;
  if (!nowIso && !nowLocal && !nowUnix) return null;

  const lines = ["Current time context (source of truth for relative dates):"];
  if (nowIso) lines.push(`- UTC: ${nowIso}`);
  if (nowLocal) lines.push(`- Local (${timezone || "local"}): ${nowLocal}`);
  if (typeof nowUnix === "number" && Number.isFinite(nowUnix)) {
    lines.push(`- Unix: ${nowUnix}`);
  }
  return lines.join("\n");
}

// ── Memory helpers ──────────────────────────────────────────

export function textToMemoryMessage(params: {
  role: "user" | "assistant";
  text: string;
  threadId: string;
  resourceId: string;
  createdAt?: Date;
}): MastraDBMessage {
  const normalized = params.text.trim();
  return {
    id: randomUUID(),
    role: params.role,
    createdAt: params.createdAt || new Date(),
    threadId: params.threadId,
    resourceId: params.resourceId,
    content: {
      format: 2,
      parts: [{ type: "text", text: normalized }],
      content: normalized,
    },
  };
}

export type CompactMemoryMode = "none" | "owner" | "group";

export function resolveCompactMemoryMode(params: {
  usesMastraMemory: boolean;
  chatType?: ChatType;
  promptMode: PromptMode;
  ownerObservationalMemoryEnabled: boolean;
  ownerWorkingMemoryEnabled?: boolean;
}): CompactMemoryMode {
  if (!params.usesMastraMemory) {
    return "none";
  }
  if (params.ownerObservationalMemoryEnabled) {
    return "none";
  }
  if (params.ownerWorkingMemoryEnabled) {
    return "none";
  }
  if (params.chatType === "group" && params.promptMode === "full") {
    return "group";
  }
  if (params.chatType !== "owner") {
    return "none";
  }
  return "owner";
}

export async function persistCompactMemoryEntries(params: {
  memory: MastraMemory;
  memoryScope: { thread: string; resource: string };
  scope: CompactMemoryMode;
  entries: Array<{ role: "user" | "assistant"; text: string }>;
}): Promise<void> {
  if (!params.entries.length) return;
  const createdAt = new Date();
  try {
    await params.memory.saveMessages({
      messages: params.entries.map((entry, index) =>
        textToMemoryMessage({
          role: entry.role,
          text: entry.text,
          threadId: params.memoryScope.thread,
          resourceId: params.memoryScope.resource,
          createdAt: new Date(createdAt.getTime() + index),
        }),
      ),
      memoryConfig: {
        readOnly: false,
        observationalMemory: false,
      },
    });
  } catch (memoryErr) {
    const msg = memoryErr instanceof Error ? memoryErr.message : String(memoryErr);
    agentLog("agent", "warning", {
      message: "mastraMemory.saveMessages failed; continuing without persistence",
      error: msg,
      scope: params.scope,
      thread: params.memoryScope.thread,
      resource: params.memoryScope.resource,
    });
  }
}
