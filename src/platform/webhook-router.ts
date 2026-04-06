/**
 * Webhook Scenario Router
 *
 * Classifies incoming webhook payloads against user-defined scenario cards
 * using a nano LLM model. Each scenario has a natural-language "when" condition
 * and a "then" prompt template with {{field}} interpolation.
 */
import { generateText } from "ai";
import { getNanoModel } from "../agent/model.js";
import { logger } from "../utils/external-logger.js";
import type { SettingsStore } from "../scheduler/settings-store.js";

// ── Types ───────────────────────────────────────────────────

export interface WebhookScenario {
  name: string;
  when: string;
  then: string;
  enabled: boolean;
  allowUnauthenticated?: boolean;
}

export interface WebhookRouteResult {
  matched: boolean;
  scenario?: WebhookScenario;
  prompt?: string;
  scenarioName?: string;
}

// ── Settings key convention ─────────────────────────────────

const SCENARIOS_PREFIX = "webhook.scenarios.";

export function scenarioKey(source: string): string {
  return `${SCENARIOS_PREFIX}${source}`;
}

// ── Template Interpolation ──────────────────────────────────

function getNestedValue(obj: unknown, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Replace {{field}} placeholders with payload values.
 * Missing fields become empty string; lines that become blank after
 * interpolation are stripped from the output.
 */
export function interpolate(template: string, data: Record<string, unknown>): string {
  const interpolated = template.replace(/\{\{([^}]+)\}\}/g, (_, keyPath: string) => {
    const value = getNestedValue(data, keyPath.trim());
    if (value === undefined || value === null) return "";
    return String(value);
  });
  // Strip lines that are empty or whitespace-only after interpolation
  return interpolated
    .split("\n")
    .filter(line => line.trim().length > 0)
    .join("\n");
}

// ── Scenario Loading ────────────────────────────────────────

export function loadScenarios(
  agentId: string,
  source: string,
  store: SettingsStore,
): WebhookScenario[] {
  const raw = store.get(agentId, scenarioKey(source));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as WebhookScenario[];
    return parsed.filter(s => s.enabled !== false);
  } catch {
    return [];
  }
}

/**
 * List all webhook sources that have scenarios configured for an agent.
 * Returns a map of source name → scenario array (including disabled ones).
 */
export function listAllScenarios(
  agentId: string,
  store: SettingsStore,
): Record<string, WebhookScenario[]> {
  const all = store.getAll(agentId);
  const result: Record<string, WebhookScenario[]> = {};
  for (const [key, value] of all) {
    if (!key.startsWith(SCENARIOS_PREFIX)) continue;
    const source = key.slice(SCENARIOS_PREFIX.length);
    try {
      result[source] = JSON.parse(value) as WebhookScenario[];
    } catch {
      // skip corrupt entries
    }
  }
  return result;
}

/**
 * Check if a source allows unauthenticated webhooks.
 * Returns true if ANY scenario for this source has allowUnauthenticated: true.
 */
export function sourceAllowsUnauthenticated(
  agentId: string,
  source: string,
  store: SettingsStore,
): boolean {
  const raw = store.get(agentId, scenarioKey(source));
  if (!raw) return false;
  try {
    const scenarios = JSON.parse(raw) as WebhookScenario[];
    return scenarios.some(s => s.allowUnauthenticated === true);
  } catch {
    return false;
  }
}

// ── LLM Classification ─────────────────────────────────────

export async function classifyWebhook(
  payload: Record<string, unknown>,
  scenarios: WebhookScenario[],
  source: string,
): Promise<WebhookScenario | null> {
  if (scenarios.length === 0) return null;

  const payloadStr = JSON.stringify(payload, null, 2).slice(0, 10_000);

  const options = scenarios
    .map((s, i) => `${i + 1}. "${s.name}" — ${s.when}`)
    .join("\n");

  try {
    const { text } = await generateText({
      model: getNanoModel(),
      temperature: 0,
      maxOutputTokens: 20,
      system:
        "You classify webhook payloads against scenario descriptions. " +
        "Reply with ONLY the number of the matching scenario, or 0 if none match. " +
        "No explanation.",
      prompt:
        `Webhook from "${source}":\n${payloadStr}\n\n` +
        `Which scenario matches?\n${options}\n0. None of the above`,
    });

    const num = parseInt(text.trim(), 10);
    if (num > 0 && num <= scenarios.length) {
      return scenarios[num - 1];
    }
  } catch (err) {
    console.error(`[webhook-router] classification failed for ${source}:`, err instanceof Error ? err.message : err);
    logger.error(`webhook classification failed: ${err instanceof Error ? err.message : String(err)}`, { source });
  }
  return null;
}

// ── Route ───────────────────────────────────────────────────

export async function routeWebhook(
  agentId: string,
  source: string,
  payload: Record<string, unknown>,
  store: SettingsStore,
): Promise<WebhookRouteResult> {
  const scenarios = loadScenarios(agentId, source, store);
  if (scenarios.length === 0) {
    return { matched: false };
  }

  // Inject built-in variables available in {{}} templates
  const now = new Date();
  payload._today = now.toISOString().slice(0, 10);
  payload._now = now.toISOString();
  payload._source = source;
  payload._agent = agentId;
  payload._raw = JSON.stringify(payload, null, 2).slice(0, 10_000);

  const scenario = await classifyWebhook(payload, scenarios, source);
  if (!scenario) {
    logger.warn(`webhook no scenario match among ${scenarios.length} candidates`, { agent: agentId, source });
    return { matched: false };
  }

  const prompt = interpolate(scenario.then, payload);
  logger.info(`webhook scenario matched: "${scenario.name}"`, { agent: agentId, source });
  return {
    matched: true,
    scenario,
    prompt,
    scenarioName: scenario.name,
  };
}
