/**
 * Codex provider — LanguageModelV3 implementation that talks to the
 * ChatGPT/Codex backend via OAuth credentials.
 *
 * Endpoint: https://chatgpt.com/backend-api/codex/responses
 * API shape: OpenAI Responses API (with Codex-specific tool/message conventions)
 * Auth: Bearer JWT from codex-auth-store + chatgpt-account-id header
 *
 * Phase 1 scope:
 *  - doStream: parse Codex SSE → LanguageModelV3StreamPart
 *  - doGenerate: collect the stream into a single result (for non-streaming callers)
 *  - tool calls: round-trip via the function_call/function_call_output items
 *  - reasoning: passthrough; configurable effort
 *
 * Out of scope for Phase 1:
 *  - WebSocket transport (SSE only)
 *  - Quota header capture (Phase 3)
 *  - Auto-failover (Phase 3)
 *  - Image inputs (no current Mastra agent uses them through this path)
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3StreamPart,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3Usage,
  LanguageModelV3Message,
  LanguageModelV3FunctionTool,
  SharedV3Headers,
  SharedV3Warning,
} from "@ai-sdk/provider-v6";
import { getValidAccessToken } from "./codex-auth-store.js";
import { updateCodexQuota } from "../platform/codex-quota-store.js";

const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_RESPONSES_URL = `${CODEX_BASE_URL}/codex/responses`;
const PROVIDER_ID = "codex";

// ── Codex request body shape ────────────────────────────────────────

interface CodexInputContentText {
  type: "input_text" | "output_text";
  text: string;
}
interface CodexInputContentImage {
  type: "input_image";
  /** "auto" | "low" | "high" — controls vision token budget */
  detail: "auto" | "low" | "high";
  /** Data URI: data:<mime>;base64,<base64> */
  image_url: string;
}
type CodexInputContent = CodexInputContentText | CodexInputContentImage;
interface CodexInputMessageItem {
  type: "message";
  role: "user" | "assistant" | "system";
  content: CodexInputContent[];
}
interface CodexInputFunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}
interface CodexInputFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}
type CodexInputItem =
  | CodexInputMessageItem
  | CodexInputFunctionCall
  | CodexInputFunctionCallOutput;

interface CodexFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: unknown;
  strict: boolean;
}

