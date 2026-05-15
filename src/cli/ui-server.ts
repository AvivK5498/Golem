/**
 * Spawn the bundled Next.js UI as a child process during `golem start`.
 *
 * The UI is built with `output: "standalone"` so the bundle is self-contained
 * (its own node_modules, no workspace resolution). The server.js entrypoint
 * lives at <package>/ui/.next/standalone/ui/server.js — the extra `/ui/`
 * segment is preserved by outputFileTracingRoot pointing at the workspace.
 *
 * In a dev checkout the standalone bundle doesn't exist (unless someone ran
 * `npm run build` from the root). We detect that and skip the spawn with a
 * clear warning rather than crashing.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const UI_PORT = 3015;

/**
 * Locate the standalone server.js. Walks up from this module to find the
 * package root, then checks the canonical standalone location. Returns null
 * when the bundle isn't present (e.g. dev clone without a UI build).
 */
function findStandaloneServer(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/cli/ or dist/cli/ -> ../.. -> package root
  const packageRoot = path.resolve(here, "..", "..");
  const candidate = path.join(packageRoot, "ui", ".next", "standalone", "ui", "server.js");
  return fs.existsSync(candidate) ? candidate : null;
}

export interface UiHandle {
  child: ChildProcess;
  stop(): void;
}

export function startUi(): UiHandle | null {
  const serverPath = findStandaloneServer();
  if (!serverPath) {
    console.warn("[ui] standalone bundle not found — UI will not be served.");
    console.warn("[ui] If you cloned the repo, run `npm install && npm run build`.");
    console.warn("[ui] If you installed via npm, this is a packaging bug — please report.");
    return null;
  }

  console.log(`[ui] starting Next.js on 127.0.0.1:${UI_PORT}`);
  const child = spawn(process.execPath, [serverPath], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      // Loopback-only — never expose the UI publicly. SSH tunnel / Tailscale is the auth.
      HOSTNAME: "127.0.0.1",
      PORT: String(UI_PORT),
    },
  });

  child.on("exit", (code, signal) => {
    // Only complain if we didn't intend to stop it. shuttingDown sets killed=true.
    if (!child.killed) {
      console.error(`[ui] exited unexpectedly (code=${code} signal=${signal})`);
    }
  });

  return {
    child,
    stop() {
      if (!child.killed && child.pid) {
        child.kill("SIGTERM");
      }
    },
  };
}
