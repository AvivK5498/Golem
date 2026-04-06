import { spawn } from "node:child_process";

/** Why the process ended */
export type TerminationReason =
  | "exit"              // Process exited normally (code 0 or non-zero)
  | "signal"            // Process killed by an external signal
  | "overall-timeout"   // Hard time cap exceeded
  | "no-output-timeout" // No stdout/stderr for too long (hung process)
  | "error";            // spawn() itself failed (e.g., command not found)

export interface SpawnWatchdogOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Hard overall timeout in ms (default: 900_000 = 15 min) */
  overallTimeoutMs?: number;
  /** No-output watchdog timeout in ms (default: 600_000 = 10 min) */
  noOutputTimeoutMs?: number;
  /** Maximum output buffer size in bytes (default: 50_000) */
  maxOutputBytes?: number;
  /** Called with each stdout chunk for real-time processing */
  onData?: (chunk: Buffer) => void;
}

export interface SpawnWatchdogResult {
  output: string;
  exitCode: number | null;
  reason: TerminationReason;
}

const KILL_GRACE_MS = 3_000;

export function spawnWithWatchdog(opts: SpawnWatchdogOptions): Promise<SpawnWatchdogResult> {
  return new Promise((resolve) => {
    const {
      command,
      args,
      cwd,
      env = { ...process.env },
      overallTimeoutMs = 900_000,
      noOutputTimeoutMs = 600_000,
      maxOutputBytes = 50_000,
    } = opts;

    let resolved = false;
    let reason: TerminationReason = "exit";
    const outputChunks: Buffer[] = [];
    let totalBytes = 0;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    console.log(`[coding] spawning: ${command} ${args.join(" ").slice(0, 120)}...`);
    console.log(`[coding] cwd: ${cwd}, overallTimeout: ${overallTimeoutMs / 1000}s, noOutputTimeout: ${noOutputTimeoutMs / 1000}s`);

    // Spawn with new process group for tree kill
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    console.log(`[coding] spawned pid=${child.pid}`);

    function appendOutput(chunk: Buffer): void {
      if (totalBytes >= maxOutputBytes) return;
      const remaining = maxOutputBytes - totalBytes;
      const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      outputChunks.push(slice);
      totalBytes += slice.length;
    }

    function getOutput(): string {
      const raw = Buffer.concat(outputChunks).toString("utf-8");
      if (totalBytes >= maxOutputBytes) {
        return raw + "\n...[output truncated]";
      }
      return raw;
    }

    function killTree(): void {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        // Process may already be dead
      }
      forceKillTimer = setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already dead */ }
      }, KILL_GRACE_MS);
    }

    function finish(exitCode: number | null): void {
      if (resolved) return;
      resolved = true;
      clearTimeout(overallTimer);
      clearTimeout(watchdogTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ output: getOutput(), exitCode, reason });
    }

    // Overall timeout
    const overallTimer = setTimeout(() => {
      reason = "overall-timeout";
      killTree();
    }, overallTimeoutMs);

    // No-output watchdog
    let watchdogTimer = setTimeout(() => {
      reason = "no-output-timeout";
      killTree();
    }, noOutputTimeoutMs);

    function resetWatchdog(): void {
      clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        reason = "no-output-timeout";
        killTree();
      }, noOutputTimeoutMs);
    }

    // Stream handlers — each chunk resets the watchdog
    child.stdout?.on("data", (chunk: Buffer) => {
      if (totalBytes === 0) console.log(`[coding] first stdout received`);
      appendOutput(chunk);
      resetWatchdog();
      if (opts.onData) opts.onData(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      console.log(`[coding] stderr: ${chunk.toString("utf-8").trim().slice(0, 200)}`);
      appendOutput(chunk);
      resetWatchdog();
    });

    // close fires after all stdio streams are done (safer than exit)
    child.on("close", (code, signal) => {
      console.log(`[coding] closed code=${code} signal=${signal} reason=${reason} output=${totalBytes}bytes`);
      if (reason === "exit" && signal) {
        reason = "signal";
      }
      finish(code);
    });

    child.on("error", (err) => {
      console.log(`[coding] spawn error: ${err.message}`);
      reason = "error";
      appendOutput(Buffer.from(err.message));
      finish(null);
    });
  });
}
