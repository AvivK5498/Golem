import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import path from "node:path";
import os from "node:os";

import { toolError, toolGuidance, TOOL_ERROR_COUNT_KEY } from "./error-tagging.js";

// ---------------------------------------------------------------------------
// Allowlist-based binary security
// ---------------------------------------------------------------------------

/** Read-only binaries always allowed — safe, no side effects */
const ALWAYS_ALLOWED = new Set([
  "grep", "find", "cat", "ls", "wc", "sort",
  "head", "tail", "echo", "date", "pwd", "which", "env",
]);

/** User-configured allowed binaries — loaded from SQLite at startup */
let userAllowedBinaries: Set<string> = new Set();

/** Update the allowed binaries list and refresh tool description (called from platform.ts at startup and when settings change) */
export function setAllowedBinaries(binaries: string[]): void {
  userAllowedBinaries = new Set(binaries);
  // Update the tool description with current binaries list
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (runCommandTool as any).description = getRunCommandDescription();
}

/** Check if a command's binaries are all allowed (used by preprocessCommands) */
export function isCommandAllowed(command: string): { allowed: boolean; blocked?: string } {
  const stripped = command.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  const segments = stripped.split(/[|;&]+/).map(s => s.trim()).filter(Boolean);
  for (const segment of segments) {
    const firstToken = segment.split(/\s+/)[0] || "";
    const bin = firstToken.split("/").pop() || firstToken;
    if (bin && !ALWAYS_ALLOWED.has(bin) && !userAllowedBinaries.has(bin)) {
      return { allowed: false, blocked: bin };
    }
  }
  return { allowed: true };
}

/** Get the current allowed binaries list (for tool description) */
export function getAllowedBinariesList(): string[] {
  return [...userAllowedBinaries];
}

// ---------------------------------------------------------------------------
// Allowed filesystem paths
// ---------------------------------------------------------------------------

const DEFAULT_ALLOWED_PATHS = `${process.cwd()},~/Library/Logs,~/.local/bin,/tmp`;
const ALLOWED_PATHS = (process.env.RUN_COMMAND_ALLOWED_PATHS || DEFAULT_ALLOWED_PATHS)
  .split(",")
  .map(p => p.trim())
  .filter(Boolean)
  .map(p => p.startsWith("~/") ? path.resolve(os.homedir(), p.slice(2)) : path.resolve(p));

const SENSITIVE_PATTERNS = [
  ".ssh", ".gnupg", ".gpg", ".aws", ".azure", ".gcloud", ".kube", ".docker",
  "credentials", ".netrc", ".npmrc", ".pypirc",
  "id_rsa", "id_ed25519", "private_key", ".secret",
  ".env",
];

