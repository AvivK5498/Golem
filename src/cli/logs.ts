/**
 * `golem logs` — tail the daemon's logs.
 *
 * Detection order:
 *   1. Linux with a `--user` systemd unit named `golem` → journalctl -f
 *   2. macOS with the launchd plist `com.golem.agent` → tail the configured log
 *   3. Fallback: tail the most recent file under <data-dir>/logs/
 *
 * Supports `-f`/`--follow` (default on) and `-n <N>` for line count.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { dataPath } from "../utils/paths.js";

interface LogOptions {
  follow: boolean;
  lines: number;
}

function parseArgs(args: string[]): LogOptions {
  let follow = true;
  let lines = 100;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--no-follow") follow = false;
    else if (a === "-f" || a === "--follow") follow = true;
    else if (a === "-n" || a === "--lines") {
      const n = Number(args[++i]);
      if (Number.isFinite(n) && n > 0) lines = n;
    }
  }
  return { follow, lines };
}

function hasSystemdUnit(): boolean {
  if (process.platform !== "linux") return false;
  const unitPath = path.join(os.homedir(), ".config", "systemd", "user", "golem.service");
  return fs.existsSync(unitPath);
}

function hasLaunchdPlist(): string | null {
  if (process.platform !== "darwin") return null;
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", "com.golem.agent.plist");
  return fs.existsSync(plistPath) ? plistPath : null;
}

function findMostRecentLogFile(): string | null {
  const logsDir = dataPath("logs");
  try {
    const entries = fs
      .readdirSync(logsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".log"))
      .map((e) => path.join(logsDir, e.name))
      .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return entries[0]?.p ?? null;
  } catch {
    return null;
  }
}

function tailJournald(opts: LogOptions): number {
  const args = ["--user", "-u", "golem", "-n", String(opts.lines)];
  if (opts.follow) args.push("-f");
  const child = spawn("journalctl", args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  return -1; // never returns to caller
}

function tailFile(file: string, opts: LogOptions): number {
  const args = ["-n", String(opts.lines)];
  if (opts.follow) args.push("-F"); // -F follows by name across rotations
  args.push(file);
  const child = spawn("tail", args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  return -1;
}

export async function run(args: string[]): Promise<number> {
  const opts = parseArgs(args);

  if (hasSystemdUnit()) {
    console.error("# tailing systemd user journal for golem.service");
    return tailJournald(opts);
  }

  const plist = hasLaunchdPlist();
  if (plist) {
    // The plist points at ~/Library/Logs/com.golem.agent.log per CLAUDE.md;
    // not parsed dynamically — fall back to the conventional location.
    const macLog = path.join(os.homedir(), "Library", "Logs", "com.golem.agent.log");
    if (fs.existsSync(macLog)) {
      console.error(`# tailing ${macLog}`);
      return tailFile(macLog, opts);
    }
  }

  const recent = findMostRecentLogFile();
  if (recent) {
    console.error(`# tailing ${recent}`);
    return tailFile(recent, opts);
  }

  console.error("No logs found.");
  console.error(`Checked: systemd user unit, macOS launchd plist, ${dataPath("logs")}/*.log`);
  console.error("If the daemon is running, redirect stdout/stderr or install the daemon with `golem install-daemon`.");
  return 1;
}
