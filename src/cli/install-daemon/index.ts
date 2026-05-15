/**
 * `golem install-daemon` / `golem uninstall-daemon` — top-level dispatch.
 *
 * Routes to the platform-specific implementation. Resolves the absolute path
 * of the `golem` binary that the unit/plist should launch by inspecting
 * `process.argv[1]` (the entry the user invoked).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as linux from "./linux.js";
import * as macos from "./macos.js";

interface ParsedArgs {
  dryRun: boolean;
  force: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  return {
    dryRun: args.includes("--dry-run") || args.includes("-n"),
    force: args.includes("--force") || args.includes("-f"),
  };
}

/**
 * Resolve the absolute path of the golem CLI entry that the unit/plist should
 * launch. Only accepts argv[1] if it's the bin shim — running via tsx in dev
 * gives argv[1]=src/cli.ts, which we definitely don't want in a unit file.
 */
function resolveGolemBinary(): string {
  const argv1 = process.argv[1];
  if (argv1 && path.isAbsolute(argv1) && /[\\/]bin[\\/]golem(\.js)?$/.test(argv1)) {
    return argv1;
  }
  // Dev / unusual layouts: derive from this file's location. Both src/cli/install-daemon/
  // and dist/cli/install-daemon/ sit two levels under the package root.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/cli/install-daemon/ -> src/cli/ -> src/ -> <root> -> <root>/bin/golem.js
  return path.resolve(here, "..", "..", "..", "bin", "golem.js");
}

export async function runInstall(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  const golemBinary = resolveGolemBinary();
  if (process.platform === "linux") {
    return linux.install({ ...opts, golemBinary });
  }
  if (process.platform === "darwin") {
    return macos.install({ ...opts, golemBinary });
  }
  console.error(`install-daemon is not supported on ${process.platform}. Linux and macOS only.`);
  return 1;
}

export async function runUninstall(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (process.platform === "linux") return linux.uninstall(opts);
  if (process.platform === "darwin") return macos.uninstall(opts);
  console.error(`uninstall-daemon is not supported on ${process.platform}. Linux and macOS only.`);
  return 1;
}

// Subcommand entry points conforming to the CLI dispatcher contract.
export async function run(args: string[]): Promise<number> {
  return runInstall(args);
}
