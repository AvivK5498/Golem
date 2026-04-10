#!/usr/bin/env npx tsx
/**
 * Focused test for the smart-recall helper.
 *
 * Builds an in-memory LibSQL Memory, seeds messages with backdated
 * createdAt timestamps, and verifies that computeSmartLastMessages()
 * resolves to the right value across several scenarios.
 *
 * No LLM calls. No network. Just the recall API + the helper.
 *
 * Usage:
 *   npx tsx src/test-smart-recall.ts
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";
import { computeSmartLastMessages, type SmartRecallConfig } from "./memory/smart-recall.js";

// ── Helpers ─────────────────────────────────────────────────

interface SeedSpec {
  /** How many messages */
  count: number;
  /** How long ago they were created (ms) */
  agoMs: number;
}

/**
 * Build a fresh in-memory Memory instance + seed it with messages
 * spread across the requested time offsets. Each seed group is created
 * as alternating user/assistant pairs to mimic real conversation.
 */
async function buildSeededMemory(seeds: SeedSpec[], bodyChars = 50): Promise<{
  memory: Memory;
  threadId: string;
  resourceId: string;
}> {
  const storage = new LibSQLStore({
    id: `smart-recall-test-${randomUUID().slice(0, 8)}`,
    url: "file::memory:",
  } as ConstructorParameters<typeof LibSQLStore>[0]);

  const memory = new Memory({
    storage,
    options: {
      lastMessages: 12,
      semanticRecall: false,
    },
  } as ConstructorParameters<typeof Memory>[0]);

  const threadId = `test-thread-${randomUUID()}`;
  const resourceId = `test-resource-${randomUUID()}`;

  // Create the thread first — saveMessages requires it to exist.
  await memory.saveThread({
    thread: {
      id: threadId,
      resourceId,
      title: "smart-recall test",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  // Build all seeded messages with backdated createdAt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [];
  for (const seed of seeds) {
    const baseTime = Date.now() - seed.agoMs;
    for (let i = 0; i < seed.count; i++) {
      // Spread within the group by 1ms each so order is deterministic.
      const ts = new Date(baseTime + i);
      const role = i % 2 === 0 ? "user" : "assistant";
      // Synthesize a body of the requested length so token estimates are predictable.
      const filler = "x".repeat(Math.max(0, bodyChars - 20));
      messages.push({
        id: randomUUID(),
        role,
        threadId,
        resourceId,
        createdAt: ts,
        content: {
          format: 2,
          parts: [{ type: "text", text: `msg #${i} ${filler}` }],
        },
      });
    }
  }

  if (messages.length > 0) {
    await memory.saveMessages({ messages });
  }

  return { memory, threadId, resourceId };
}

// ── Test scenarios ──────────────────────────────────────────

interface Scenario {
  name: string;
  seeds: SeedSpec[];
  cfg: SmartRecallConfig;
  expected: { countInWindow: number; resolved: number; reason: string };
  /** Custom message size for token-cap scenarios — overrides the default ~50-char body. */
  bodyChars?: number;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

const scenarios: Scenario[] = [
  {
    name: "Empty thread (brand new agent)",
    seeds: [],
    cfg: { windowDays: 3, min: 12, max: 40 },
    expected: { countInWindow: 0, resolved: 12, reason: "below_min" },
  },
  {
    name: "5 messages all from 30 days ago (sparse + stale)",
    seeds: [{ count: 5, agoMs: 30 * DAY }],
    cfg: { windowDays: 3, min: 12, max: 40 },
    expected: { countInWindow: 0, resolved: 12, reason: "below_min" },
  },
  {
    name: "8 messages within window, MIN=12 (window sparse, bump to MIN)",
    seeds: [{ count: 8, agoMs: 1 * DAY }],
    cfg: { windowDays: 3, min: 12, max: 40 },
    expected: { countInWindow: 8, resolved: 12, reason: "below_min" },
  },
  {
    name: "25 messages within window (sweet spot)",
    seeds: [{ count: 25, agoMs: 12 * HOUR }],
    cfg: { windowDays: 3, min: 12, max: 40 },
    expected: { countInWindow: 25, resolved: 25, reason: "in_range" },
  },
  {
    name: "100 messages within window (saturated, clamp to MAX)",
    seeds: [{ count: 100, agoMs: 6 * HOUR }],
    cfg: { windowDays: 3, min: 12, max: 40 },
    expected: { countInWindow: 100, resolved: 40, reason: "above_max" },
  },
  {
    name: "Mixed: 4 in window + 30 outside (window sparse, bump to MIN)",
    seeds: [
      { count: 4, agoMs: 12 * HOUR },
      { count: 30, agoMs: 14 * DAY },
    ],
    cfg: { windowDays: 3, min: 12, max: 40 },
    expected: { countInWindow: 4, resolved: 12, reason: "below_min" },
  },
  {
    name: "Mixed: 20 in window + 30 outside (in range, ignore stale)",
    seeds: [
      { count: 20, agoMs: 1 * DAY },
      { count: 30, agoMs: 14 * DAY },
    ],
    cfg: { windowDays: 3, min: 12, max: 40 },
    expected: { countInWindow: 20, resolved: 20, reason: "in_range" },
  },
  {
    name: "Edge: exactly MIN messages in window",
    seeds: [{ count: 12, agoMs: 1 * DAY }],
    cfg: { windowDays: 3, min: 12, max: 40 },
    expected: { countInWindow: 12, resolved: 12, reason: "in_range" },
  },
  {
    name: "Edge: exactly MAX messages in window",
    seeds: [{ count: 40, agoMs: 1 * DAY }],
    cfg: { windowDays: 3, min: 12, max: 40 },
    expected: { countInWindow: 40, resolved: 40, reason: "in_range" },
  },
  {
    name: "Tight window: 1-day window with msgs from 2 days ago",
    seeds: [{ count: 20, agoMs: 2 * DAY }],
    cfg: { windowDays: 1, min: 12, max: 40 },
    expected: { countInWindow: 0, resolved: 12, reason: "below_min" },
  },

  // ── Token-cap scenarios ─────────────────────────────────
  // Each seeded message is ~100 chars → ~25 estimated tokens (chars/4 + JSON overhead).
  // Real estimate per message in JSON form is ~35 tokens. Pad budgets accordingly.
  {
    name: "TokenCap: budget large enough — no trim",
    seeds: [{ count: 30, agoMs: 1 * DAY }],
    bodyChars: 100,
    cfg: { windowDays: 3, min: 12, max: 40, maxTokens: 10_000 },
    // 30 in window, candidate=30, 30 * ~35 = ~1050 tokens, well under budget
    expected: { countInWindow: 30, resolved: 30, reason: "in_range" },
  },
  {
    name: "TokenCap: budget tight — trims below count cap",
    seeds: [{ count: 40, agoMs: 1 * DAY }],
    bodyChars: 200, // ~27 actual tokens per message via tiktoken
    cfg: { windowDays: 3, min: 12, max: 40, maxTokens: 500 },
    // candidate=40, ~18 messages fit (18 * 27 = 486 ≤ 500, next would overflow)
    expected: { countInWindow: 40, resolved: 18, reason: "token_capped" },
  },
  {
    name: "TokenCap: budget below MIN — token cap wins over min",
    seeds: [{ count: 20, agoMs: 1 * DAY }],
    bodyChars: 200,
    cfg: { windowDays: 3, min: 12, max: 40, maxTokens: 200 },
    // candidate=20, ~7 messages fit (7 * 27 = 189 ≤ 200, next would overflow).
    // min=12 ignored — token cap is highest priority.
    expected: { countInWindow: 20, resolved: 7, reason: "token_capped" },
  },
  {
    name: "TokenCap: zero candidate (empty thread) — no trim, returns 0",
    seeds: [],
    cfg: { windowDays: 3, min: 0, max: 40, maxTokens: 1000 },
    // candidate=0 because min=0 and window empty; phase 2 short-circuits
    expected: { countInWindow: 0, resolved: 0, reason: "in_range" },
  },
];

// ── Runner ──────────────────────────────────────────────────

async function main() {
  console.log("Smart-recall feasibility test\n");
  console.log(`Scenarios: ${scenarios.length}\n`);

  let passed = 0;
  let failed = 0;

  for (const sc of scenarios) {
    process.stdout.write(`▶ ${sc.name}\n`);
    process.stdout.write(`  cfg: window=${sc.cfg.windowDays}d, min=${sc.cfg.min}, max=${sc.cfg.max}\n`);

    const totalSeeded = sc.seeds.reduce((s, x) => s + x.count, 0);
    const seedDescription = sc.seeds.length === 0
      ? "(none)"
      : sc.seeds.map(s => `${s.count}@${(s.agoMs / DAY).toFixed(2)}d`).join(", ");
    process.stdout.write(`  seed: ${seedDescription} (total ${totalSeeded})\n`);

    try {
      const { memory, threadId, resourceId } = await buildSeededMemory(sc.seeds, sc.bodyChars);
      const result = await computeSmartLastMessages(memory, threadId, sc.cfg, resourceId);

      const ok =
        result.countInWindow === sc.expected.countInWindow &&
        result.resolved === sc.expected.resolved &&
        result.reason === sc.expected.reason;

      const status = ok ? "✓ PASS" : "✗ FAIL";
      const tokSuffix = result.estimatedTokens !== undefined ? ` est_tokens=${result.estimatedTokens}` : "";
      process.stdout.write(
        `  ${status} got: countInWindow=${result.countInWindow} resolved=${result.resolved} reason=${result.reason}${tokSuffix}\n`,
      );
      if (!ok) {
        process.stdout.write(
          `         expected: countInWindow=${sc.expected.countInWindow} resolved=${sc.expected.resolved} reason=${sc.expected.reason}\n`,
        );
        failed++;
      } else {
        passed++;
      }
    } catch (err) {
      process.stdout.write(`  ✗ ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
      if (err instanceof Error && err.stack) {
        process.stdout.write(`    ${err.stack.split("\n").slice(1, 4).join("\n    ")}\n`);
      }
      failed++;
    }
    process.stdout.write("\n");
  }

  console.log("─".repeat(60));
  console.log(`Results: ${passed}/${scenarios.length} passed${failed > 0 ? `, ${failed} failed` : ""}`);
  console.log("─".repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
