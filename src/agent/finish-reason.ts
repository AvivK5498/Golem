function canonicalizeFinishReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  switch (normalized) {
    case "tool_calls":
      return "tool-calls";
    case "end-turn":
      return "stop";
    default:
      return normalized;
  }
}

function deriveFinishReason(
  rawFinishReason: string | null,
  steps: Array<Record<string, unknown>>,
  _responseText: string,
): string {
  const canonicalRaw = canonicalizeFinishReason(rawFinishReason);
  if (canonicalRaw && canonicalRaw !== "unknown") {
    return canonicalRaw;
  }

  // Check the ACTUAL last step — don't filter nulls out, otherwise a
  // phantom empty step (null finishReason, 0 tool calls) causes us to
  // pick a *previous* step's "tool-calls" and falsely trigger the
  // step-limit fallback.
  const lastStep = steps.at(-1);
  if (lastStep) {
    const lastStepReason = canonicalizeFinishReason(lastStep.finishReason);
    if (lastStepReason && lastStepReason !== "unknown") {
      return lastStepReason;
    }

    // Last step has null/unknown finishReason — check its content.
    // If it made tool calls, the model was cut off mid-tool-use.
    const lastStepCalls = lastStep.toolCalls as Array<Record<string, unknown>> | undefined;
    if (lastStepCalls?.length) {
      return "tool-calls";
    }
  }

  // No tool calls on the last step and no reliable finishReason — model stopped.
  return "stop";
}

export { canonicalizeFinishReason, deriveFinishReason };
