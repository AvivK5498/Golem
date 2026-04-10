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

// ── Tempo section variants ─────────────────────────────────
//
// The conversation-tempo prompt is a tricky bit of instruction design. Small
// models tend to read the line, acknowledge it, and respond identically. The
// variants below explore different framings — categorical labels, imperative
// DO/DON'T, single-line ultra-tight, and consequence-first. Switch via the
// GOLEM_TEMPO_VARIANT env var (defaults to "v8").

type TempoBand = "active" | "recent" | "stale" | "cold";

function buildTempoSection(elapsed: string, band: TempoBand | undefined): string {
  const variant = process.env.GOLEM_TEMPO_VARIANT || "v10";
  const b = band || "recent";
  switch (variant) {
    case "v5": return tempoVariantV5(elapsed, b);
    case "v6": return tempoVariantV6(elapsed, b);
    case "v7": return tempoVariantV7(elapsed, b);
    case "v8": return tempoVariantV8(elapsed, b);
    case "v9": return tempoVariantV9(elapsed, b);
    case "v10": return tempoVariantV10(elapsed, b);
    default:   return tempoVariantV8(elapsed, b);
  }
}

/** V10 — Allow EXPLICIT acknowledgment for cold cases (drops silent constraint). */
function tempoVariantV10(elapsed: string, band: TempoBand): string {
  if (band === "cold") {
    return `### Conversation tempo
The user has been away for ${elapsed}. This is a real gap, not a follow-up.

When you reply, you SHOULD briefly acknowledge that the user is picking the conversation back up after this gap. Examples of natural acknowledgments:
- "Hey — back to the lasagna?"
- "Oh hey, returning to this —"
- "Right, the lasagna conversation. So..."

Treat any "tomorrow" or "today" references from the prior conversation as past events. The dinner party / deadline / appointment that was upcoming when you last spoke has likely happened by now. If relevant, ask how it went or pivot to advice for next time.

You may reference the gap in natural language ("a while back", "the other day") but don't quote the exact duration.`;
  }
  if (band === "stale") {
    return `### Conversation tempo
${elapsed} since the previous user message. The user came back to this later. Respond directly without greeting. Don't ask "how much time do you have" or other live-session logistics. Don't quote the elapsed time.`;
  }
  return `### Conversation tempo
${elapsed} since the previous user message. Continue mid-thread without greeting or summary. Don't quote the elapsed time.`;
}

/** V5 — Categorical label + tight directives. */
function tempoVariantV5(elapsed: string, band: TempoBand): string {
  const status = band === "active" ? "ACTIVE"
    : band === "recent" ? "RECENT"
    : band === "stale" ? "STALE"
    : "COLD";
  return `### Conversation status
Last activity: ${elapsed} ago. Status: ${status}.
${
  band === "cold"
    ? `This conversation is COLD. Any prior references to "tomorrow" / "today" / "later" point to events that are now in the past. Do not ask logistics questions ("how much time do you have"). Give a self-contained reply that does not build on the prior plan. Do not quote the elapsed time.`
    : band === "stale"
    ? `This conversation is STALE — the user came back to it later in the day. Respond directly. Do not ask logistics questions that assume a fast-moving exchange. Do not greet. Do not quote the elapsed time.`
    : `Continue mid-thread. No greeting, no summary, no logistics questions. Do not quote the elapsed time.`
}`;
}

/** V6 — Lead with the verdict, not the duration. */
function tempoVariantV6(elapsed: string, band: TempoBand): string {
  const lead = band === "cold"
    ? `You are picking up a COLD conversation (${elapsed} since last user message).`
    : band === "stale"
    ? `You are returning to a STALE conversation (${elapsed} since last user message).`
    : band === "recent"
    ? `You are continuing a RECENT exchange (${elapsed} since last user message).`
    : `You are mid-thread (${elapsed} since last user message).`;

  return `### Conversation tempo
${lead}

${
  band === "cold"
    ? `Anything the prior conversation called "tomorrow" or "today" is now past. Do not assume the original plan still applies. Do not ask "how much time do you have" or other live-session logistics. Give a fresh, self-contained answer. Never quote the elapsed time.`
    : band === "stale"
    ? `Respond directly without greeting. Do not ask logistics questions that only make sense in a live exchange. Never quote the elapsed time.`
    : `Continue without greeting or summary. Never quote the elapsed time.`
}`;
}

