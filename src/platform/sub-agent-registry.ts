/**
 * SubAgentRegistry — in-memory registry of sub-agents per parent agent.
 *
 * Wraps loadSubAgents() and provides a hot-reload mechanism. When sub-agent
 * config changes (via API or UI), call rebuild(agentId) to re-create the
 * Agent instances. The parent agent's DynamicArgument function reads from
 * this registry on every generate() call, picking up changes immediately.
 */
import type { Agent } from "@mastra/core/agent";
import { logger } from "../utils/external-logger.js";

type LoadSubAgentsFn = (agentId: string | undefined, dynamicTools?: Record<string, unknown>, preloadedConfig?: Record<string, unknown> | null) => Record<string, Agent>;

export class SubAgentRegistry {
  private agents = new Map<string, Record<string, Agent>>();
  private loader: LoadSubAgentsFn;
  private dynamicTools: Record<string, unknown>;
  private agentStore?: { getSubAgents(id: string): Record<string, unknown> | null };

  constructor(loader: LoadSubAgentsFn, dynamicTools: Record<string, unknown> = {}, agentStore?: { getSubAgents(id: string): Record<string, unknown> | null }) {
    this.loader = loader;
    this.dynamicTools = dynamicTools;
    this.agentStore = agentStore;
  }

  /** Load sub-agents for a parent agent. Called once per agent at startup. */
  load(agentId: string): Record<string, Agent> {
    const preloaded = this.agentStore?.getSubAgents(agentId) ?? null;
    const subAgents = this.loader(agentId, this.dynamicTools, preloaded);
    const count = Object.keys(subAgents).length;
    if (count > 0) {
      logger.info(`Sub-agent registry loaded ${count} sub-agents for "${agentId}"`, { agent: agentId, count: String(count) });
    }
    return subAgents;
  }

  /** Get the current sub-agents for a parent agent. Returns empty if not loaded. */
  get(agentId: string): Record<string, Agent> {
    return this.agents.get(agentId) ?? {};
  }

  /**
   * Rebuild sub-agents for a parent agent from disk (YAML).
   * Called after config changes to hot-reload without restarting.
   * The next generate() call on the parent agent will pick up the new sub-agents.
   */
  rebuild(agentId: string): void {
    const oldCount = Object.keys(this.agents.get(agentId) ?? {}).length;
    try {
      const preloaded = this.agentStore?.getSubAgents(agentId) ?? null;
      const subAgents = this.loader(agentId, this.dynamicTools, preloaded);
      this.agents.set(agentId, subAgents);
      const newCount = Object.keys(subAgents).length;
      console.log(`[sub-agent-registry] rebuilt "${agentId}": ${oldCount} → ${newCount} sub-agents`);
      logger.info(`Sub-agents rebuilt for "${agentId}": ${oldCount} → ${newCount}`, {
        agent: agentId,
        oldCount: String(oldCount),
        newCount: String(newCount),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sub-agent-registry] rebuild failed for "${agentId}":`, msg);
      logger.error(`Sub-agent rebuild failed for "${agentId}": ${msg}`, { agent: agentId });
      // Keep the old agents on failure — don't break a working setup
    }
  }

  /** List all parent agent IDs that have sub-agents loaded. */
  listParents(): string[] {
    return [...this.agents.keys()];
  }
}