function findBlockedPath(command: string): string | null {
  const pathRegex = /(?:^|\s)(~\/[^\s;|&"']+|\/[^\s;|&"']+|\.\.\/[^\s;|&"']+)/g;
  let match: RegExpExecArray | null;

  while ((match = pathRegex.exec(command)) !== null) {
    let p = match[1].trim();
    if (p.startsWith("~/")) {
      p = path.resolve(os.homedir(), p.slice(2));
    } else {
      p = path.resolve(p);
    }

    const lower = p.toLowerCase();
    if (SENSITIVE_PATTERNS.some(pat => lower.includes(pat))) {
      return p;
    }

    const isAllowed = ALLOWED_PATHS.some(allowed => p.startsWith(allowed));
    if (!isAllowed) {
      return p;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Per-turn counters
// ---------------------------------------------------------------------------

export const turnRunCommandCounts = new WeakMap<object, number>();
export const turnRunCommandCache = new WeakMap<object, Map<string, string>>();
export const turnRunCommandErrors = new WeakMap<object, number>();
export const MAX_RUN_COMMAND_PER_TURN = 12;
const MAX_CONSECUTIVE_ERRORS = 2;
const OVER_LIMIT_GRACE = 3;
export const MAX_RUN_COMMAND_OUTPUT_CHARS = 8_000;

// ---------------------------------------------------------------------------
// run_command tool
// ---------------------------------------------------------------------------

/** Build the tool description dynamically — called at agent creation time (not module load time) */
export function getRunCommandDescription(): string {
  const allowed = getAllowedBinariesList();
  const binList = allowed.length > 0 ? allowed.join(", ") : "(none configured — add binaries in Settings → Command Security)";
  return "Run a CLI binary on the host machine. " +
    `Allowed binaries: ${binList}. ` +
    "Read-only tools (grep, find, cat, ls, wc, sort, head, tail) are always available. " +
    `File access restricted to: ${ALLOWED_PATHS.map(p => p.replace(os.homedir(), "~")).join(", ")}. ` +
    "Destructive commands (git push, npm install) require owner approval. " +
    `Output truncated at ${MAX_RUN_COMMAND_OUTPUT_CHARS} chars. Max ${MAX_RUN_COMMAND_PER_TURN} calls per turn.`;
}

export const runCommandTool = createTool({
  id: "run_command",
  description: "Run a CLI binary on the host machine. Read-only tools (grep, find, cat, ls, wc, sort, head, tail) are always available.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute."),
    timeout: z.number().optional().default(30000),
    env: z.record(z.string(), z.string()).optional()
      .describe("Extra environment variables as {KEY: VALUE} object"),
  }),
  inputExamples: [
    { input: { command: "git log --oneline -5" } },
    { input: { command: "python3 -c 'print(2+2)'" } },
  ],
  execute: async (input, context) => {
    const env = input.env;
    const fullCommand = input.command;

    // Extract binary names from the command, respecting quoted strings.
    // Split on pipe/semicolon/ampersand only when NOT inside quotes.
    // Strip quoted strings (including escaped quotes inside them) to avoid false positives.
    const stripped = fullCommand.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    const segments = stripped.split(/[|;&]+/).map(s => s.trim()).filter(Boolean);
    for (const segment of segments) {
      const firstToken = segment.split(/\s+/)[0] || "";
      const bin = firstToken.split("/").pop() || firstToken;
      if (bin && !ALWAYS_ALLOWED.has(bin) && !userAllowedBinaries.has(bin)) {
        return toolError(
          `COMMAND FAILED — binary "${bin}" is not in the allowed list. ` +
          `This command was NOT executed. Do NOT report completion to the user. ` +
          `Either try a different approach using an allowed binary, or tell the user that "${bin}" needs to be added in Settings → Command Security.`
        );
      }
    }

    const blockedPath = findBlockedPath(fullCommand);
    if (blockedPath) {
      return toolError(`Access denied: path "${blockedPath}" is outside allowed directories: ${ALLOWED_PATHS.map(p => p.replace(os.homedir(), "~")).join(", ")}`);
    }

    const requestContext = context?.requestContext;
    const signature = `${fullCommand}\u0000${input.timeout ?? 30000}\u0000${env ? JSON.stringify(env) : ""}`;

    if (requestContext) {
      const count = turnRunCommandCounts.get(requestContext) ?? 0;
      if (count >= MAX_RUN_COMMAND_PER_TURN) {
        const overCount = count - MAX_RUN_COMMAND_PER_TURN + 1;
        turnRunCommandCounts.set(requestContext, count + 1);
        if (overCount > OVER_LIMIT_GRACE) {
          return toolError(`run_command called ${overCount} times past its limit. Stop immediately.`);
        }
        return toolGuidance(
          `STOP. You have used all ${MAX_RUN_COMMAND_PER_TURN} commands for this turn. ` +
          `Do NOT call run_command again. Work with the results you already have.`
        );
      }
      turnRunCommandCounts.set(requestContext, count + 1);

      const consecutiveErrors = turnRunCommandErrors.get(requestContext) ?? 0;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        // Slam error counter to 100 so ToolErrorGate fires immediately on the next step
        const rc = requestContext as unknown as { set?(k: never, v: never): void };
        if (rc?.set) {
          rc.set(TOOL_ERROR_COUNT_KEY, 100 as never);
        }
        return toolError(`STOP: ${consecutiveErrors} consecutive command errors. Do NOT call run_command again. Respond to the user with what you have so far.`);
      }

      const isStatefulCommand = fullCommand.startsWith("browse ");
      const cached = !isStatefulCommand ? turnRunCommandCache.get(requestContext) : undefined;
      if (cached?.has(signature)) {
        const cacheHitKey = `__hits:${signature}`;
        const _hits = (turnRunCommandCounts.get(requestContext) ?? 0);
        const cacheHits = cached.get(cacheHitKey);
        const hitCount = cacheHits ? parseInt(cacheHits, 10) + 1 : 1;
        cached.set(cacheHitKey, String(hitCount));
        if (hitCount >= 3) {
          return toolError("You have called the same command multiple times with the same result. Stop polling and respond to the user.");
        }
        return `[cached run_command result]\n${cached.get(signature)}`;
      }
    }

    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    const timeout = Math.max(5000, Math.min(input.timeout ?? 30000, 60000));

    const resolveHome = (v: string) => v.startsWith("~/") ? path.join(process.env.HOME ?? "", v.slice(2)) : v;
    const mergedEnv = env
      ? {
          ...process.env,
          ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, resolveHome(v)])),
        }
      : undefined;

    try {
      const { stdout, stderr } = await execAsync(
        fullCommand,
        {
          timeout,
          maxBuffer: 2 * 1024 * 1024,
          shell: "/bin/bash",
          ...(mergedEnv && { env: mergedEnv }),
        },
      );

      const MAX_OUTPUT = MAX_RUN_COMMAND_OUTPUT_CHARS;
      let result = stdout;
      if (result.length > MAX_OUTPUT) {
        result = result.slice(0, MAX_OUTPUT) + "\n...[truncated]";
      }
      if (stderr?.trim()) {
        result += `\n[stderr]: ${stderr.slice(0, 2000)}`;
      }
      const finalResult = result || "(no output)";

      if (requestContext) {
        const cache = turnRunCommandCache.get(requestContext) ?? new Map<string, string>();
        cache.set(signature, finalResult);
        turnRunCommandCache.set(requestContext, cache);
        turnRunCommandErrors.set(requestContext, 0);
      }

      return finalResult;
    } catch (err: unknown) {
      if (requestContext) {
        const consecutiveErrors = (turnRunCommandErrors.get(requestContext) ?? 0) + 1;
        turnRunCommandErrors.set(requestContext, consecutiveErrors);
      }
      const e = err as { stderr?: string; message?: string };
      const errMsg = e.stderr || e.message;
      return toolError(`Command failed: ${errMsg}`);
    }
  },
});
