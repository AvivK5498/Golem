/**
 * `golem doctor` — diagnostic health checks.
 *
 * Stub: dispatch wiring lives here; the actual checks (Node version, write
 * access, OpenRouter key validity, Telegram bot tokens via getMe, daemon
 * status, disk space) are bd 49x which builds on this scaffold.
 */
import fs from "node:fs";

import { describeDataDirResolution } from "../utils/paths.js";
import { getRunningDaemon } from "./pid.js";

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

function checkNodeVersion(): Check {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) return { name: "Node version", status: "ok", detail: `${process.versions.node}` };
  return {
    name: "Node version",
    status: "fail",
    detail: `${process.versions.node} (need >= 20)`,
  };
}

function checkDataDir(): Check {
  const r = describeDataDirResolution();
  try {
    fs.accessSync(r.path, fs.constants.W_OK);
    return { name: "Data dir writable", status: "ok", detail: `${r.path} (${r.source})` };
  } catch {
    return { name: "Data dir writable", status: "fail", detail: `${r.path} — not writable` };
  }
}

function checkDaemon(): Check {
  const record = getRunningDaemon();
  if (record) return { name: "Daemon running", status: "ok", detail: `pid ${record.pid}` };
  return { name: "Daemon running", status: "warn", detail: "not running (use `golem start`)" };
}

function renderCheck(c: Check): string {
  const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✗";
  return `  ${icon} ${c.name.padEnd(22)} ${c.detail}`;
}

export async function run(_args: string[]): Promise<number> {
  console.log("Golem doctor — running health checks");
  console.log("");

  const checks: Check[] = [checkNodeVersion(), checkDataDir(), checkDaemon()];
  let exit = 0;
  for (const c of checks) {
    console.log(renderCheck(c));
    if (c.status === "fail") exit = 1;
  }

  console.log("");
  console.log("Additional checks (OpenRouter key, Telegram tokens, disk space) come with bd 49x.");
  return exit;
}
