import { TelegramTransport } from "../transport/telegram-transport.js";
import { expandEnvVars } from "../config.js";
import type { AgentRegistry } from "./agent-registry.js";
import { logger } from "../utils/external-logger.js";

export class TransportManager {
  private transports: Map<string, TelegramTransport> = new Map();

  /** Create a transport for each enabled agent. Detects duplicate bot tokens. */
  createAll(registry: AgentRegistry): void {
    const tokenToAgent = new Map<string, string>();

    for (const config of registry.getAll()) {
      if (config.transport.platform !== "telegram") {
        console.warn(
          `[transport] unsupported platform "${config.transport.platform}" for agent "${config.id}"`,
        );
        logger.warn(`unsupported platform "${config.transport.platform}"`, { agent: config.id, transport: config.transport.platform });
        continue;
      }

      const token = expandEnvVars(config.transport.botToken);
      if (!token) {
        console.error(
          `[transport] bot token not resolved for agent "${config.id}" (env var: ${config.transport.botToken}), skipping`,
        );
        logger.error(`bot token not resolved for agent "${config.id}"`, { agent: config.id, transport: "telegram" });
        continue;
      }

      const existingAgent = tokenToAgent.get(token);
      if (existingAgent) {
        console.error(
          `[transport] agent "${config.id}" has same bot token as "${existingAgent}", skipping`,
        );
        logger.error(`agent "${config.id}" has duplicate bot token (same as "${existingAgent}")`, { agent: config.id, transport: "telegram" });
        continue;
      }
      tokenToAgent.set(token, config.id);

      const transport = new TelegramTransport(token);
      this.transports.set(config.id, transport);
      console.log(`[transport] created Telegram bot for agent "${config.id}"`);
      logger.info(`created Telegram transport for agent "${config.id}"`, { agent: config.id, transport: "telegram" });
    }
  }

  /** Connect all transports in parallel. One failure doesn't block others. */
  async connectAll(): Promise<void> {
    const MAX_RETRIES = 3;
    const entries = [...this.transports.entries()];
    const results = await Promise.allSettled(
      entries.map(async ([agentId, transport]) => {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            await transport.connect();
            console.log(`[transport] agent "${agentId}" connected`);
            logger.info(`transport connected`, { agent: agentId, transport: "telegram" });
            return;
          } catch (err) {
            if (attempt < MAX_RETRIES) {
              const delayMs = 2000 * Math.pow(2, attempt); // 2s, 4s, 8s
              console.warn(`[transport] agent "${agentId}" connect failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${delayMs / 1000}s...`);
              await new Promise(r => setTimeout(r, delayMs));
            } else {
              throw err;
            }
          }
        }
      }),
    );

    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        const agentId = entries[i][0];
        console.error(
          `[transport] agent "${agentId}" connection failed after ${MAX_RETRIES + 1} attempts:`,
          result.reason,
        );
        logger.error(`transport connection failed after retries: ${result.reason}`, { agent: agentId, transport: "telegram" });
      }
    }
  }

  /** Disconnect all transports */
  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      [...this.transports.values()].map((t) => t.disconnect()),
    );
  }

  get(agentId: string): TelegramTransport | undefined {
    return this.transports.get(agentId);
  }

  getAll(): Map<string, TelegramTransport> {
    return this.transports;
  }
}
