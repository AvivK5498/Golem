/**
 * PID file management for the Golem daemon.
 *
 * Stored at <data-dir>/golem.pid. Written on platform start, removed on
 * graceful shutdown. status/stop subcommands read it to find the running
 * daemon.
 *
 * The file holds two whitespace-separated fields: <pid> <started-at-ms>.
 * That lets `status` report uptime without an extra syscall.
 */
import fs from "node:fs";

import { dataPath } from "../utils/paths.js";

export interface PidRecord {
  pid: number;
  startedAt: number;
}

export function pidFilePath(): string {
  return dataPath("golem.pid");
}

export function writePidFile(record: PidRecord = { pid: process.pid, startedAt: Date.now() }): void {
  fs.writeFileSync(pidFilePath(), `${record.pid} ${record.startedAt}\n`);
}

export function removePidFile(): void {
  try {
    fs.unlinkSync(pidFilePath());
  } catch {
    // already gone — fine
  }
}

export function readPidFile(): PidRecord | null {
  try {
    const raw = fs.readFileSync(pidFilePath(), "utf-8").trim();
    const [pidStr, startedAtStr] = raw.split(/\s+/);
    const pid = Number(pidStr);
    const startedAt = Number(startedAtStr);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return { pid, startedAt: Number.isFinite(startedAt) ? startedAt : 0 };
  } catch {
    return null;
  }
}

/** Returns true if a process with the given pid is currently alive on this system. */
export function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 = existence check; throws ESRCH if dead, EPERM if alive but unowned.
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "EPERM"; // EPERM means it exists; we just can't signal it
  }
}

/**
 * Read the pid file and return the record only if the recorded process is
 * still alive. Removes stale pid files as a side effect.
 */
export function getRunningDaemon(): PidRecord | null {
  const record = readPidFile();
  if (!record) return null;
  if (!isProcessAlive(record.pid)) {
    removePidFile();
    return null;
  }
  return record;
}
