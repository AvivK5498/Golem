import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/external-logger.js";

export type TranscriptionFailureCode =
  | "disabled"
  | "input-missing"
  | "no-api-key"
  | "api-error"
  | "timeout";

export interface TranscriptionAttempt {
  provider: string;
  model: string;
  status: "ok" | "error";
  durationMs: number;
  errorCode?: TranscriptionFailureCode;
  errorMessage?: string;
}

export interface TranscriptionResult {
  ok: boolean;
  text: string | null;
  filePath: string;
  fileSizeBytes: number;
  provider: string | null;
  fallbackUsed: boolean;
  attempts: TranscriptionAttempt[];
  errorCode?: TranscriptionFailureCode;
  errorMessage?: string;
}

export interface WhisperConfig {
  enabled: boolean;
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs?: number;
}

const DEFAULT_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";
const DEFAULT_TIMEOUT_MS = 30000;

function fail(filePath: string, fileSizeBytes: number, code: TranscriptionFailureCode, message: string, attempts: TranscriptionAttempt[] = []): TranscriptionResult {
  return { ok: false, text: null, filePath, fileSizeBytes, provider: null, fallbackUsed: false, attempts, errorCode: code, errorMessage: message };
}

/**
 * Transcribe an audio file via an OpenAI-compatible speech-to-text API (default: Groq).
 */
export async function transcribeAudio(
  filePath: string,
  config: WhisperConfig,
): Promise<TranscriptionResult> {
  let fileSizeBytes = 0;
  try {
    fileSizeBytes = fs.statSync(filePath).size;
  } catch {
    return fail(filePath, 0, "input-missing", "Audio file does not exist or is unreadable");
  }

  if (!config.enabled) {
    return fail(filePath, fileSizeBytes, "disabled", "Voice transcription is disabled");
  }

  if (!config.apiKey) {
    return fail(filePath, fileSizeBytes, "no-api-key", "Transcription API key not configured");
  }

  const endpoint = config.endpoint || DEFAULT_ENDPOINT;
  const model = config.model || DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;

  logger.info("Transcription started", { endpoint, model, file: filePath, sizeBytes: String(fileSizeBytes) });

  const startedAt = Date.now();
  const attempt: TranscriptionAttempt = { provider: endpoint, model, status: "error", durationMs: 0 };

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const rawExt = path.extname(filePath).slice(1) || "ogg";
    // Normalize extensions: Telegram sends .oga (Ogg Opus) which Groq doesn't accept, but .ogg works
    const ext = rawExt === "oga" ? "ogg" : rawExt;
    const mimeMap: Record<string, string> = { ogg: "audio/ogg", mp3: "audio/mpeg", mp4: "audio/mp4", wav: "audio/wav", m4a: "audio/mp4", webm: "audio/webm", opus: "audio/opus" };
    const mimeType = mimeMap[ext] || "audio/ogg";

    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer], { type: mimeType }), `audio.${ext}`);
    formData.append("model", model);
    formData.append("response_format", "json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Authorization": `Bearer ${config.apiKey}` },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const durationMs = Date.now() - startedAt;
    attempt.durationMs = durationMs;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      attempt.errorCode = "api-error";
      attempt.errorMessage = `API returned ${res.status}: ${errBody.slice(0, 200)}`;
      logger.error(`Transcription API error: ${res.status} — ${errBody.slice(0, 200)}`, { status: String(res.status) });
      return fail(filePath, fileSizeBytes, "api-error", attempt.errorMessage, [attempt]);
    }

    const data = await res.json() as { text?: string };
    const text = data.text?.trim() || "";

    if (!text) {
      attempt.errorCode = "api-error";
      attempt.errorMessage = "API returned empty transcription";
      return fail(filePath, fileSizeBytes, "api-error", "Empty transcription result", [attempt]);
    }

    attempt.status = "ok";
    logger.info("Transcription complete", { durationMs: String(durationMs), textLength: String(text.length) });

    return {
      ok: true,
      text,
      filePath,
      fileSizeBytes,
      provider: endpoint,
      fallbackUsed: false,
      attempts: [attempt],
    };
  } catch (err) {
    attempt.durationMs = Date.now() - startedAt;
    const isTimeout = err instanceof Error && err.name === "AbortError";
    attempt.errorCode = isTimeout ? "timeout" : "api-error";
    attempt.errorMessage = err instanceof Error ? err.message : String(err);
    logger.error("Transcription failed", { errorCode: attempt.errorCode, error: attempt.errorMessage });
    return fail(filePath, fileSizeBytes, attempt.errorCode, attempt.errorMessage, [attempt]);
  }
}
