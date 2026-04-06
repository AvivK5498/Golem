/**
 * Proactive Check-in System
 *
 * Gives agents periodic opportunities to decide whether to reach out
 * to the owner. Uses randomized timers, active hours, min gap, and
 * probability gates to create natural, unpredictable check-in patterns.
 */
import type { AgentRunner } from "./agent-runner.js";
import type { AgentSettings } from "./agent-settings.js";
import type { AgentRegistry } from "./agent-registry.js";
import type { TransportManager } from "./transport-manager.js";
import type { FeedStore } from "../feed/feed-store.js";
import { logger } from "../utils/external-logger.js";

const AGENT_FOLLOWUP_TOKEN = "[AGENT_FOLLOWUP]";

const DEFAULT_PROMPT = `You have a chance to check in with the user proactively.
Review your working memory and recent conversation history.

If there's something worth following up on — a goal they mentioned,
a question you asked, progress to check on, or something timely —
send a brief, natural check-in message.

Important: This is an unprompted follow-up, not a reply to a message.
Open naturally — e.g., "Hey, just checking in..." or "Quick thought
about..." so the user knows this isn't a response to something they said.
Be casual and warm, not robotic.

You MUST start your response with exactly "${AGENT_FOLLOWUP_TOKEN} " (including the space after it).
This token helps you identify previous proactive follow-ups in your conversation history.
The user will not see this token — it is stripped before delivery.

If there's nothing worth following up on right now, respond with
exactly: NO_FOLLOWUP`;

export interface ProactiveCheckerDeps {
  runners: Map<string, AgentRunner>;
  transports: TransportManager;
  registry: AgentRegistry;
  agentSettings: AgentSettings;
  feedStore: FeedStore;
}

export class ProactiveChecker {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private deps: ProactiveCheckerDeps;

  constructor(deps: ProactiveCheckerDeps) {
    this.deps = deps;
  }

  /** Start proactive timers for all enabled agents. */
  start(): void {
    for (const [agentId] of this.deps.runners) {
      this.scheduleNext(agentId);
    }
    console.log(`[proactive] started for ${this.deps.runners.size} agent(s)`);
  }

  /** Re-read settings and reschedule timer for an agent. Call after settings change. */
  reschedule(agentId: string): void {
    this.scheduleNext(agentId);
    const config = this.deps.agentSettings.getProactiveConfig(agentId);
    console.log(`[proactive] rescheduled ${agentId} (enabled=${config.enabled})`);
  }

  stop(): void {
    for (const [agentId, timer] of this.timers) {
      clearTimeout(timer);
      console.log(`[proactive] stopped timer for ${agentId}`);
    }
    this.timers.clear();
  }

  private scheduleNext(agentId: string): void {
    // Clear existing timer
    const existing = this.timers.get(agentId);
    if (existing) clearTimeout(existing);

    const config = this.deps.agentSettings.getProactiveConfig(agentId);
    if (!config.enabled) {
      this.timers.delete(agentId);
      return;
    }

    const minMs = config.minIntervalHours * 3_600_000;
    const maxMs = config.maxIntervalHours * 3_600_000;
    const delayMs = minMs + Math.random() * (maxMs - minMs);

    const timer = setTimeout(() => this.tick(agentId), delayMs);
    if (timer.unref) timer.unref(); // don't keep process alive for proactive checks
    this.timers.set(agentId, timer);
  }

  private async tick(agentId: string): Promise<void> {
    try {
      const config = this.deps.agentSettings.getProactiveConfig(agentId);

      // Re-check enabled (settings may have changed)
      if (!config.enabled) {
        this.timers.delete(agentId);
        return;
      }

      // Active hours check
      if (!this.isWithinActiveHours(config.activeHoursStart, config.activeHoursEnd)) {
        this.scheduleNext(agentId);
        return;
      }

      // Min gap check — hours since last interaction
      const lastEntry = this.deps.feedStore.list(agentId, { limit: 1 })[0];
      if (lastEntry) {
        const hoursSinceLast = (Date.now() - lastEntry.timestamp) / 3_600_000;
        if (hoursSinceLast < config.minGapHours) {
          this.scheduleNext(agentId);
          return;
        }
      }

      // Probability gate
      if (Math.random() > config.probability) {
        logger.info(`Proactive check skipped (probability gate)`, { agent: agentId });
        this.deps.feedStore.log(agentId, {
          source: "proactive",
          input: "Proactive check — skipped (probability gate)",
          status: "skipped",
        });
        this.scheduleNext(agentId);
        return;
      }

      // Run agent turn
      const runner = this.deps.runners.get(agentId);
      const agentConfig = this.deps.registry.get(agentId);
      const transport = this.deps.transports.get(agentId);

      if (!runner || !agentConfig) {
        this.scheduleNext(agentId);
        return;
      }

      const basePrompt = config.prompt || DEFAULT_PROMPT;
      // Ensure the token instruction is always present, even with custom prompts
      const prompt = basePrompt.includes(AGENT_FOLLOWUP_TOKEN)
        ? basePrompt
        : basePrompt + `\n\nYou MUST start your response with "${AGENT_FOLLOWUP_TOKEN} " — this token is stripped before delivery and helps you identify past proactive follow-ups in history.`;
      const ownerChatId = String(agentConfig.transport.ownerId);

      logger.info(`Proactive check running`, { agent: agentId });

      const result = await runner.processMessage(
        prompt,
        ownerChatId,
        "owner",
        { promptMode: "proactive" },
      );

      const responseText = result.text?.trim() || "";
      const isNoFollowup =
        !responseText ||
        responseText === "NO_FOLLOWUP" ||
        responseText.includes("NO_FOLLOWUP") ||
        responseText === "(no response)";

      if (isNoFollowup) {
        // Silent — log to feed only
        logger.info(`Proactive check — no follow-up needed`, { agent: agentId });
        this.deps.feedStore.log(agentId, {
          source: "proactive",
          input: prompt.slice(0, 100),
          output: "NO_FOLLOWUP",
          status: "skipped",
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        });
      } else {
        // Send to owner — strip AGENT_FOLLOWUP token for transport
        const cleanText = responseText.replace(AGENT_FOLLOWUP_TOKEN, "").trim();
        if (transport) {
          const ownerAddress = { platform: "telegram" as const, id: ownerChatId };
          await transport.sendText(ownerAddress, cleanText);
        }
        logger.info(`Proactive follow-up sent`, { agent: agentId, chars: String(cleanText.length) });
        this.deps.feedStore.log(agentId, {
          source: "proactive",
          input: prompt.slice(0, 100),
          output: cleanText.slice(0, 500),
          status: "delivered",
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[proactive] ${agentId} error:`, msg);
      logger.error(`Proactive check failed: ${msg}`, { agent: agentId });
    } finally {
      this.scheduleNext(agentId);
    }
  }

  private isWithinActiveHours(start: string, end: string): boolean {
    const now = new Date();
    const [startH, startM] = start.split(":").map(Number);
    const [endH, endM] = end.split(":").map(Number);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = (startH || 0) * 60 + (startM || 0);
    const endMinutes = (endH || 23) * 60 + (endM || 59);
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
}

export { AGENT_FOLLOWUP_TOKEN };
