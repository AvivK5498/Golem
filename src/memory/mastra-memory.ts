/**
 * Mastra Memory factory.
 *
 * Creates a single Memory instance that replaces SQLite ConversationHistory.
 *
 * Mastra Memory handles:
 *   - lastMessages   -> replaces ConversationHistory.getRecentMessages()
 *   - Automatic save after agent.generate() -> replaces addMemory() + addMessage()
 *
 * When passed to the Agent constructor and scoped per-thread (via the generate()
 * `memory` option), each chat gets isolated conversation history automatically.
 *
 * Semantic recall was removed; recall across turns is handled by smart-recall.ts.
 */
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";

/**
 * Agent config interface — minimal subset needed for memory creation.
 * Defined inline to avoid depending on platform/schemas.ts.
 */
interface AgentMemoryConfig {
  id: string;
  memory?: {
    lastMessages?: number;
    observational?: {
      enabled?: boolean;
      model?: string;
      scope?: "resource" | "thread";
    };
    workingMemory?: {
      enabled?: boolean;
      scope?: "resource" | "thread";
    };
  };
}

/**
 * Create a Memory instance for a specific agent, using shared storage.
 * Each agent gets isolated memory via scoped thread/resource IDs (handled by buildMemoryScope).
 * Working memory template is read from the agent's directory.
 *
 * When `agentSettings` is provided, SQLite values take precedence over YAML config.
 */
export function createAgentMemory(
  config: AgentMemoryConfig,
  sharedStorage: LibSQLStore,
  agentSettings?: import("../platform/agent-settings.js").AgentSettings,
  memoryTemplate?: string | null,
): Memory {
  const agentId = config.id;
  const template = memoryTemplate || undefined;

  const memConfig = config.memory ?? {};

  // Read from SQLite with YAML fallback
  const lastMessages = agentSettings?.getLastMessages(agentId) ?? memConfig.lastMessages ?? 12;
  const wmEnabled = agentSettings?.getWorkingMemoryEnabled(agentId) ?? memConfig.workingMemory?.enabled ?? true;
  const wmScope = agentSettings?.getWorkingMemoryScope(agentId) ?? memConfig.workingMemory?.scope ?? "resource";

  const options: Record<string, unknown> = {
    lastMessages,
    semanticRecall: false,
  };

  if (wmEnabled && template) {
    options.workingMemory = {
      enabled: true,
      scope: wmScope,
      template,
    };
  }

  return new Memory({
    storage: sharedStorage,
    options,
  } as ConstructorParameters<typeof Memory>[0]);
}