/** V7 — Single-line ultra-tight (one sentence + one constraint). */
function tempoVariantV7(elapsed: string, band: TempoBand): string {
  const guidance = band === "cold"
    ? `treat any prior "tomorrow"/"today" references as past events and answer self-contained`
    : band === "stale"
    ? `respond directly without asking live-session logistics questions`
    : `continue mid-thread without greeting`;
  return `Conversation tempo: ${elapsed} since the previous user message — ${guidance}. Never quote the elapsed time.`;
}

/** V8 — Categorical label + DO/DON'T imperatives (small-model friendly). */
function tempoVariantV8(elapsed: string, band: TempoBand): string {
  const lines: string[] = [];
  lines.push(`### Conversation tempo`);
  lines.push(`Last user message: ${elapsed} ago. [${band.toUpperCase()}]`);
  lines.push("");
  if (band === "cold") {
    lines.push(`DO: give a self-contained answer; assume the prior plan no longer applies.`);
    lines.push(`DON'T: reference "tomorrow"/"today"/"later" from the prior context — those events have already happened.`);
    lines.push(`DON'T: ask "how much time do you have" or other live-session logistics.`);
    lines.push(`DON'T: quote the elapsed duration aloud.`);
  } else if (band === "stale") {
    lines.push(`DO: respond directly, no greeting.`);
    lines.push(`DON'T: ask logistics questions that only make sense in a fast-moving exchange.`);
    lines.push(`DON'T: quote the elapsed duration aloud.`);
  } else {
    lines.push(`DO: continue mid-thread.`);
    lines.push(`DON'T: greet, summarize, or quote the elapsed duration.`);
  }
  return lines.join("\n");
}

/** V9 — Two-line minimal: state + single forbidden behavior. */
function tempoVariantV9(elapsed: string, band: TempoBand): string {
  if (band === "cold") {
    return `Conversation state: COLD (${elapsed} idle). The dinner-party / deadline / event from the prior conversation is now in the past. Answer self-contained — do not build on the prior plan.`;
  }
  if (band === "stale") {
    return `Conversation state: STALE (${elapsed} idle). Answer directly without asking live-session logistics.`;
  }
  return `Conversation state: ACTIVE (${elapsed}). Continue mid-thread.`;
}

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
  /**
   * Pre-formatted "time since previous user message" string (e.g. "4h 12m",
   * "3 days", "just now"). When set, a tempo line is appended to the Memory
   * section so the agent has conversational tempo awareness. Omit on
   * brand-new conversations or under-1-minute follow-ups.
   */
  tempoSincePreviousUserMessage?: string;
  /** Discrete tempo band — active | recent | stale | cold. */
  tempoBand?: "active" | "recent" | "stale" | "cold";
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
    tempoSincePreviousUserMessage,
    tempoBand,
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

  // Build the memory section content. The tempo line lives at the end so the
  // agent reads the standing memory layout first, then the situational tempo.
  const buildMemoryContent = (): string => {
    const baseGroup = `You have conversation history from this group chat. Your working memory (preferences, facts) is available from your 1:1 conversations but is read-only in group context.`;
    const baseDirect = `You are in an ongoing conversation with 2 memory layers.
Layer 1: Recent conversation history — the last ${lastMessages} messages. Your primary reference for conversational continuity.
Layer 2: Working memory — a persistent scratchpad with your profile, preferences, ongoing projects, and key facts. Always visible in your context.

Update working memory using \`updateWorkingMemory\` when:
- User shares a preference, correction, or personal fact
- A new ongoing project or deadline is mentioned
- You discover something about the user's environment (accounts, tools, contacts)
- The user's communication style or tone preferences become clear
- You notice outdated facts (completed goals, changed preferences, old deadlines) — update or remove them`;

    let content = isGroup ? baseGroup : baseDirect;

    if (tempoSincePreviousUserMessage) {
      content += "\n\n" + buildTempoSection(tempoSincePreviousUserMessage, tempoBand);
    }

    return content;
  };

  sections.push(
    // NOTE: Delegation is inserted after Memory by platform.ts
    {
      label: "Memory",
      content: buildMemoryContent(),
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
