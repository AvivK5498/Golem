/**
 * `golem doctor` — diagnostic health checks.
 *
 * Highest-leverage subcommand for hesitating-user trust: the single command
 * that answers "is this thing actually wired up correctly on this machine?"
 *
 * Checks (each independent, run concurrently where possible):
 *   - Node version (>=20)
 *   - Data dir writable
 *   - Disk space (warn <1GB, fail <100MB)
 *   - OpenRouter key set and accepted by /api/v1/key
 *   - Each agent's Telegram bot token via getMe (reads agents.db readonly)
 *   - Daemon running (via PID file)
 *   - Logs directory present and readable
 *
 * Exit codes: 0 = all green or warnings only; 1 = at least one fail.
 *
 * ffmpeg is NOT checked — Whisper API accepts Telegram OGG directly.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";

import { dataPath, describeDataDirResolution } from "../utils/paths.js";

// ESM has no global require; synthesize one bound to this module so we can
// lazy-load the optional better-sqlite3 dependency without forcing a top-level
// import (and without making doctor depend on AgentStore's full lifecycle).
const require = createRequire(import.meta.url);
import { validateOpenRouterKey } from "../utils/openrouter-validate.js";
import { validateTelegramToken } from "../utils/telegram-validate.js";
import { getRunningDaemon } from "./pid.js";

interface Check {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

function check(name: string, status: Check["status"], detail: string): Check {
  return { name, status, detail };
}

function checkNodeVersion(): Check {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 20) return check("Node version", "ok", process.versions.node);
  return check("Node version", "fail", `${process.versions.node} (need >= 20)`);
}

function checkDataDir(): Check {
  const r = describeDataDirResolution();
  try {
    fs.accessSync(r.path, fs.constants.W_OK);
    return check("Data dir writable", "ok", `${r.path} (${r.source})`);
  } catch {
    return check("Data dir writable", "fail", `${r.path} — not writable`);
  }
}

async function checkDiskSpace(): Promise<Check> {
  try {
    const stats = await fsp.statfs(describeDataDirResolution().path);
    const freeBytes = stats.bavail * stats.bsize;
    const freeGiB = freeBytes / 1024 ** 3;
    const human = freeGiB >= 1 ? `${freeGiB.toFixed(1)} GiB free` : `${(freeBytes / 1024 ** 2).toFixed(0)} MiB free`;
    if (freeBytes < 100 * 1024 ** 2) return check("Disk space", "fail", `${human} — under 100 MiB threshold`);
    if (freeBytes < 1024 ** 3) return check("Disk space", "warn", `${human} — under 1 GiB`);
    return check("Disk space", "ok", human);
  } catch (err) {
    return check("Disk space", "warn", `couldn't statfs data dir: ${(err as Error).message}`);
  }
}

async function checkOpenRouterKey(): Promise<Check> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return check("OpenRouter key", "fail", "OPENROUTER_API_KEY not set — run setup first");
  const r = await validateOpenRouterKey(key);
  if (r.ok) {
    // Some accounts have no limit set, in which case OpenRouter returns null
    // for limit_remaining. Only format when we actually have a number.
    const detail =
      typeof r.limitRemaining === "number" ? `valid (credit ${r.limitRemaining.toFixed(2)})` : "valid";
    return check("OpenRouter key", "ok", detail);
  }
  return check("OpenRouter key", "fail", r.error);
}

function expandEnvVarsLocal(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name) => process.env[name] ?? "");
}

interface TelegramAgentSummary {
  id: string;
  tokenRef: string;
  resolved: string;
}

function readAgentTelegramTokens(): TelegramAgentSummary[] | null {
  const dbPath = dataPath("agents.db");
  if (!fs.existsSync(dbPath)) return null;

  // Open readonly so a running daemon's writes are unaffected. Using better-sqlite3
  // via createRequire here keeps doctor decoupled from AgentStore's lifecycle
  // (no migration runs, no schema upgrades).
  const Database = require("better-sqlite3") as new (
    p: string,
    o?: { readonly?: boolean; fileMustExist?: boolean },
  ) => { prepare(sql: string): { all(): unknown[] }; close(): void };
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    type Row = { id: string; config_json: string };
    const rows = db.prepare("SELECT id, config_json FROM agents").all() as Row[];
    const out: TelegramAgentSummary[] = [];
    for (const row of rows) {
      try {
        const cfg = JSON.parse(row.config_json) as {
          transport?: { platform?: string; botToken?: string };
        };
        if (cfg.transport?.platform !== "telegram" || !cfg.transport.botToken) continue;
        out.push({
          id: row.id,
          tokenRef: cfg.transport.botToken,
          resolved: expandEnvVarsLocal(cfg.transport.botToken),
        });
      } catch {
        // skip malformed configs; doctor reports failures elsewhere
      }
    }
    return out;
  } finally {
    db.close();
  }
}

async function checkTelegramTokens(): Promise<Check[]> {
  const agents = readAgentTelegramTokens();
  if (agents === null) return [check("Telegram tokens", "warn", "no agents.db yet (run setup)")];
  if (agents.length === 0) return [check("Telegram tokens", "warn", "no Telegram agents configured")];

  const results = await Promise.all(
    agents.map(async (a) => {
      if (!a.resolved) return check(`Telegram: ${a.id}`, "fail", `env var ${a.tokenRef} not resolved`);
      const r = await validateTelegramToken(a.resolved);
      return r.ok
        ? check(`Telegram: ${a.id}`, "ok", `@${r.botUsername}`)
        : check(`Telegram: ${a.id}`, "fail", r.error);
    }),
  );
  return results;
}

function checkDaemon(): Check {
  const record = getRunningDaemon();
  if (record) return check("Daemon running", "ok", `pid ${record.pid}`);
  return check("Daemon running", "warn", "not running (use `golem start`)");
}

function checkLogsDir(): Check {
  const dir = dataPath("logs");
  try {
    const entries = fs.readdirSync(dir);
    return check("Logs dir", "ok", `${dir} (${entries.length} files)`);
  } catch {
    return check("Logs dir", "warn", `${dir} — not present yet (created on first run)`);
  }
}

function renderCheck(c: Check): string {
  const icon = c.status === "ok" ? "✓" : c.status === "warn" ? "!" : "✗";
  return `  ${icon} ${c.name.padEnd(24)} ${c.detail}`;
}

export async function run(_args: string[]): Promise<number> {
  console.log("Golem doctor — running health checks");
  console.log("");

  // Run async checks concurrently; sync ones inline.
  const [diskSpace, openrouter, telegram] = await Promise.all([
    checkDiskSpace(),
    checkOpenRouterKey(),
    checkTelegramTokens(),
  ]);

  const checks: Check[] = [
    checkNodeVersion(),
    checkDataDir(),
    diskSpace,
    openrouter,
    ...telegram,
    checkDaemon(),
    checkLogsDir(),
  ];

  let exit = 0;
  for (const c of checks) {
    console.log(renderCheck(c));
    if (c.status === "fail") exit = 1;
  }
  console.log("");
  console.log(exit === 0 ? "All checks passed." : "Some checks failed — see details above.");
  return exit;
}
