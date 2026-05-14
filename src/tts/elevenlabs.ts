/**
 * ElevenLabs TTS client.
 *
 * Returns an Opus-encoded buffer suitable for Telegram voice messages
 * (sendVoice accepts OGG/Opus natively and renders it as a voice bubble).
 */

import { logger } from "../utils/external-logger.js";

const API_BASE = "https://api.elevenlabs.io/v1";

export interface ElevenLabsOptions {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: "creative" | "natural" | "robust";
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  speed?: number;
  languageCode?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export async function synthesizeElevenLabs(opts: ElevenLabsOptions): Promise<Buffer> {
  const apiKey = opts.apiKey || process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");
  if (!opts.voiceId) throw new Error("voiceId required");
  if (!opts.text?.trim()) throw new Error("text required");

  const modelId = opts.modelId || "eleven_v3";
  const timeoutMs = opts.timeoutMs ?? 30_000;

  // ElevenLabs expects stability as a NUMBER (0.0–1.0), not a string.
  // Map our UX-friendly mode names to the numeric range the API accepts.
  const stabilityNumeric =
    opts.stability === "creative" ? 0.3 :
    opts.stability === "natural"  ? 0.5 :
    opts.stability === "robust"   ? 0.8 :
    undefined;

  const voiceSettings: Record<string, unknown> = {};
  if (stabilityNumeric !== undefined) voiceSettings.stability = stabilityNumeric;
  if (opts.similarityBoost !== undefined) voiceSettings.similarity_boost = opts.similarityBoost;
  if (opts.style !== undefined) voiceSettings.style = opts.style;
  if (opts.useSpeakerBoost !== undefined) voiceSettings.use_speaker_boost = opts.useSpeakerBoost;
  // Speed: 0.7–1.2 per ElevenLabs docs. On v3, speed is deprioritized in favor
  // of tag/punctuation-driven pacing; leaving at 1.0 is the recommended default.
  if (opts.speed !== undefined) {
    voiceSettings.speed = Math.max(0.7, Math.min(1.2, opts.speed));
  }

  const body = {
    text: opts.text,
    model_id: modelId,
    output_format: "opus_48000_64",
    ...(Object.keys(voiceSettings).length > 0 ? { voice_settings: voiceSettings } : {}),
    ...(opts.languageCode ? { language_code: opts.languageCode } : {}),
  };

  const url = `${API_BASE}/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=opus_48000_64`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "content-type": "application/json",
        accept: "audio/ogg",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const requestId = res.headers.get("x-request-id") || "";
      throw new Error(
        `ElevenLabs ${res.status} ${res.statusText}${requestId ? ` (req ${requestId})` : ""}: ${errText.slice(0, 500)}`,
      );
    }

    const arr = await res.arrayBuffer();
    const buf = Buffer.from(arr);
    try {
      logger.info("tts.elevenlabs.ok", {
        voiceId: opts.voiceId,
        model: modelId,
        bytes: String(buf.length),
        textLen: String(opts.text.length),
      });
    } catch { /* ignore */ }
    return buf;
  } finally {
    clearTimeout(timeout);
  }
}
