import { describeDataDirResolution } from "../utils/paths.js";
import { getRunningDaemon } from "./pid.js";

function formatUptime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export async function run(_args: string[]): Promise<number> {
  const dataDir = describeDataDirResolution();
  console.log(`data dir: ${dataDir.path}  (${dataDir.source})`);

  const record = getRunningDaemon();
  if (!record) {
    console.log("status:   not running");
    return 3; // LSB convention: 3 = program not running
  }
  const uptime = record.startedAt > 0 ? formatUptime(Date.now() - record.startedAt) : "unknown";
  console.log(`status:   running (pid ${record.pid}, up ${uptime})`);
  return 0;
}
