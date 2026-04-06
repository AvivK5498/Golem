export interface FinalizeResultInput {
  finishReason: string;
  responseText: string;
  toolNames: string[];
  hasZeroCallToolCallStep: boolean;
}

export interface FinalizeResultOutput {
  result: string;
  endedOnToolCallsLike: boolean;
  usedStepLimitFallback: boolean;
}

const TRUNCATION_SUFFIX = "[Response truncated due to length limits.]";

function isNarrationOnlyText(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;

  // "let me search/check/look..." — explicit tool-use narration
  if (/^(?:now |first, )?let me (?:search|check|look|load|read|fetch|find|activate|kick off|start|run)\b/.test(normalized)) return true;

  // "let me ...:" — planning statement ending with colon
  if (/^(?:now |first, )?let me\b/.test(normalized) && normalized.endsWith(":")) return true;

  // "now I have/understand/need to/will/I'll..." — agent explaining its plan
  if (/^now i (?:have|understand|need to|'ll|will|can see|see that)\b/.test(normalized)) return true;

  // "good, I have..." — acknowledgement before action
  if (/^(?:good|great|perfect|ok|okay|alright),?\s+(?:i (?:have|need|understand|see|'ll|will)|let me)\b/.test(normalized)) return true;

  // "I'll now/first..." — future-tense planning
  if (/^i'?ll (?:now|first|start|begin|kick off|check|search|fetch|look)\b/.test(normalized)) return true;

  // Ends with ":" and is short — almost certainly a preamble to tool calls
  if (normalized.endsWith(":") && normalized.length < 300) return true;

  return false;
}

export function buildStepLimitFallback(toolNames: string[]): string {
  const recentTools = toolNames.slice(-5);
  if (recentTools.length > 0) {
    return `I completed several actions (${recentTools.join(", ")}) but hit the step limit before writing a final summary. Send a specific follow-up and I'll continue from that point.`;
  }
  return "I hit the step limit before writing a final summary. Send a specific follow-up and I'll continue from that point.";
}

export function buildTripwireFallback(toolNames: string[]): string {
  const recentTools = toolNames.slice(-5);
  if (recentTools.length > 0) {
    return `I started the task, but an internal guard blocked a redundant tool loop (${recentTools.join(", ")}). Retry once and I'll take a narrower path.`;
  }
  return "I started the task, but an internal guard blocked a redundant tool loop. Retry once and I'll take a narrower path.";
}

export function selectPrimaryResponseText(params: {
  responseText: string;
  fallbackStepText: string;
  hasToolCalls: boolean;
}): string {
  const { responseText, fallbackStepText, hasToolCalls } = params;

  // When tool calls happened, response.text may concatenate all steps' text.
  // fallbackStepText is the last step's text — the actual answer.
  if (hasToolCalls && fallbackStepText) {
    return fallbackStepText;
  }

  return responseText || fallbackStepText;
}

export function finalizeResult(input: FinalizeResultInput): FinalizeResultOutput {
  const {
    finishReason,
    responseText,
    toolNames,
  } = input;

  let result = responseText;
  const narrationOnly = isNarrationOnlyText(result);
  const endedOnToolCallsLike =
    finishReason === "tool-calls" ||
    (finishReason === "unknown" && toolNames.length > 0);

  let usedStepLimitFallback = false;

  if (finishReason === "tripwire" && (!result.trim() || narrationOnly)) {
    result = buildTripwireFallback(toolNames);
  } else if ((!result.trim() || narrationOnly) && (endedOnToolCallsLike || toolNames.length > 0)) {
    // The model produced no substantive text, or only narration (e.g., "Now let me kick off...").
    // This applies both when the agent was cut off mid-tool-calls AND when it finished with "stop"
    // but the only text came from an early narration step (picked up by fallbackStepText).
    result = buildStepLimitFallback(toolNames);
    usedStepLimitFallback = true;
  }

  if (finishReason === "length") {
    result = result ? `${result}\n\n${TRUNCATION_SUFFIX}` : TRUNCATION_SUFFIX;
  }

  if (!result) {
    result = "(no response)";
  }

  return {
    result,
    endedOnToolCallsLike,
    usedStepLimitFallback,
  };
}
