#!/usr/bin/env node
// Golem — start the platform with auto-restart support
// Exit code 75 = restart requested (e.g. after onboarding writes config)
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
process.chdir(root);

function start() {
  const child = spawn("npx", ["tsx", "src/cli.ts"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    if (code === 75) {
      console.log("[golem] restarting platform...");
      setTimeout(start, 1000);
    } else {
      process.exit(code ?? 1);
    }
  });
}

start();
