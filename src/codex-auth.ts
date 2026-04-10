#!/usr/bin/env npx tsx
/**
 * Codex OAuth login + credential dump.
 *
 * Usage:
 *   npx tsx src/codex-auth.ts                    # interactive login, saves credentials
 *   npx tsx src/codex-auth.ts --status           # show stored credential status without logging in
 *   npx tsx src/codex-auth.ts --refresh          # force a refresh of the stored credential
 *
 * Credentials are saved to ./data/codex-credentials.json (gitignored).
 * This is a feasibility test — it does not yet integrate with Mastra/agents.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
// Pre-warm node built-ins so pi-ai's lazy dynamic imports of node:crypto/node:http
// have something cached when its module body fires the .then() callbacks. Without
// this, calling loginOpenAICodex() before the next microtask throws a false
// "OpenAI Codex OAuth is only available in Node.js environments" error.
import "node:crypto";
import "node:http";
import { loginOpenAICodex, refreshOpenAICodexToken, type OAuthCredentials } from "@mariozechner/pi-ai/oauth";
import { dataPath } from "./utils/paths.js";

/** Yield long enough for pi-ai's lazy dynamic imports to populate. */
async function waitForPiAi() {
  // Two microtask cycles is enough — pi-ai chains two import().then() calls
  // (node:crypto + node:http). setImmediate yields past the microtask queue.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

const CREDS_PATH = dataPath("codex-credentials.json");

function ensureDataDir() {
  const dir = path.dirname(CREDS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCreds(): OAuthCredentials | null {
  if (!fs.existsSync(CREDS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDS_PATH, "utf-8")) as OAuthCredentials;
  } catch {
    return null;
  }
}

function saveCreds(c: OAuthCredentials) {
  ensureDataDir();
  fs.writeFileSync(CREDS_PATH, JSON.stringify(c, null, 2));
  // Restrict perms — credentials are sensitive
  try { fs.chmodSync(CREDS_PATH, 0o600); } catch { /* best effort */ }
}

function describeCreds(c: OAuthCredentials) {
  const now = Date.now();
  const expiresIn = c.expires - now;
  const expiresInMin = Math.floor(expiresIn / 60_000);
  const status = expiresIn > 0 ? `valid (${expiresInMin}m left)` : `EXPIRED (${Math.abs(expiresInMin)}m ago)`;
  console.log(`  status:     ${status}`);
  console.log(`  expires:    ${new Date(c.expires).toISOString()}`);
  console.log(`  access:     ${c.access ? c.access.slice(0, 16) + "…" : "(missing)"}`);
  console.log(`  refresh:    ${c.refresh ? c.refresh.slice(0, 16) + "…" : "(missing)"}`);
  // Print any extra fields (accountId etc.)
  for (const [k, v] of Object.entries(c)) {
    if (["access", "refresh", "expires"].includes(k)) continue;
    const display = typeof v === "string" && v.length > 24 ? v.slice(0, 16) + "…" : String(v);
    console.log(`  ${k.padEnd(11)}${display}`);
  }
}

// Tiny readline prompt for the manual paste fallback
function readlinePrompt(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message + " ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];

  // Status mode — just inspect what's stored
  if (mode === "--status") {
    const creds = loadCreds();
    if (!creds) {
      console.log(`No stored credentials at ${CREDS_PATH}`);
      console.log(`Run 'npx tsx src/codex-auth.ts' to log in.`);
      process.exit(0);
    }
    console.log(`Stored credentials at ${CREDS_PATH}:`);
    describeCreds(creds);
    process.exit(0);
  }

  // Refresh mode — exchange refresh token for fresh access token
  if (mode === "--refresh") {
    const creds = loadCreds();
    if (!creds?.refresh) {
      console.error("No refresh token stored. Run 'npx tsx src/codex-auth.ts' to log in first.");
      process.exit(1);
    }
    console.log("Refreshing token...");
    try {
      await waitForPiAi();
      const fresh = await refreshOpenAICodexToken(creds.refresh);
      saveCreds(fresh);
      console.log("✓ Refreshed successfully:");
      describeCreds(fresh);
    } catch (err) {
      console.error("✗ Refresh failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
    process.exit(0);
  }

  // Default mode — interactive login flow
  console.log("══════════════════════════════════════════════════════════════");
  console.log("  OpenAI Codex OAuth login (ChatGPT Plus/Pro subscription)");
  console.log("══════════════════════════════════════════════════════════════");
  console.log();

  const existing = loadCreds();
  if (existing) {
    console.log(`Existing credentials found at ${CREDS_PATH}:`);
    describeCreds(existing);
    console.log();
    const overwrite = await readlinePrompt("Overwrite with a fresh login? [y/N]");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Aborted. Existing credentials kept.");
      process.exit(0);
    }
    console.log();
  }

  try {
    await waitForPiAi();
    const creds = await loginOpenAICodex({
      onAuth: ({ url, instructions }) => {
        console.log("┌────────────────────────────────────────────────────────────┐");
        console.log("│  STEP 1 — Open this URL in your browser to authenticate:  │");
        console.log("└────────────────────────────────────────────────────────────┘");
        console.log();
        console.log("  " + url);
        console.log();
        if (instructions) {
          console.log("  " + instructions);
          console.log();
        }
        console.log("  Waiting for callback on http://127.0.0.1:1455 …");
        console.log("  (If the callback fails, you'll be prompted to paste the code)");
        console.log();
      },
      onPrompt: async ({ message }) => {
        return await readlinePrompt(`\n${message}`);
      },
      onProgress: (msg) => {
        console.log(`  [progress] ${msg}`);
      },
      originator: "golem-codex-feasibility",
    });

    saveCreds(creds);
    console.log();
    console.log("══════════════════════════════════════════════════════════════");
    console.log("  ✓ Login successful — credentials saved");
    console.log("══════════════════════════════════════════════════════════════");
    describeCreds(creds);
    console.log();
    console.log("Next: run 'npx tsx src/codex-audit.ts' to test what your");
    console.log("subscription can actually do (list models, send a chat call,");
    console.log("verify tool calling, etc.)");
  } catch (err) {
    console.error();
    console.error("✗ Login failed:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack.split("\n").slice(1, 4).join("\n"));
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