interface CodexRequestBody {
  model: string;
  store: boolean;
  stream: boolean;
  instructions?: string;
  input: CodexInputItem[];
  text?: { verbosity: "low" | "medium" | "high" };
  include?: string[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  parallel_tool_calls?: boolean;
  tools?: CodexFunctionTool[];
  reasoning?: { effort: string; summary?: string };
  temperature?: number;
  prompt_cache_key?: string;
}

// ── Reasoning effort clamping per model ─────────────────────────────
// Some Codex models don't accept "low" — they require "medium" minimum.
// Mirrors pi-ai's clampReasoningEffort but reapplied at our level so
// we can pass our own callers' reasoning preferences through unchanged.
function clampReasoningEffort(modelId: string, effort: string): string {
  // gpt-5.1-codex-mini is medium-only
  if (modelId === "gpt-5.1-codex-mini") return "medium";
  // gpt-5.1-codex-max requires medium minimum
  if (modelId === "gpt-5.1-codex-max" && effort === "low") return "medium";
  // gpt-5.2-codex requires medium minimum
  if (modelId === "gpt-5.2-codex" && effort === "low") return "medium";
  // Codex variants on the gpt-5.2/5.3/5.4 family don't accept "minimal"
  if ((modelId.startsWith("gpt-5.2") || modelId.startsWith("gpt-5.3") || modelId.startsWith("gpt-5.4")) && effort === "minimal") {
    return "low";
  }
  return effort;
}

// ── Message conversion: AI SDK → Codex ──────────────────────────────

/**
 * Convert a Vercel AI SDK file part to a Codex `input_image` content item.
 * Handles all three data shapes the AI SDK may pass:
 *   - Uint8Array  → base64-encoded data URI
 *   - string      → assumed already base64 (or already a data URI), wrapped if needed
 *   - URL         → stringified and passed through (Codex accepts URLs)
 *
 * Defensively reads BOTH `mediaType` (V3 / AIV6 spec) and `mimeType` (V2 /
 * AIV5 spec) because Mastra's prompt-conversion pipeline can deliver either
 * shape to a V3 provider depending on which adapter ran upstream.
 *
 * Returns null when the part isn't an image (Codex doesn't accept other file
 * types on the gpt-5.x family — non-image files are silently dropped).
 *
 * NOTE: this is a SECONDARY defense. The primary image-input path on
 * production Codex is the providerOptions.codex.inlineImageDataUri backchannel
 * set by agent-runner.ts. See buildRequestBody for details.
 */
function filePartToCodexImage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  part: any,
): CodexInputContentImage | null {
  // Try both field names — V3/AIV6 uses mediaType, V2/AIV5 uses mimeType
  const mediaType: string | undefined = part?.mediaType ?? part?.mimeType;
  if (!mediaType || !mediaType.startsWith("image/")) return null;

  // Try both data fields — V5 uses `data`, the older AIV4 image-part shape
  // uses `image` (from `{ type: "image", image: <Uint8Array|string|URL> }`)
  const data = part?.data ?? part?.image;
  let imageUrl: string;

  if (data instanceof Uint8Array) {
    const b64 = Buffer.from(data).toString("base64");
    imageUrl = `data:${mediaType};base64,${b64}`;
  } else if (typeof data === "string") {
    // Already a data URI? Pass through. Otherwise wrap as base64.
    imageUrl = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
  } else if (data instanceof URL) {
    imageUrl = data.toString();
  } else if (data && typeof data === "object" && "href" in data) {
    // Some runtimes (Bun, edge) use a URL-like object
    imageUrl = String((data as { href: string }).href);
  } else {
    return null;
  }

  return { type: "input_image", detail: "auto", image_url: imageUrl };
}

