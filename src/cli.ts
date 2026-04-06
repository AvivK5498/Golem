/**
 * Golem entry point — starts the platform.
 */
import "dotenv/config";

if (!process.env.OPENROUTER_API_KEY) {
  console.log("\n  No OPENROUTER_API_KEY found — starting in onboarding mode.");
  console.log("  Open http://localhost:3015 to configure your platform.\n");
}

const { startPlatform } = await import("./platform/platform.js");

startPlatform()
  .then(() => {
    // Keep the process alive — transports and scheduler run on intervals/callbacks
    return new Promise(() => {});
  })
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
