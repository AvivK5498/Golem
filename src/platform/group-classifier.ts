/**
 * Group Chat Classifier
 *
 * Each agent self-classifies whether it should respond to an untagged
 * group message. Uses the nano model with agent descriptions as context.
 */
import { generateText } from "ai";
import { getModelForId } from "../agent/model.js";
import { logger } from "../utils/external-logger.js";

const DEFAULT_CLASSIFIER_MODEL = "google/gemini-3.1-flash-lite-preview";

export interface GroupAgent {
  id: string;
  name: string;
  description: string;
}

/**
 * Classify whether this agent should respond to a group message.
 * Returns true if the agent should respond, false if it should stay silent.
 */
export async function shouldAgentRespond(
  agent: GroupAgent,
  otherAgents: GroupAgent[],
  message: string,
  nanoModel?: string | null,
): Promise<boolean> {
  // Pre-filter: skip very short messages, likely reactions or acknowledgements
  if (message.trim().length < 5) return false;

  const othersList = otherAgents
    .map(a => `- ${a.name}: ${a.description}`)
    .join("\n");

  try {
    // Fix #5: 5-second timeout to prevent stalling the message handler
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const { text } = await generateText({
      model: getModelForId(nanoModel || DEFAULT_CLASSIFIER_MODEL),
      temperature: 0,
      maxOutputTokens: 128,
      abortSignal: controller.signal,
      system:
        `You decide whether an AI agent should respond to a group chat message.\n` +
        `Default to YES if the message could reasonably relate to the agent's expertise.\n` +
        `Only say NO if the message is clearly outside this agent's domain and another agent is a better fit.\n` +
        `Reply with ONLY "YES" or "NO".`,
      prompt:
        `You are "${agent.name}": ${agent.description}\n\n` +
        `Other agents in this group:\n${othersList}\n\n` +
        `Message: "${message.slice(0, 500)}"\n\n` +
        `Could this relate to your expertise? Should you respond?`,
    });
    clearTimeout(timeout);

    const answer = text.trim().toUpperCase();
    const shouldRespond = answer.startsWith("YES");

    logger.info(`Group classify: ${agent.id} → ${shouldRespond ? "YES" : "NO"} (raw: "${text.trim()}", msg: "${message.slice(0, 80)}")`, {
      agent: agent.id,
      respond: String(shouldRespond),
      raw: text.trim(),
      message: message.slice(0, 80),
    });

    return shouldRespond;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Group classification failed for ${agent.id}: ${msg}`, { agent: agent.id });
    // On failure, respond (better to over-respond than stay silent)
    return true;
  }
}
