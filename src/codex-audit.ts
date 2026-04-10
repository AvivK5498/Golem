#!/usr/bin/env npx tsx
/**
 * Codex API audit — uses the OAuth credentials saved by codex-auth.ts to
 * exercise the ChatGPT/Codex backend and report what's actually possible.
 *
 * Tests run in order:
 *   1. Token sanity            — decode JWT, show claims, verify accountId
 *   2. Plain chat completion   — single text prompt → text response
 *   3. Tool-calling round-trip — model receives a fake tool, picks it, returns args
 *   4. Header inspection       — print every response header so we can see
 *                                rate limits, quotas, billing markers, etc.
 *   5. Model switching         — try several model IDs to see which the
 *                                account can actually access
 *
 * Tests intentionally avoid pi-ai's stream layer so we see raw HTTP behavior
 * (status, headers, error bodies). The wire format mirrors what pi-ai sends.
 *
 * Usage:
 *   npx tsx src/codex-audit.ts                       # run all audits
 *   npx tsx src/codex-audit.ts --model gpt-5.4-mini  # only test a specific model
 *   npx tsx src/codex-audit.ts --headers-only        # quick header inspection
 */
import "dotenv/config";
import fs from "node:fs";
import { dataPath } from "./utils/paths.js";

const CREDS_PATH = dataPath("codex-credentials.json");
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_RESPONSES_URL = `${CODEX_BASE_URL}/codex/responses`;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

interface Credentials {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

// ── Utilities ──────────────────────────────────────────────

function loadCreds(): Credentials {
  if (!fs.existsSync(CREDS_PATH)) {
    console.error(`No credentials at ${CREDS_PATH}.`);
    console.error("Run 'npx tsx src/codex-auth.ts' first.");
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(CREDS_PATH, "utf-8")) as Credentials;
  if (c.expires < Date.now()) {
    console.error(`Stored access token expired ${Math.floor((Date.now() - c.expires) / 60_000)}m ago.`);
    console.error("Run 'npx tsx src/codex-auth.ts --refresh' to refresh.");
    process.exit(1);
  }
  return c;
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], "base64").toString("utf-8");
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function buildHeaders(creds: Credentials): Headers {
  const accountId = creds.accountId
    || (decodeJwt(creds.access) as Record<string, Record<string, string>>)?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
  if (!accountId) throw new Error("Could not extract accountId from JWT");
  const h = new Headers();
  h.set("Authorization", `Bearer ${creds.access}`);
  h.set("chatgpt-account-id", String(accountId));
  h.set("originator", "golem-feasibility");
  h.set("User-Agent", "golem-feasibility (audit)");
  h.set("OpenAI-Beta", "responses=experimental");
  h.set("accept", "text/event-stream");
  h.set("content-type", "application/json");
  h.set("session_id", `audit-${Date.now()}`);
  return h;
}

interface CodexRequestBody {
  model: string;
  store: boolean;
  stream: boolean;
  instructions?: string;
  input: Array<{ role: "user" | "assistant" | "system"; content: Array<{ type: string; text?: string }> }>;
  text?: { verbosity: "low" | "medium" | "high" };
  include?: string[];
  tool_choice?: "auto" | "none" | { type: "function"; function: { name: string } };
  parallel_tool_calls?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: any[];
  reasoning?: { effort: string; summary?: string };
  temperature?: number;
}

function buildBody(model: string, prompt: string, opts: { tools?: unknown[]; instructions?: string } = {}): CodexRequestBody {
  return {
    model,
    store: false,
    stream: true,
    instructions: opts.instructions || "You are a brief, helpful assistant. Answer in one short sentence.",
    input: [
      { role: "user", content: [{ type: "input_text", text: prompt }] },
    ],
    text: { verbosity: "low" },
    include: ["reasoning.encrypted_content"],
    tool_choice: "auto",
    parallel_tool_calls: true,
    ...(opts.tools && { tools: opts.tools }),
    reasoning: { effort: "low", summary: "auto" },
  };
}

interface RawResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyChunks: string[];
  rawText: string;
}

async function postCodex(model: string, body: CodexRequestBody, creds: Credentials): Promise<RawResponse> {
  const headers = buildHeaders(creds);
  const res = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  // Capture all headers — this is half the point of the audit
  const headersOut: Record<string, string> = {};
  for (const [k, v] of res.headers.entries()) headersOut[k] = v;

  // Read the entire body. SSE comes as text chunks separated by \n\n.
  const rawText = await res.text();
  const bodyChunks = rawText.split("\n\n").filter(c => c.trim().length > 0);

  return { status: res.status, statusText: res.statusText, headers: headersOut, bodyChunks, rawText };
}

// ── Test 1: Token sanity ──────────────────────────────────

