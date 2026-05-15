/**
 * `golem stop` — signal the running daemon to shut down gracefully.
 *
 * Sends SIGTERM, polls the pid for up to ~10s, escalates to SIGKILL on timeout.
 */
import { getRunningDaemon, isProcessAlive, removePidFile } from "./pid.js";

const GRACE_MS = 10_000;
const POLL_MS = 200;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function run(_args: string[]): Promise<number> {
  const record = getRunningDaemon();
  if (!record) {
    console.log("golem is not running.");
    return 0;
  }

  console.log(`Stopping golem (pid ${record.pid})...`);
  try {
    process.kill(record.pid, "SIGTERM");
  } catch (err) {
    console.error(`Failed to signal pid ${record.pid}:`, (err as Error).message);
    return 1;
  }

  const deadline = Date.now() + GRACE_MS;
  while (Date.now() < deadline) {
    if (!isProcessAlive(record.pid)) {
      removePidFile();
      console.log("Stopped.");
      return 0;
    }
    await sleep(POLL_MS);
  }

  console.warn(`pid ${record.pid} did not exit within ${GRACE_MS / 1000}s — sending SIGKILL.`);
  try {
    process.kill(record.pid, "SIGKILL");
  } catch {
    // race: process exited between checks
  }
  removePidFile();
  return 0;
}
