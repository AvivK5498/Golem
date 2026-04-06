/**
 * Platform prompt/instructions builder.
 *
 * Extracted from platform.ts to keep orchestration and prompt logic separate.
 */
import type { BehaviorConfig } from "./agent-settings.js";

// ── Behavior preset maps ───────────────────────────────────

export const RESPONSE_LENGTH_PRESETS: Record<string, string> = {
  brief: "Respond in 1–3 sentences. No preamble, no summaries, no filler. If using tools, deliver results directly without narrating what you're about to do. Only elaborate when the user explicitly asks for detail.",
  balanced: "Respond in a natural length — short for simple questions, longer for complex ones. For multi-step tool use, briefly state what you're doing before acting. Skip narration for obvious single-tool calls.",
  detailed: "Provide thorough responses with context and reasoning. Use bullet points or short paragraphs for structure. Narrate each phase of multi-step work — state what you're doing, report findings, then deliver the final answer.",
};

export const AGENCY_PRESETS: Record<string, string> = {
  execute_first: "Act on requests immediately. The user's request is valid and actionable — do not second-guess it. Only ask questions if the request is genuinely ambiguous, has multiple valid interpretations, or cannot be executed due to missing information.",
  ask_before_acting: "Before executing a task, briefly state your plan and wait for confirmation. For simple, low-risk requests (lookups, questions), respond directly without asking.",
  consultative: "Act as an advisor. Present options, trade-offs, and recommendations rather than executing directly. Ask clarifying questions to understand the full picture before suggesting a course of action.",
};

export const TONE_PRESETS: Record<string, string> = {
  casual: "Use a relaxed, conversational tone. Short sentences, contractions, and informal language are fine. Match the energy of a knowledgeable friend — warm but not sycophantic. Skip honorific greetings and sign-offs.",
  balanced: "Use a neutral, clear tone. Be direct without being terse, friendly without being chatty. Avoid both stiff formality and forced casualness.",
  professional: "Use a polished, structured tone. Precise word choice, complete sentences, no slang or contractions. Suitable for content the user might forward to colleagues or clients.",
};

export const FORMAT_PRESETS: Record<string, string> = {
  texting: "Very short messages. Fragments ok. One thought per message. No lists, no headers, no sign-offs.",
  conversational: "Natural flowing responses. Use paragraphs for longer answers, keep it readable.",
  structured: "Use bullet points, numbered lists, and clear sections for complex answers.",
};

export const LANGUAGE_PRESETS: Record<string, string> = {
  english: "Always respond in English, even if the user writes in another language.",
  hebrew: "Always respond in Hebrew. Use natural modern Hebrew — avoid overly formal or archaic phrasing. Technical terms can stay in English when there's no natural Hebrew equivalent.",
  auto_detect: "Respond in the same language the user writes in. If the message mixes languages, match the dominant language. Default to English for ambiguous cases.",
};

/** Assemble a ## Behavior section from dropdown presets + custom instructions. */
export function buildBehaviorSection(behavior: BehaviorConfig): string {
  const parts = [
    RESPONSE_LENGTH_PRESETS[behavior.responseLength] || RESPONSE_LENGTH_PRESETS.balanced,
    AGENCY_PRESETS[behavior.agency] || AGENCY_PRESETS.execute_first,
    TONE_PRESETS[behavior.tone] || TONE_PRESETS.balanced,
    FORMAT_PRESETS[behavior.format] || FORMAT_PRESETS.conversational,
    LANGUAGE_PRESETS[behavior.language] || LANGUAGE_PRESETS.auto_detect,
  ];

  let section = parts.map(p => `- ${p}`).join("\n");

  if (behavior.customInstructions.trim()) {
    section += `\n\n### Custom Instructions\n${behavior.customInstructions.trim()}`;
  }

  return section;
}

// ── Prompt builder ─────────────────────────────────────────

export interface PromptParams {
  /** Display name of the agent */
  agentName: string;
  /** Character name if different from agent name */
  characterName?: string;
  /** Owner's name */
  ownerName?: string;
  /** Agent's role (e.g., "personal operator", "assistant") */
  role?: string;
  /** Number of recent messages in context */
  lastMessages?: number;
  /** Whether this is a group chat context */
  isGroup?: boolean;
  /** Agent behavior config (from settings dropdowns) */
  behavior?: BehaviorConfig;
}

