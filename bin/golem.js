#!/usr/bin/env node
// Golem CLI wrapper.
//
// - Forwards subcommands and args to src/cli.ts (or dist/cli.js when installed).
// - For `start` (default) only: re-spawns the child on exit code 75
//   (onboarding-requested restart). Other subcommands exit naturally.
// - Does NOT chdir; src/utils/paths.ts resolves the data dir from
//   $GOLEM_DATA_DIR > ./data/ > OS-native default, so cwd matters.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const builtEntry = resolve(root, "dist", "cli.js");
const sourceEntry = resolve(root, "src", "cli.ts");

const argv = process.argv.slice(2);
const subcommand = argv[0] ?? "start";
const isStart = subcommand === "start" || subcommand.startsWith("-") || !["stop", "status", "logs", "version", "update", "doctor", "install-daemon", "uninstall-daemon", "help", "-h", "--help"].includes(subcommand);

function spawnChild() {
  // Prefer compiled dist/ if present (npm-installed), else use tsx on src/.
  if (existsSync(builtEntry)) {
    return spawn(process.execPath, [builtEntry, ...argv], { stdio: "inherit" });
  }
  return spawn("npx", ["tsx", sourceEntry, ...argv], { stdio: "inherit", shell: true });
}

function run() {
  const child = spawnChild();
  child.on("exit", (code) => {
    if (isStart && code === 75) {
      console.log("[golem] restarting platform...");
      setTimeout(run, 1000);
    } else {
      process.exit(code ?? 1);
    }
  });
}

run();
