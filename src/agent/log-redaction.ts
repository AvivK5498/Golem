/**
 * Redacts common secret patterns from log text.
 * Keeps enough structure for debugging while removing credential material.
 */
export function redactSecretsInText(text: string): string {
  let redacted = text;

  // Authorization headers (e.g. "Authorization: Bearer sk-...")
  redacted = redacted.replace(
    /(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi,
    "$1[REDACTED]",
  );

  // OpenRouter, OpenAI, and similar API key formats
  redacted = redacted.replace(/\bsk-or-v1-[A-Za-z0-9_-]+\b/g, "[REDACTED]");
  redacted = redacted.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]");
  // Generic key/value pairs in JSON or text:
  // api_key: "...", token=..., secret=...
  redacted = redacted.replace(
    /((?:api[_-]?key|token|secret|password)\s*["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
    "$1[REDACTED]",
  );

  return redacted;
}

/**
 * Convert unknown values to compact, secret-safe log text.
 */
export function toSafeLogString(value: unknown, _maxChars = 0): string {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }

  return redactSecretsInText(text);
}