/** Build platform prompt sections separately for flexible ordering and UI display */
export function buildPlatformPromptSections(params: PromptParams): { label: string; content: string; editable?: boolean }[] {
  const {
    agentName,
    characterName,
    ownerName = "the user",
    role = "personal assistant",
    lastMessages = 12,
    isGroup = false,
    behavior,
  } = params;
  const displayName = characterName || agentName;

  const sections: { label: string; content: string; editable?: boolean }[] = [
    {
      label: "Opening",
      content: `You have emerged, you are now ${displayName}, ${ownerName}'s ${role}.\nBefore we get into requests and details here are a few guidelines you must adhere to.`,
    },
  ];

  // NOTE: Persona is inserted after Opening by the instructions callback in platform.ts

  // Behavior section (assembled from user-configured dropdowns)
  if (behavior) {
    sections.push({
      label: "Behavior",
      content: buildBehaviorSection(behavior),
    });
  }

  sections.push(
    // NOTE: Delegation is inserted after Memory by platform.ts
    {
      label: "Memory",
      content: isGroup
        ? `You have conversation history from this group chat. Your working memory (preferences, facts) is available from your 1:1 conversations but is read-only in group context.`
        : `You are in an ongoing conversation with 2 memory layers.
Layer 1: Recent conversation history — the last ${lastMessages} messages. Your primary reference for conversational continuity.
Layer 2: Working memory — a persistent scratchpad with your profile, preferences, ongoing projects, and key facts. Always visible in your context.

Update working memory using \`updateWorkingMemory\` when:
- User shares a preference, correction, or personal fact
- A new ongoing project or deadline is mentioned
- You discover something about the user's environment (accounts, tools, contacts)
- The user's communication style or tone preferences become clear
- You notice outdated facts (completed goals, changed preferences, old deadlines) — update or remove them`,
    },
    {
      label: "Failure Handling",
      content: `If a tool or sub-agent fails:
- Retry once if reasonable. If still failing:
- Return partial result with a short, direct explanation
- ${ownerName} prefers seeing failures over the agent hunting endlessly for an answer`,
    },
    {
      label: "Formatting (Telegram)",
      content: `You are responding via Telegram. Use standard Markdown — it's auto-converted before sending.
- **bold**, *italic*, \`inline code\`, \`\`\`code blocks\`\`\` — all work
- Bullet lists with \`-\` work well
- Tables render poorly — use bullet lists instead
- Headings (#, ##) don't render — use **bold** text on its own line instead`,
    },
  );

  return sections;
}

/** Returns flat string for backward compat */
export function buildPlatformSystemPrompt(params: PromptParams): string {
  return buildPlatformPromptSections(params)
    .map(s => s.label === "Opening" ? s.content : `## ${s.label}\n\n${s.content}`)
    .join("\n\n");
}

/** Build group chat context block to append to the system prompt. */
export function buildGroupChatContext(
  otherAgents: { name: string; description: string; botUsername?: string }[],
): string {
  const agentList = otherAgents
    .map(a => `- ${a.name}${a.botUsername ? ` (@${a.botUsername})` : ""}: ${a.description}`)
    .join("\n");

  return `\n\n## Group Chat Context

You are in a group chat with the user and other agents. You share conversation history — you can see what other agents said.

Other agents in this group:
${agentList}

In the conversation history:
- Your messages are tagged with your name (e.g., "[Agent - Role] ...").
- Other agents' messages have their name tags too.
- User messages are prefixed with the user's name (e.g., "[User] ...").
These tags are added automatically — do NOT include them in your response.

Group behavior:
- Only respond when the message is relevant to your expertise
- You can @mention other agents to involve them (e.g., "@${otherAgents[0]?.botUsername || "agent"} what do you think?")
- Don't repeat what another agent already said — build on it
- Keep responses shorter than in 1:1 — group chats should be snappy
- If another agent would be more appropriate, suggest the user ask them`;
}
