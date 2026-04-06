/**
 * Golem entry point — starts the platform.
 */
import "dotenv/config";

const required = ["OPENROUTER_API_KEY"] as const;
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `\n  Missing required environment variables: ${missing.join(", ")}\n\n` +
      `  Copy the example file and fill in your keys:\n` +
      `    cp .env.example .env\n`,
  );
  process.exit(1);
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
