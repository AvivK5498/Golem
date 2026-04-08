import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import type { CodingRuntime, CodingResult, ProgressCallback } from "./runtime.js";
import { spawnWithWatchdog, type TerminationReason } from "./spawn-watchdog.js";

const execFile = promisify(execFileCb);

const DEFAULT_OVERALL_TIMEOUT = 900_000;   // 15 minutes
const DEFAULT_NO_OUTPUT_TIMEOUT = 600_000; // 10 minutes
const MAX_OUTPUT = 50_000;                 // 50KB

/** Env vars to clear from coding subprocess.
 *  ANTHROPIC_API_KEY is cleared so Claude CLI uses OAuth (interactive login) instead of
 *  the API key injected by the parent Claude Code process.
 *  CLAUDE_CODE_OAUTH_TOKEN is kept — it's needed for headless/Docker environments. */
const CLEAR_ENV_VARS = ["CLAUDECODE", "CLAUDE_CODE", "CLAUDE_CODE_ENTRYPOINT", "ANTHROPIC_API_KEY"];

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of CLEAR_ENV_VARS) {
    delete env[key];
  }
  return env;
}

function failurePrefix(reason: TerminationReason, overallMs: number, noOutputMs: number): string {
  switch (reason) {
    case "overall-timeout":
      return `Overall timeout after ${overallMs / 1000}s`;
    case "no-output-timeout":
      return `No output for ${noOutputMs / 1000}s — process appeared hung`;
    case "signal":
      return "Process killed by signal";
    case "error":
      return "Process failed to start";
    default:
      return "Process failed";
  }
}

/** Extract the final result text from Claude's stream-json NDJSON output. */
function extractStreamResult(raw: string): string {
  const lines = raw.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "result" && event.result) {
        return typeof event.result === "string" ? event.result : JSON.stringify(event.result);
      }
    } catch {
      // not valid JSON, skip
    }
  }
  return raw.slice(-MAX_OUTPUT);
}

interface StreamParser {
  /** Feed stdout chunks to the parser */
  onChunk: (chunk: Buffer) => void;
  /** Get condensed tool activity log */
  getToolLog: () => string[];
}

/** Parse stream-json chunks, collect tool activity, and call onProgress. */
function createStreamParser(onProgress?: ProgressCallback): StreamParser {
  let lineBuf = "";
  let toolCount = 0;
  const start = Date.now();
  const toolLog: string[] = [];

  const onChunk = (chunk: Buffer) => {
    lineBuf += chunk.toString("utf-8");
    const lines = lineBuf.split("\n");
    lineBuf = lines.pop() || ""; // keep incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type !== "assistant" || !event.message?.content) continue;
        for (const block of event.message.content) {
          if (block.type === "tool_use") {
            toolCount++;
            const elapsed = Math.round((Date.now() - start) / 1000);
            const inputPreview = JSON.stringify(block.input).slice(0, 120);
            const entry = `[${elapsed}s] #${toolCount} ${block.name}(${inputPreview})`;
            toolLog.push(entry);
            if (onProgress) onProgress(entry);
          }
        }
      } catch {
        // incomplete JSON, skip
      }
    }
  };

  return { onChunk, getToolLog: () => toolLog };
}

export class ClaudeBackend implements CodingRuntime {
  readonly name = "claude";

  async execute(task: string, cwd: string, onProgress?: ProgressCallback, model?: string): Promise<CodingResult> {
    const start = Date.now();
    console.log(`[coding] ClaudeBackend.execute: model=${model || "default"}, cwd=${cwd}, task=${task.slice(0, 100)}`);
    const prompt =
      `Working directory: ${cwd}\n` +
      `All files MUST be created inside this directory. Never write to ~, /tmp, or /root.\n\n` +
      `${task}\n\n` +
      `When done, end with a brief structured summary:\n` +
      `Status: success or failure\n` +
      `Changes:\n- what you did (1-3 bullets)\n` +
      `Files: list of files created or modified`;
    const parser = createStreamParser(onProgress);
    const args = ["-p", prompt, "--dangerously-skip-permissions", "--output-format", "stream-json", "--verbose"];
    if (model) args.push("--model", model);
    const result = await spawnWithWatchdog({
      command: "claude",
      args,
      cwd,
      env: cleanEnv(),
      overallTimeoutMs: DEFAULT_OVERALL_TIMEOUT,
      noOutputTimeoutMs: DEFAULT_NO_OUTPUT_TIMEOUT,
      maxOutputBytes: 512_000, // stream-json is verbose; allow more buffer for parsing
      onData: parser.onChunk,
    });

    const durationMs = Date.now() - start;
    const success = result.reason === "exit" && result.exitCode === 0;
    let output = extractStreamResult(result.output) || "(completed)";

    if (!success) {
      console.error(`[coding] ClaudeBackend failed: reason=${result.reason}, exitCode=${result.exitCode}, output=${result.output.slice(0, 300)}`);
    } else {
      console.log(`[coding] ClaudeBackend success: duration=${Math.round(durationMs / 1000)}s`);
    }

    if (!success && result.reason !== "exit") {
      output = `${failurePrefix(result.reason, DEFAULT_OVERALL_TIMEOUT, DEFAULT_NO_OUTPUT_TIMEOUT)}\n${output}`;
    }

    // Append condensed tool activity log so the calling agent has visibility
    const toolLog = parser.getToolLog();
    if (toolLog.length > 0) {
      output += `\n\n--- Tool Activity (${toolLog.length} calls) ---\n${toolLog.join("\n")}`;
    }

    return { success, output, durationMs, agent: "claude" };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execFile("which", ["claude"], { timeout: 5000 });
      console.log(`[coding] claude binary found: ${stdout.trim()}`);
      return true;
    } catch (err) {
      console.error("[coding] claude binary not found:", err instanceof Error ? err.message : String(err));
      return false;
    }
  }
}

export function createBackend(name: string): CodingRuntime {
  console.log(`[coding] createBackend: ${name}`);
  if (name !== "claude") {
    throw new Error(`Unknown coding agent: ${name}. Only "claude" is supported.`);
  }
  return new ClaudeBackend();
}