function convertPromptToCodexInput(
  prompt: LanguageModelV3Message[],
): { systemPrompt: string | undefined; input: CodexInputItem[] } {
  // Optional one-line summary of the incoming prompt when GOLEM_DEBUG_CODEX=1
  if (process.env.GOLEM_DEBUG_CODEX === "1") {
    const summary = prompt.map((m) => {
      const role = (m as { role?: string }).role;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (m as any).content;
      if (typeof content === "string") return `${role}:str(${content.length})`;
      if (Array.isArray(content)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const types = content.map((p: any) => p?.type ?? "?").join(",");
        return `${role}:[${types}]`;
      }
      return `${role}:?`;
    }).join(" | ");
    console.log(`[codex-provider] prompt: ${summary}`);
  }

  let systemPrompt: string | undefined;
  const input: CodexInputItem[] = [];

  for (const msg of prompt) {
    if (msg.role === "system") {
      // Codex puts the system prompt at the top level. If multiple system
      // messages are provided, concatenate them.
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${msg.content}` : msg.content;
      continue;
    }

    if (msg.role === "user") {
      // User messages can contain text + file parts. Image files are converted
      // to Codex input_image items; non-image files are silently dropped (Codex
      // doesn't accept them on the gpt-5.x family).
      const content: CodexInputContent[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          content.push({ type: "input_text", text: part.text });
        } else if (part.type === "file") {
          const img = filePartToCodexImage(part);
          if (img) content.push(img);
        }
      }
      if (content.length > 0) {
        input.push({ type: "message", role: "user", content });
      }
      continue;
    }

    if (msg.role === "assistant") {
      // Assistant messages can be text, reasoning, file, tool-call, or
      // tool-result. We split text + tool calls into separate Codex items.
      const textParts: CodexInputContentText[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push({ type: "output_text", text: part.text });
        } else if (part.type === "tool-call") {
          // Emit any accumulated text first to preserve order
          if (textParts.length > 0) {
            input.push({ type: "message", role: "assistant", content: textParts.splice(0) });
          }
          input.push({
            type: "function_call",
            call_id: part.toolCallId,
            name: part.toolName,
            arguments: typeof part.input === "string" ? part.input : JSON.stringify(part.input),
          });
        }
        // Skip reasoning + file parts in Phase 1 — reasoning is server-side anyway
      }
      if (textParts.length > 0) {
        input.push({ type: "message", role: "assistant", content: textParts });
      }
      continue;
    }

    if (msg.role === "tool") {
      // Tool result messages — convert each result part to a function_call_output
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          // The result output shape varies; serialize whatever we got
          let outputText: string;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const output: any = part.output;
          if (typeof output === "string") {
            outputText = output;
          } else if (output && typeof output === "object" && "value" in output) {
            outputText = typeof output.value === "string" ? output.value : JSON.stringify(output.value);
          } else {
            outputText = JSON.stringify(output);
          }
          input.push({
            type: "function_call_output",
            call_id: part.toolCallId,
            output: outputText,
          });
        }
      }
      continue;
    }
  }

  return { systemPrompt, input };
}

function convertToolsToCodex(
  tools: LanguageModelV3CallOptions["tools"] | undefined,
): CodexFunctionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  const out: CodexFunctionTool[] = [];
  for (const tool of tools) {
    if (tool.type !== "function") continue;
    const fn = tool as LanguageModelV3FunctionTool;
    out.push({
      type: "function",
      name: fn.name,
      description: fn.description,
      parameters: fn.inputSchema,
      strict: false, // Codex Responses doesn't always honor strict; keep loose for now
    });
  }
  return out.length > 0 ? out : undefined;
}

function convertToolChoiceToCodex(
  choice: LanguageModelV3CallOptions["toolChoice"] | undefined,
): CodexRequestBody["tool_choice"] {
  if (!choice) return "auto";
  if (choice.type === "auto") return "auto";
  if (choice.type === "none") return "none";
  if (choice.type === "required") return "auto"; // Codex doesn't have required; closest is auto
  if (choice.type === "tool") {
    return { type: "function", function: { name: choice.toolName } };
  }
  return "auto";
}

// ── Build the request body ──────────────────────────────────────────

interface BuildBodyArgs {
  modelId: string;
  callOptions: LanguageModelV3CallOptions;
  stream: boolean;
  /** Per-model default reasoning effort, set by the dispatcher from per-agent settings. */
  defaultReasoningEffort?: CodexReasoningEffort;
}

function buildRequestBody({ modelId, callOptions, stream, defaultReasoningEffort }: BuildBodyArgs): CodexRequestBody {
  const { systemPrompt, input } = convertPromptToCodexInput(callOptions.prompt);
  const tools = convertToolsToCodex(callOptions.tools);

  // Reasoning effort precedence: per-call providerOptions.codex > per-agent default > "low" fallback
  // The result is then clamped per-model — some Codex models require a minimum effort.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const providerOpts: any = callOptions.providerOptions?.codex ?? {};
  const requestedEffort = providerOpts.reasoningEffort ?? defaultReasoningEffort ?? "low";
  const reasoningEffort = clampReasoningEffort(modelId, requestedEffort);
  if (process.env.GOLEM_DEBUG_CODEX === "1") {
    const clamped = reasoningEffort !== requestedEffort ? ` (clamped from ${requestedEffort})` : "";
    console.log(`[codex-provider] reasoning.effort=${reasoningEffort}${clamped} model=${modelId}`);
  }

  // PRODUCTION IMAGE INPUT PATH (load-bearing — do not remove):
  //
  // Mastra's prompt-conversion pipeline produces a V2-format prompt for our
  // V3-spec provider. The V2 file part shape (`mimeType` field) doesn't match
  // what our V3 converter expects (`mediaType` field), so multimodal user
  // messages can be dropped or arrive with empty content depending on the
  // exact CoreMessage shape Mastra received.
  //
  // The agent-runner sets `providerOptions.codex.inlineImageDataUri` whenever
  // a turn carries image data, exactly so this provider can inject the image
  // directly into the Codex Responses API request and bypass Mastra's
  // conversion entirely. THIS is what makes Codex image input work in
  // production today (verified 2026-04-09 via Telegram). Removing the
  // backchannel will break image input on production Codex agents.
  //
  // The standard prompt-conversion path is also defended below with a
  // mimeType→mediaType fallback in filePartToCodexImage, but the backchannel
  // is the primary mechanism. Don't trust the standard path on its own until
  // the upstream Mastra V2/V3 multimodal mismatch is fixed.
  const inlineImageDataUri: string | undefined = providerOpts.inlineImageDataUri;
  const inlineImageText: string = providerOpts.inlineImageText ?? "What do you see in this image?";
  if (inlineImageDataUri) {
    // Check whether the prompt already has a user message we can append to.
    // If not (which is the broken case), synthesize one.
    const lastIdx = input.length - 1;
    const last = lastIdx >= 0 ? input[lastIdx] : null;
    if (last && last.type === "message" && last.role === "user") {
      // Append the image to the existing user message
      last.content.push({ type: "input_image", detail: "auto", image_url: inlineImageDataUri });
    } else {
      // Synthesize a fresh user message — this is the broken case where the
      // user message vanished entirely between the runner and our provider.
      input.push({
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: inlineImageText },
          { type: "input_image", detail: "auto", image_url: inlineImageDataUri },
        ],
      });
    }
  }

  const body: CodexRequestBody = {
    model: modelId,
    store: false,
    stream,
    instructions: systemPrompt,
    input,
    text: { verbosity: providerOpts.textVerbosity ?? "medium" },
    include: ["reasoning.encrypted_content"],
    tool_choice: convertToolChoiceToCodex(callOptions.toolChoice),
    parallel_tool_calls: true,
    reasoning: { effort: reasoningEffort, summary: "auto" },
  };

  if (tools) body.tools = tools;
  // Note: Codex Responses API does NOT accept `temperature`. The model uses
  // its default. Mastra/AI SDK callers may pass it, but we silently drop it
  // here rather than 400. See test verification: 2026-04-09.

  return body;
}

// ── Auth headers ────────────────────────────────────────────────────

async function buildHeaders(): Promise<{ headers: Headers; accountId: string; access: string }> {
  const creds = await getValidAccessToken();
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${creds.access}`);
  headers.set("chatgpt-account-id", creds.accountId);
  headers.set("originator", "golem");
  headers.set("User-Agent", "golem/0.1 (codex provider)");
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");
  return { headers, accountId: creds.accountId, access: creds.access };
}

// ── SSE parser ──────────────────────────────────────────────────────
// Codex sends `data: <json>\n\n` events. We parse them into structured objects.

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Split on \n\n which separates SSE events
      let nlnl: number;
      while ((nlnl = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, nlnl);
        buffer = buffer.slice(nlnl + 2);
        const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const json = dataLine.slice(5).trim();
        if (!json || json === "[DONE]") continue;
        try {
          yield JSON.parse(json);
        } catch {
          // Malformed JSON in an event — ignore and continue
        }
      }
    }
    // Drain any final event without trailing \n\n
    if (buffer.length > 0) {
      const dataLine = buffer.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        const json = dataLine.slice(5).trim();
        if (json && json !== "[DONE]") {
          try { yield JSON.parse(json); } catch { /* noop */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Codex SSE event → AI SDK stream parts ───────────────────────────

interface CodexEventBase {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

interface ConversionState {
  textBlockId: string | null;
  textBlockOpen: boolean;
  toolCallsById: Map<string, { name: string; argsBuffer: string; itemId: string }>;
  finishUsage?: LanguageModelV3Usage;
  finishReason: LanguageModelV3FinishReason["unified"];
  rawFinishReason: string | undefined;
}

function newConversionState(): ConversionState {
  return {
    textBlockId: null,
    textBlockOpen: false,
    toolCallsById: new Map(),
    finishReason: "stop",
    rawFinishReason: undefined,
  };
}

function* handleCodexEvent(
  event: CodexEventBase,
  state: ConversionState,
): Generator<LanguageModelV3StreamPart> {
  const t = event.type;

  // Output text streaming
  if (t === "response.output_item.added" && event.item?.type === "message") {
    const id = String(event.item.id || `text-${Date.now()}`);
    state.textBlockId = id;
    state.textBlockOpen = true;
    yield { type: "text-start", id };
    return;
  }
  if (t === "response.output_text.delta" && typeof event.delta === "string") {
    if (!state.textBlockOpen) {
      const id = state.textBlockId || `text-${Date.now()}`;
      state.textBlockId = id;
      state.textBlockOpen = true;
      yield { type: "text-start", id };
    }
    yield { type: "text-delta", id: state.textBlockId || "text", delta: event.delta };
    return;
  }
  if (t === "response.output_text.done" || t === "response.content_part.done") {
    // Don't close yet — wait for output_item.done so multiple text deltas
    // within a single message item don't prematurely emit text-end.
    return;
  }
  if (t === "response.output_item.done" && event.item?.type === "message") {
    if (state.textBlockOpen) {
      yield { type: "text-end", id: state.textBlockId || "text" };
      state.textBlockOpen = false;
    }
    return;
  }

  // Function call streaming
  if (t === "response.output_item.added" && event.item?.type === "function_call") {
    const callId = String(event.item.call_id || event.item.id);
    const name = String(event.item.name);
    state.toolCallsById.set(callId, { name, argsBuffer: "", itemId: String(event.item.id || callId) });
    yield {
      type: "tool-input-start",
      id: callId,
      toolName: name,
    };
    return;
  }
  if (t === "response.function_call_arguments.delta" && typeof event.delta === "string") {
    // The Codex event sometimes uses item_id, sometimes a different ID. We
    // resolve by matching the most recently added tool call if no exact match.
    const itemId = String(event.item_id || "");
    let entry = [...state.toolCallsById.entries()].find(([, v]) => v.itemId === itemId);
    if (!entry) {
      // Fallback: pick the latest open tool call
      const last = [...state.toolCallsById.entries()].pop();
      if (!last) return;
      entry = last;
    }
    const [callId, info] = entry;
    info.argsBuffer += event.delta;
    yield { type: "tool-input-delta", id: callId, delta: event.delta };
    return;
  }
  if (t === "response.function_call_arguments.done") {
    const itemId = String(event.item_id || "");
    let entry = [...state.toolCallsById.entries()].find(([, v]) => v.itemId === itemId);
    if (!entry) {
      const last = [...state.toolCallsById.entries()].pop();
      if (!last) return;
      entry = last;
    }
    const [callId, info] = entry;
    if (typeof event.arguments === "string" && event.arguments.length > 0) {
      info.argsBuffer = event.arguments;
    }
    yield { type: "tool-input-end", id: callId };
    yield {
      type: "tool-call",
      toolCallId: callId,
      toolName: info.name,
      input: info.argsBuffer,
    };
    return;
  }

  // Reasoning summary deltas — surface as reasoning parts
  if (t === "response.reasoning_summary_part.added") {
    const id = String(event.summary_index ?? "reasoning");
    yield { type: "reasoning-start", id };
    return;
  }
  if (t === "response.reasoning_summary_text.delta" && typeof event.delta === "string") {
    const id = String(event.summary_index ?? "reasoning");
    yield { type: "reasoning-delta", id, delta: event.delta };
    return;
  }
  if (t === "response.reasoning_summary_text.done" || t === "response.reasoning_summary_part.done") {
    const id = String(event.summary_index ?? "reasoning");
    yield { type: "reasoning-end", id };
    return;
  }

  // Final response
  if (t === "response.completed") {
    const usage = event.response?.usage;
    if (usage) {
      state.finishUsage = {
        inputTokens: { total: usage.input_tokens },
        outputTokens: { total: usage.output_tokens },
        totalTokens: usage.total_tokens,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    }
    // Detect tool-calls finish reason
    const items = event.response?.output ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasToolCall = items.some((it: any) => it.type === "function_call");
    state.finishReason = hasToolCall ? "tool-calls" : "stop";
    state.rawFinishReason = String(event.response?.status || "completed");
    return;
  }

  // Errors
  if (t === "response.failed" || t === "error") {
    const errMsg = event.error?.message || event.message || "Codex stream error";
    state.finishReason = "error";
    state.rawFinishReason = "failed";
    yield { type: "error", error: new Error(errMsg) };
    return;
  }
}

// ── doStream / doGenerate implementations ──────────────────────────

async function postCodex(
  body: CodexRequestBody,
  abortSignal: AbortSignal | undefined,
): Promise<{ response: Response; requestHeaders: Headers }> {
  const { headers } = await buildHeaders();
  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: abortSignal,
  });
  // Capture quota headers for the UI meters. Best-effort — never throws.
  // Runs on EVERY response (including non-200s) since rate-limit headers
  // are most informative when you're hitting a 429.
  updateCodexQuota(response.headers);
  return { response, requestHeaders: headers };
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    try {
      const j = JSON.parse(text);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (j as any).error?.message || (j as any).detail || (j as any).message || text;
    } catch {
      return text;
    }
  } catch {
    return response.statusText;
  }
}

function responseHeadersToRecord(h: Headers): SharedV3Headers {
  const out: SharedV3Headers = {};
  for (const [k, v] of h.entries()) out[k] = v;
  return out;
}

// ── The model class ─────────────────────────────────────────────────

/**
 * Default reasoning effort for the model. May be overridden per-call via
 * `callOptions.providerOptions.codex.reasoningEffort`. Set by the dispatcher
 * in src/agent/model.ts from the per-agent setting `llm.reasoningEffort`.
 *
 * Subject to clampReasoningEffort() — some Codex models require a minimum.
 */
export type CodexReasoningEffort = "xhigh" | "high" | "medium" | "low" | "minimal" | "none";

export class CodexLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = PROVIDER_ID;
  readonly modelId: string;
  readonly defaultReasoningEffort: CodexReasoningEffort | undefined;
  /**
   * Declares which URL patterns we can ingest natively without download.
   * MUST include `data:image/...;base64,...` because Mastra/AI SDK consults
   * this map BEFORE delivering the prompt to us — if a content part uses a
   * URL pattern that doesn't match anything here, the SDK tries to download
   * and re-encode it. For data URIs there's nothing to download, so the
   * conversion fails silently and the entire user message is dropped from
   * the prompt before we ever see it.
   *
   * Mirrors the OpenRouter provider's supportedUrls map for consistency.
   */
  readonly supportedUrls: Record<string, RegExp[]> = {
    "image/*": [
      /^data:image\/[a-zA-Z]+;base64,/,
      /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i,
    ],
    "application/*": [/^data:application\//, /^https?:\/\/.+$/],
  };

  constructor(modelId: string, opts?: { defaultReasoningEffort?: CodexReasoningEffort }) {
    this.modelId = modelId;
    this.defaultReasoningEffort = opts?.defaultReasoningEffort;
  }

  async doGenerate(options: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> {
    const body = buildRequestBody({
      modelId: this.modelId,
      callOptions: options,
      stream: true,
      defaultReasoningEffort: this.defaultReasoningEffort,
    });
    const { response } = await postCodex(body, options.abortSignal);

    if (!response.ok) {
      const err = await readErrorBody(response);
      throw new Error(`Codex API ${response.status} ${response.statusText}: ${err}`);
    }
    if (!response.body) {
      throw new Error("Codex returned no response body");
    }

    // Collect the stream into a single result
    const state = newConversionState();
    const textBuffers = new Map<string, string>(); // id → accumulated text
    const toolCalls: Array<{ id: string; name: string; args: string }> = [];
    const reasoningBuffers = new Map<string, string>();

    for await (const event of parseSseStream(response.body)) {
      for (const part of handleCodexEvent(event as CodexEventBase, state)) {
        if (part.type === "text-delta") {
          const id = part.id;
          textBuffers.set(id, (textBuffers.get(id) || "") + part.delta);
        } else if (part.type === "tool-call") {
          toolCalls.push({ id: part.toolCallId, name: part.toolName, args: typeof part.input === "string" ? part.input : JSON.stringify(part.input) });
        } else if (part.type === "reasoning-delta") {
          const id = part.id;
          reasoningBuffers.set(id, (reasoningBuffers.get(id) || "") + part.delta);
        } else if (part.type === "error") {
          throw part.error instanceof Error ? part.error : new Error(String(part.error));
        }
      }
    }

    const content: LanguageModelV3Content[] = [];
    for (const [, text] of reasoningBuffers) {
      if (text.length > 0) content.push({ type: "reasoning", text });
    }
    for (const [, text] of textBuffers) {
      if (text.length > 0) content.push({ type: "text", text });
    }
    for (const tc of toolCalls) {
      content.push({
        type: "tool-call",
        toolCallId: tc.id,
        toolName: tc.name,
        input: tc.args,
      });
    }

    const usage: LanguageModelV3Usage = state.finishUsage ?? ({
      inputTokens: { total: undefined },
      outputTokens: { total: undefined },
      totalTokens: undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const finishReason: LanguageModelV3FinishReason = {
      unified: state.finishReason,
      raw: state.rawFinishReason,
    };

    const warnings: SharedV3Warning[] = [];

    return {
      content,
      finishReason,
      usage,
      warnings,
      response: {
        headers: responseHeadersToRecord(response.headers),
      },
    };
  }

  async doStream(options: LanguageModelV3CallOptions): Promise<LanguageModelV3StreamResult> {
    const body = buildRequestBody({
      modelId: this.modelId,
      callOptions: options,
      stream: true,
      defaultReasoningEffort: this.defaultReasoningEffort,
    });
    const { response } = await postCodex(body, options.abortSignal);

    if (!response.ok) {
      const err = await readErrorBody(response);
      throw new Error(`Codex API ${response.status} ${response.statusText}: ${err}`);
    }
    if (!response.body) {
      throw new Error("Codex returned no response body");
    }

    const state = newConversionState();
    const responseBody = response.body;
    const responseHeaders = responseHeadersToRecord(response.headers);

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        // Emit stream-start with no warnings
        controller.enqueue({ type: "stream-start", warnings: [] });
        try {
          for await (const event of parseSseStream(responseBody)) {
            for (const part of handleCodexEvent(event as CodexEventBase, state)) {
              controller.enqueue(part);
            }
          }
          // Emit terminal finish
          const usage: LanguageModelV3Usage = state.finishUsage ?? ({
            inputTokens: { total: undefined },
            outputTokens: { total: undefined },
            totalTokens: undefined,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any);
          controller.enqueue({
            type: "finish",
            usage,
            finishReason: { unified: state.finishReason, raw: state.rawFinishReason },
          });
          controller.close();
        } catch (err) {
          controller.enqueue({ type: "error", error: err });
          controller.close();
        }
      },
      cancel() {
        // The underlying body is implicitly cancelled by the abort signal
      },
    });

    return { stream, response: { headers: responseHeaders } };
  }
}

/**
 * Factory used by the model dispatcher in src/agent/model.ts.
 * Accepts a model ID without the "codex/" prefix (the dispatcher strips it).
 *
 * The optional `reasoningEffort` is the per-agent default — used unless the
 * caller passes a per-call override via `providerOptions.codex.reasoningEffort`.
 * The dispatcher reads it from `agentSettings.getReasoningEffort(agentId)`.
 */
export function createCodexModel(
  modelId: string,
  opts?: { reasoningEffort?: CodexReasoningEffort },
): LanguageModelV3 {
  return new CodexLanguageModel(modelId, { defaultReasoningEffort: opts?.reasoningEffort });
}
