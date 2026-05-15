/**
 * `golem install-daemon` / `uninstall-daemon` on macOS — manages a launchd
 * agent at ~/Library/LaunchAgents/com.golem.agent.plist.
 *
 * Migration: existing local-checkout users have a plist pointing at the
 * repo's bin/golem.js. We detect that, refuse to overwrite without --force,
 * and tell the user exactly what'll change.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDataDir } from "../../utils/paths.js";
import { inferPlistOrigin, renderLaunchdPlist } from "./unit-renderers.js";

const LABEL = "com.golem.agent";

function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function gui(): string {
  return `gui/${os.userInfo().uid}`;
}

function launchctl(...args: string[]): { ok: boolean; output: string } {
  const r = spawnSync("launchctl", args, { encoding: "utf-8" });
  return { ok: r.status === 0, output: (r.stdout || "") + (r.stderr || "") };
}

interface InstallOptions {
  dryRun: boolean;
  force: boolean;
  golemBinary: string;
}

export async function install(opts: InstallOptions): Promise<number> {
  const target = plistPath();
  const dataDir = getDataDir();
  const plist = renderLaunchdPlist({
    golemBinary: opts.golemBinary,
    homeDir: os.homedir(),
    dataDir,
  });

  if (fs.existsSync(target) && !opts.force) {
    const existing = fs.readFileSync(target, "utf-8");
    const origin = inferPlistOrigin(existing, opts.golemBinary);
    if (origin === "matches" && existing === plist) {
      console.log(`Plist already installed and up to date at ${target}.`);
    } else if (origin === "repo-local") {
      console.error(`Existing ${target} points at a local repo checkout.`);
      console.error("Migrating an existing dev install is destructive — review and confirm:");
      console.error("");
      console.error(`  1. Stop the old daemon:   launchctl bootout ${gui()}/${LABEL}`);
      console.error("  2. Move your data:        mv data/* " + dataDir + "/   (run from your repo)");
      console.error("  3. Re-run with --force:   golem install-daemon --force");
      console.error("");
      console.error("Your data directory will be: " + dataDir);
      return 1;
    } else {
      console.error(`A different ${LABEL}.plist exists at ${target}.`);
      console.error("Re-run with --force to overwrite, or remove it manually first.");
      return 1;
    }
  } else {
    if (opts.dryRun) {
      console.log("--- would write to", target, "---");
      console.log(plist);
      return 0;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // If --force and the agent is running, bootout first so the rewrite is clean.
    if (opts.force && fs.existsSync(target)) {
      launchctl("bootout", `${gui()}/${LABEL}`); // tolerate failure
    }
    fs.writeFileSync(target, plist);
    console.log(`Wrote ${target}`);
  }

  if (opts.dryRun) {
    console.log(`--- would run: launchctl bootstrap ${gui()} ${target} && kickstart -k ${gui()}/${LABEL} ---`);
    return 0;
  }

  // bootstrap can fail if it's already loaded — that's fine; kickstart -k handles restart.
  const bootstrap = launchctl("bootstrap", gui(), target);
  if (!bootstrap.ok && !/already loaded|service exists/i.test(bootstrap.output)) {
    console.error(bootstrap.output);
    return 1;
  }
  const kick = launchctl("kickstart", "-k", `${gui()}/${LABEL}`);
  if (!kick.ok) {
    console.error(kick.output);
    return 1;
  }

  console.log("");
  console.log("Golem is installed and running.");
  console.log(`  Status: launchctl print ${gui()}/${LABEL} | head`);
  console.log(`  Logs:   tail -F ~/Library/Logs/${LABEL}.log`);
  console.log("");
  return 0;
}

interface UninstallOptions {
  dryRun: boolean;
}

export async function uninstall(opts: UninstallOptions): Promise<number> {
  const target = plistPath();
  if (!fs.existsSync(target)) {
    console.log(`No plist at ${target} — nothing to uninstall.`);
    return 0;
  }

  if (opts.dryRun) {
    console.log(`--- would run: launchctl bootout ${gui()}/${LABEL} && rm ${target} ---`);
    return 0;
  }

  console.log("Stopping and unloading com.golem.agent...");
  launchctl("bootout", `${gui()}/${LABEL}`); // tolerate failure: may already be down
  fs.unlinkSync(target);
  console.log(`Removed ${target}.`);
  return 0;
}
