/**
 * TTS facade: decides whether to synthesize a voice reply based on
 * per-agent settings + the inbound message's modality.
 *
 * Modes:
 *   - off      : never synthesize
 *   - always   : synthesize every reply (subject to guards)
 *   - inbound  : synthesize only if the user sent a voice note
 *   - tagged   : synthesize only if the reply contains [[tts]] marker
 *
 * Guards (skip TTS → fall back to text):
 *   - empty text
 *   - very short (<10 chars)
 *   - exceeds maxChars (default 1500)
 *   - contains MEDIA: directive
 */

import { synthesizeElevenLabs } from "./elevenlabs.js";
import type { AgentSettings } from "../platform/agent-settings.js";
import { logger } from "../utils/external-logger.js";

export type TtsMode = "off" | "always" | "inbound" | "tagged";

export interface TtsDecisionInput {
  agentId: string;
  agentSettings: AgentSettings;
  replyText: string;
  inboundWasVoice: boolean;
}

export interface TtsResult {
  audio: Buffer;
  spokenText: string;
}

const MIN_CHARS = 10;
const DEFAULT_MAX_CHARS = 1500;
const TAG_MARKER = /\[\[tts\]\]/i;

/**
 * Returns an audio buffer if TTS should fire, or null to fall back to text.
 * Never throws — on synthesis error, logs and returns null.
 */
export async function maybeSynthesizeReply(
  input: TtsDecisionInput,
): Promise<TtsResult | null> {
  const { agentId, agentSettings, replyText, inboundWasVoice } = input;

  const mode = (agentSettings.getTtsMode(agentId) || "off") as TtsMode;
  if (mode === "off") return null;

  const text = replyText?.trim() || "";
  if (!text) return null;
  if (text.length < MIN_CHARS) return null;
  if (/^MEDIA:/m.test(text)) return null;

  const maxChars = agentSettings.getTtsMaxChars(agentId) ?? DEFAULT_MAX_CHARS;
  if (text.length > maxChars) return null;

  let spokenText = text;
  if (mode === "inbound" && !inboundWasVoice) return null;
  if (mode === "tagged") {
    if (!TAG_MARKER.test(text)) return null;
    spokenText = text.replace(TAG_MARKER, "").trim();
    if (!spokenText) return null;
  }

  const voiceId = agentSettings.getTtsVoiceId(agentId);
  if (!voiceId) {
    try { logger.warn("tts.skip.no_voice", { agent: agentId }); } catch { /* ignore */ }
    return null;
  }

  const hasHebrew = /[\u0590-\u05FF]/.test(spokenText);

  try {
    const audio = await synthesizeElevenLabs({
      text: spokenText,
      voiceId,
      modelId: agentSettings.getTtsModelId(agentId) || undefined,
      stability: (agentSettings.getTtsStability(agentId) as "creative" | "natural" | "robust" | null) || undefined,
      speed: agentSettings.getTtsSpeed(agentId) ?? undefined,
      languageCode: hasHebrew ? "he" : undefined,
    });
    return { audio, spokenText };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { logger.error("tts.synth.fail", { agent: agentId, error: msg }); } catch { /* ignore */ }
    console.error(`[tts] synthesis failed for agent ${agentId}: ${msg}`);
    return null;
  }
}
