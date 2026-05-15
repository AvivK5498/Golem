/**
 * `golem start` — start the platform in the foreground.
 *
 * Refuses to start a second instance if a live PID file is present. The
 * platform writes its PID on first successful start, removes it on graceful
 * shutdown, and runs until SIGINT/SIGTERM.
 */
import { getRunningDaemon, removePidFile, writePidFile } from "./pid.js";

export async function run(_args: string[]): Promise<number> {
  const running = getRunningDaemon();
  if (running) {
    console.error(
      `golem is already running (pid ${running.pid}, started ${new Date(running.startedAt).toISOString()}).`,
    );
    console.error("Stop it first with `golem stop`, or remove the pid file if you're sure it's dead.");
    return 1;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    console.log("\n  No OPENROUTER_API_KEY found — starting in onboarding mode.");
    console.log("  Open http://localhost:3015 to configure your platform.\n");
  }

  const { startPlatform } = await import("../platform/platform.js");

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[golem] received ${signal}, shutting down...`);
    removePidFile();
    // The platform registers its own graceful-shutdown handlers; we just need to
    // make sure the pid file is gone. Re-raise so Node exits naturally.
    process.kill(process.pid, signal);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("exit", removePidFile);

  try {
    await startPlatform();
  } catch (err) {
    console.error(err);
    removePidFile();
    return 1;
  }

  writePidFile();
  // Keep the process alive — transports and scheduler run on intervals/callbacks.
  await new Promise(() => {});
  return 0;
}