function testTokenSanity(creds: Credentials) {
  console.log("\n══════ TEST 1: Token sanity ══════");
  const claims = decodeJwt(creds.access);
  if (!claims) {
    console.log("  ✗ Could not decode JWT");
    return;
  }
  console.log("  JWT claims (top level):");
  for (const [k, v] of Object.entries(claims)) {
    if (k === JWT_CLAIM_PATH) continue;
    const display = typeof v === "string" && v.length > 60 ? v.slice(0, 56) + "…" : JSON.stringify(v);
    console.log(`    ${k}: ${display}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = (claims as Record<string, any>)[JWT_CLAIM_PATH];
  if (auth) {
    console.log("  Auth scope claims:");
    for (const [k, v] of Object.entries(auth)) {
      const display = typeof v === "string" && v.length > 60 ? v.slice(0, 56) + "…" : JSON.stringify(v);
      console.log(`    ${k}: ${display}`);
    }
  }
}

// ── Test 2: Plain chat completion ──────────────────────────

async function testPlainChat(model: string, creds: Credentials) {
  console.log(`\n══════ TEST 2: Plain chat (${model}) ══════`);
  const body = buildBody(model, "What's 17 times 23? One number, no explanation.");
  const res = await postCodex(model, body, creds);
  console.log(`  HTTP ${res.status} ${res.statusText}`);
  if (res.status !== 200) {
    console.log(`  body: ${res.rawText.slice(0, 800)}`);
    return false;
  }
  // Parse SSE for the actual text response
  const completedEvents = res.bodyChunks
    .map(chunk => {
      const dataLine = chunk.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) return null;
      try { return JSON.parse(dataLine.slice(5).trim()); } catch { return null; }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e): e is any => e !== null);

  // Find the text output
  const types = new Set(completedEvents.map(e => e.type));
  console.log(`  events received: ${completedEvents.length}, distinct types: ${[...types].join(", ")}`);

  const textParts: string[] = [];
  for (const e of completedEvents) {
    if (e.type === "response.output_text.delta" && typeof e.delta === "string") textParts.push(e.delta);
    if (e.type === "response.completed") {
      const usage = e.response?.usage;
      if (usage) console.log(`  usage: input=${usage.input_tokens} output=${usage.output_tokens} total=${usage.total_tokens}`);
    }
  }
  const reply = textParts.join("");
  console.log(`  reply: "${reply.trim()}"`);
  return true;
}

// ── Test 3: Tool calling ───────────────────────────────────

async function testToolCalling(model: string, creds: Credentials) {
  console.log(`\n══════ TEST 3: Tool calling (${model}) ══════`);
  const tools = [
    {
      type: "function",
      name: "get_weather",
      description: "Get the current weather for a city",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name, e.g. 'San Francisco'" },
          units: { type: "string", enum: ["celsius", "fahrenheit"], description: "Temperature unit" },
        },
        required: ["city"],
      },
      strict: false,
    },
  ];
  const body = buildBody(model, "What's the weather in Tel Aviv right now?", { tools });
  const res = await postCodex(model, body, creds);
  console.log(`  HTTP ${res.status} ${res.statusText}`);
  if (res.status !== 200) {
    console.log(`  body: ${res.rawText.slice(0, 800)}`);
    return false;
  }
  // Parse SSE for tool calls
  const events = res.bodyChunks
    .map(chunk => {
      const dataLine = chunk.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) return null;
      try { return JSON.parse(dataLine.slice(5).trim()); } catch { return null; }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e): e is any => e !== null);

  const types = new Set(events.map(e => e.type));
  console.log(`  events received: ${events.length}, distinct types: ${[...types].join(", ")}`);

  // Look for function call output items
  for (const e of events) {
    if (e.type === "response.output_item.added" && e.item?.type === "function_call") {
      console.log(`  ✓ Tool call detected: ${e.item.name}`);
    }
    if (e.type === "response.function_call_arguments.done") {
      console.log(`  ✓ Function args: ${e.arguments}`);
    }
    if (e.type === "response.completed") {
      const items = e.response?.output || [];
      for (const item of items) {
        if (item.type === "function_call") {
          console.log(`  ✓ Final function_call: name=${item.name} args=${item.arguments}`);
        }
      }
    }
  }
  return true;
}

// ── Test 4: Header inspection ──────────────────────────────

async function testHeaders(model: string, creds: Credentials) {
  console.log(`\n══════ TEST 4: Response headers (${model}) ══════`);
  const body = buildBody(model, "say hi");
  const res = await postCodex(model, body, creds);
  console.log(`  HTTP ${res.status}`);
  console.log("  All response headers:");
  for (const [k, v] of Object.entries(res.headers).sort()) {
    console.log(`    ${k}: ${v}`);
  }
}

// ── Test 5: Model switching ────────────────────────────────

const PI_AI_KNOWN_MODELS = [
  "gpt-5.4-mini",
  "gpt-5.4",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.1",
];

async function testModelAvailability(creds: Credentials) {
  console.log("\n══════ TEST 5: Model availability ══════");
  for (const model of PI_AI_KNOWN_MODELS) {
    const body = buildBody(model, "ok");
    try {
      const res = await postCodex(model, body, creds);
      const ok = res.status === 200;
      const mark = ok ? "✓" : "✗";
      const detail = ok ? "" : ` — ${extractErrorMessage(res.rawText).slice(0, 120)}`;
      console.log(`  ${mark} ${model.padEnd(22)} HTTP ${res.status}${detail}`);
    } catch (err) {
      console.log(`  ✗ ${model.padEnd(22)} ERROR ${err instanceof Error ? err.message : err}`);
    }
  }
}

function extractErrorMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    return j.error?.message || j.message || body;
  } catch {
    return body;
  }
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const headersOnly = args.includes("--headers-only");
  const modelArg = args.includes("--model") ? args[args.indexOf("--model") + 1] : "gpt-5.4-mini";

  const creds = loadCreds();
  console.log(`Loaded credentials, expires in ${Math.floor((creds.expires - Date.now()) / 60_000)} minutes`);

  testTokenSanity(creds);

  if (headersOnly) {
    await testHeaders(modelArg, creds);
    return;
  }

  await testPlainChat(modelArg, creds);
  await testToolCalling(modelArg, creds);
  await testHeaders(modelArg, creds);
  await testModelAvailability(creds);

  console.log("\n══════ Audit complete ══════");
}

main().catch((err) => {
  console.error("\nFatal:", err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split("\n").slice(1, 5).join("\n"));
  }
  process.exit(1);
});
