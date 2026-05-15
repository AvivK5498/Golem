/**
 * `golem install-daemon` / `uninstall-daemon` on Linux — manages a user-level
 * systemd unit at ~/.config/systemd/user/golem.service.
 *
 * User-level only (no system-wide install). This keeps the personal-tool
 * model intact and avoids sudo. On VPS providers the user typically needs to
 * `loginctl enable-linger` so the unit keeps running after logout — we
 * detect and remind, but don't enable it ourselves (requires sudo).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDataDir } from "../../utils/paths.js";
import { renderSystemdUnit } from "./unit-renderers.js";

const UNIT_NAME = "golem.service";

function unitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", UNIT_NAME);
}

function runSystemctl(...args: string[]): { ok: boolean; output: string } {
  const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf-8" });
  return { ok: r.status === 0, output: (r.stdout || "") + (r.stderr || "") };
}

function lingerEnabled(): boolean {
  const user = os.userInfo().username;
  const r = spawnSync("loginctl", ["show-user", user, "-p", "Linger"], { encoding: "utf-8" });
  return /Linger=yes/i.test(r.stdout || "");
}

interface InstallOptions {
  dryRun: boolean;
  force: boolean;
  golemBinary: string;
}

export async function install(opts: InstallOptions): Promise<number> {
  const target = unitPath();
  const dataDir = getDataDir();
  const unit = renderSystemdUnit({
    golemBinary: opts.golemBinary,
    homeDir: os.homedir(),
    dataDir,
  });

  if (fs.existsSync(target) && !opts.force) {
    const existing = fs.readFileSync(target, "utf-8");
    if (existing === unit) {
      console.log(`Unit already installed and up to date at ${target}.`);
    } else {
      console.error(`A different golem.service exists at ${target}.`);
      console.error("Re-run with --force to overwrite, or remove it manually first.");
      return 1;
    }
  } else {
    if (opts.dryRun) {
      console.log("--- would write to", target, "---");
      console.log(unit);
      return 0;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, unit);
    console.log(`Wrote ${target}`);
  }

  if (opts.dryRun) {
    console.log("--- would run: systemctl --user daemon-reload && enable --now golem.service ---");
    return 0;
  }

  console.log("Reloading systemd...");
  let r = runSystemctl("daemon-reload");
  if (!r.ok) {
    console.error(r.output);
    return 1;
  }
  r = runSystemctl("enable", "--now", UNIT_NAME);
  if (!r.ok) {
    console.error(r.output);
    return 1;
  }

  console.log("");
  console.log("Golem is installed and running.");
  console.log("  Status: systemctl --user status golem");
  console.log("  Logs:   journalctl --user -u golem -f");
  console.log("");

  if (!lingerEnabled()) {
    console.log("Heads up: linger is NOT enabled for your user.");
    console.log("On most VPSes, systemd kills user services when you log out.");
    console.log("To keep golem running across logouts, run (once, requires sudo):");
    console.log("");
    console.log("    sudo loginctl enable-linger $USER");
    console.log("");
  }

  return 0;
}

interface UninstallOptions {
  dryRun: boolean;
}

export async function uninstall(opts: UninstallOptions): Promise<number> {
  const target = unitPath();
  if (!fs.existsSync(target)) {
    console.log(`No unit at ${target} — nothing to uninstall.`);
    return 0;
  }

  if (opts.dryRun) {
    console.log("--- would run: systemctl --user disable --now golem.service && rm", target, "---");
    return 0;
  }

  console.log("Stopping and disabling golem.service...");
  runSystemctl("disable", "--now", UNIT_NAME); // tolerate failure: unit may already be down
  fs.unlinkSync(target);
  runSystemctl("daemon-reload");
  console.log(`Removed ${target}.`);
  return 0;
}
