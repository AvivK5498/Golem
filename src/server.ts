import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "yaml";
import { config, expandEnvVars } from "./config.js";
import { logger } from "./utils/external-logger.js";
import { getPromptTraceById, listPromptTraces } from "./agent/prompt-trace.js";
import { allTools } from "./agent/tools/index.js";
import { getMCPTools } from "./agent/mcp-client.js";
import { loadSkills, parseFrontmatter } from "./skills/loader.js";
import { dataPath, getSkillsDir } from "./utils/paths.js";
import { randomUUID } from "node:crypto";
import type { JobQueue } from "./scheduler/job-queue.js";
import type { CronStore } from "./scheduler/cron-store.js";
import type { FeedStore } from "./feed/feed-store.js";

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

interface ServerDeps {
  startedAt: number;
  onWebhookMessage?: (text: string, source: string, requestId: string) => Promise<string>;
  jobQueue?: JobQueue;
  cronStore?: CronStore;
  feedStore?: FeedStore;
  registry?: import("./platform/agent-registry.js").AgentRegistry;
  agentStore?: import("./platform/agent-store.js").AgentStore;
  transports?: import("./platform/transport-manager.js").TransportManager;
  agentSettings?: import("./platform/agent-settings.js").AgentSettings;
  proactiveChecker?: { reschedule(agentId: string): void };
  subAgentRegistry?: { rebuild(agentId: string): void };
  port?: number;
  webhookConfig?: {
    enabled: boolean;
    token?: string;
    maxAuthFailures?: number;
    authWindowMs?: number;
  };
}

// ── OpenRouter models cache ─────────────────────────────
let cachedModels: { id: string; name: string; contextLength: number }[] | null = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL_MS = 3_600_000;

async function fetchOpenRouterModels(): Promise<{ id: string; name: string; contextLength: number }[]> {
  const now = Date.now();
  if (cachedModels && now - modelsCacheTime < MODELS_CACHE_TTL_MS) return cachedModels;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const resp = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error(`OpenRouter API error: ${resp.status}`);
  const data = await resp.json() as { data: Array<{ id: string; name: string; context_length: number }> };
  const models = data.data
    .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
    .sort((a, b) => a.id.localeCompare(b.id));
  cachedModels = models;
  modelsCacheTime = now;
  return models;
}

// ── Log viewer helpers ──────────────────────────────────
const DEFAULT_LOGS_DIR = dataPath("logs");
const getLogsDir = () => process.env.LOGS_DIR || DEFAULT_LOGS_DIR;

function loadLabels(logsDir: string): Record<string, unknown> {
  const labelsPath = path.join(logsDir, "labels.json");
  try { if (fs.existsSync(labelsPath)) return JSON.parse(fs.readFileSync(labelsPath, "utf-8")); } catch { /* ignore */ }
  return {};
}
function saveLabel(logsDir: string, id: string, label: string): void {
  const labelsPath = path.join(logsDir, "labels.json");
  const labels = loadLabels(logsDir);
  labels[id] = label;
  fs.writeFileSync(labelsPath, JSON.stringify(labels, null, 2), "utf-8");
}
function loadPins(logsDir: string): string[] {
  const labels = loadLabels(logsDir);
  return Array.isArray(labels._pins) ? labels._pins as string[] : [];
}
function togglePin(logsDir: string, id: string): boolean {
  const labelsPath = path.join(logsDir, "labels.json");
  const labels = loadLabels(logsDir);
  const pins: string[] = Array.isArray(labels._pins) ? labels._pins as string[] : [];
  const idx = pins.indexOf(id);
  if (idx >= 0) pins.splice(idx, 1); else pins.push(id);
  labels._pins = pins;
  fs.writeFileSync(labelsPath, JSON.stringify(labels, null, 2), "utf-8");
  return idx < 0;
}
function countLinesFromBuffer(buf: Buffer): number {
  if (buf.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < buf.length; i++) { if (buf[i] === 0x0a) count++; }
  if (buf[buf.length - 1] !== 0x0a) count++;
  return count;
}
function tailLines(buf: Buffer, n: number): string {
  const text = buf.toString("utf-8");
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= n) return lines.join("\n");
  return lines.slice(-n).join("\n");
}

// Rate limiter for webhook auth failures
const authFailures: Array<number> = [];

// Webhook dedup: track recent payload hashes per agent:source to skip duplicates.
const WEBHOOK_DEDUP_TTL_MS = 300_000; // 5 minutes (Strava retries at ~2min intervals)
const webhookDedup = new Map<string, number>(); // key → timestamp

function webhookDedupKey(agentId: string, source: string, body: string): string {
  // Try to extract a stable ID from the payload for smarter dedup.
  // Strava uses object_id, GitHub uses action+id, generic falls back to body hash.
  try {
    const payload = JSON.parse(body);
    const stableId = payload.object_id || payload.id || payload.delivery || payload.event_id;
    if (stableId) return `${agentId}:${source}:${stableId}`;
  } catch { /* not JSON, fall through */ }

  // Fallback: FNV-1a hash of the full body
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `${agentId}:${source}:${h}`;
}

function isWebhookDuplicate(key: string): boolean {
  const now = Date.now();
  // Prune stale entries periodically
  if (webhookDedup.size > 500) {
    for (const [k, ts] of webhookDedup) {
      if (now - ts > WEBHOOK_DEDUP_TTL_MS) webhookDedup.delete(k);
    }
  }
  const seen = webhookDedup.get(key);
  if (seen && now - seen < WEBHOOK_DEDUP_TTL_MS) return true;
  webhookDedup.set(key, now);
  return false;
}

export function startServer(deps: ServerDeps) {
  const { startedAt } = deps;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${config.serverPort}`);
    const { pathname } = url;

    // GET /status — health check (simple)
    if (req.method === "GET" && pathname === "/status") {
      return json(res, { status: "ok", uptime: Math.floor((Date.now() - startedAt) / 1000) });
    }

    // ── Setup / Onboarding ─────────────────────────────────
    if (req.method === "GET" && pathname === "/api/setup/status") {
      const hasApiKey = !!process.env.OPENROUTER_API_KEY;
      const agentCount = deps.agentStore?.count() || 0;
      const hasTiers = !!(deps.agentSettings?.getGlobalTiers());
      return json(res, {
        configured: hasApiKey && agentCount > 0,
        hasApiKey,
        agentCount,
        hasTiers,
      });
    }

    if (req.method === "POST" && pathname === "/api/setup") {
      try {
        const body = JSON.parse(await readBody(req));
        const envPath = path.resolve(".env");

        // 1. Write API key to .env
        if (body.openrouterApiKey) {
          let envContent = "";
          try { envContent = fs.readFileSync(envPath, "utf-8"); } catch { /* file doesn't exist yet */ }

          // Replace or append OPENROUTER_API_KEY
          if (envContent.includes("OPENROUTER_API_KEY=")) {
            envContent = envContent.replace(/^[#\s]*OPENROUTER_API_KEY=.*/gm, `OPENROUTER_API_KEY=${body.openrouterApiKey}`);
          } else {
            envContent += `${envContent && !envContent.endsWith("\n") ? "\n" : ""}OPENROUTER_API_KEY=${body.openrouterApiKey}\n`;
          }

          // Write Groq API key if provided
          if (body.groqApiKey) {
            if (envContent.includes("GROQ_API_KEY=")) {
              envContent = envContent.replace(/^[#\s]*GROQ_API_KEY=.*/gm, `GROQ_API_KEY=${body.groqApiKey}`);
            } else {
              envContent += `GROQ_API_KEY=${body.groqApiKey}\n`;
            }
          }

          // Write bot token if provided
          if (body.telegram?.botToken) {
            const tokenVar = body.telegram.botTokenVar || "TELEGRAM_BOT_TOKEN";
            if (envContent.includes(`${tokenVar}=`)) {
              envContent = envContent.replace(new RegExp(`^[#\\s]*${tokenVar}=.*`, "gm"), `${tokenVar}=${body.telegram.botToken}`);
            } else {
              envContent += `${tokenVar}=${body.telegram.botToken}\n`;
            }
          }

          fs.writeFileSync(envPath, envContent, "utf-8");
          // Set in current process so immediate API calls work
          process.env.OPENROUTER_API_KEY = body.openrouterApiKey;
          if (body.telegram?.botToken) {
            process.env[body.telegram.botTokenVar || "TELEGRAM_BOT_TOKEN"] = body.telegram.botToken;
          }
          if (body.groqApiKey) {
            process.env.GROQ_API_KEY = body.groqApiKey;
          }
        }

        // 2. Enable whisper if Groq key provided
        if (body.groqApiKey && deps.agentSettings) {
          deps.agentSettings.setGlobal("global.whisper.enabled", "true");
          deps.agentSettings.setGlobal("global.whisper.apiKey", "${GROQ_API_KEY}");
          deps.agentSettings.setGlobal("global.whisper.endpoint", "https://api.groq.com/openai/v1/audio/transcriptions");
          deps.agentSettings.setGlobal("global.whisper.model", "whisper-large-v3-turbo");
        }

        // 3. Write tiers to config.yaml
        if (body.tiers) {
          const configPath = path.resolve("config.yaml");
          let appConfig: Record<string, unknown> = {};
          try { appConfig = yaml.parse(fs.readFileSync(configPath, "utf-8")) || {}; } catch { /* no config yet */ }
          if (!appConfig.llm) appConfig.llm = {};
          (appConfig.llm as Record<string, unknown>).tiers = body.tiers;
          fs.writeFileSync(configPath, yaml.stringify(appConfig), "utf-8");
        }

        // 3. Create first agent if provided
        if (body.agent && deps.agentStore) {
          const agentId = body.agent.name
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "");

          const botTokenVar = body.telegram?.botTokenVar || "TELEGRAM_BOT_TOKEN";

          const agentConfig = {
            id: agentId,
            name: body.agent.name,
            description: body.agent.description || "",
            ownerName: body.agent.ownerName || "the user",
            role: "personal assistant",
            enabled: true,
            transport: {
              platform: "telegram" as const,
              botToken: `\${${botTokenVar}}`,
              ownerId: body.telegram?.ownerId || 0,
            },
            llm: {
              provider: "openrouter",
              tier: (body.agent.tier || "low") as "low" | "med" | "high",
              override: null,
              temperature: 0.2,
              maxSteps: 30,
              reasoningEffort: "medium" as const,
            },
            memory: {
              lastMessages: 12,
              semanticRecall: false,
              workingMemory: { enabled: true, scope: "resource" as const },
            },
            tools: body.agent.tools || ["cron", "send_media"],
            mcpServers: body.agent.mcpServers || [],
            skills: body.agent.skills || [],
            allowedGroups: [],
            adminGroups: [],
          };

          // Generate persona (best-effort)
          let persona: string | null = null;
          let memoryTemplate: string | null = null;
          if (body.agent.description) {
            try {
              const personaRes = await fetch(`http://localhost:${config.serverPort}/api/platform/agents/generate-persona`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: body.agent.name,
                  description: body.agent.description,
                  role: "personal assistant",
                  ownerName: body.ownerName,
                  ownerRole: body.ownerRole,
                }),
              });
              if (personaRes.ok) {
                const result = await personaRes.json() as { persona?: string; memoryTemplate?: string };
                persona = result.persona || null;
                memoryTemplate = result.memoryTemplate || null;
              }
            } catch { /* persona generation is best-effort */ }
          }

          deps.agentStore.upsert(agentId, agentConfig as import("./platform/schemas.js").AgentRegistryConfig, {
            persona,
            memoryTemplate,
            subAgents: { agents: {}, defaults: { instructions: "Complete the task and return results only." } },
          });
        }

        return json(res, { ok: true, message: "Setup complete. Restart the platform to apply changes." }, 201);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }

    // ── Prompt trace endpoints ────────────────────────────
    if (req.method === "GET" && pathname === "/api/prompt-traces") {
      const limit = Number(url.searchParams.get("limit")) || 30;
      return json(res, { traces: listPromptTraces(limit) });
    }
    if (req.method === "GET" && pathname === "/api/prompt-traces/latest") {
      return json(res, { trace: listPromptTraces(1)[0] || null });
    }
    if (req.method === "GET" && pathname.startsWith("/api/prompt-traces/")) {
      const id = decodeURIComponent(pathname.slice("/api/prompt-traces/".length));
      const trace = getPromptTraceById(id);
      if (!trace) return json(res, { error: "not found" }, 404);
      return json(res, { trace });
    }

    // ── Health (detailed) ─────────────────────────────────
    if (req.method === "GET" && pathname === "/api/health") {
      const uptimeMs = Date.now() - startedAt;
      const mem = process.memoryUsage();
      return json(res, {
        uptime: uptimeMs,
        uptimeHuman: `${Math.floor(uptimeMs / 3_600_000)}h ${Math.floor((uptimeMs % 3_600_000) / 60_000)}m`,
        memory: {
          rss: Math.round(mem.rss / 1_048_576),
          heap: Math.round(mem.heapUsed / 1_048_576),
          heapTotal: Math.round(mem.heapTotal / 1_048_576),
        },
      });
    }

    // ── Feed ──────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/api/feed" && deps.feedStore) {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
      const status = url.searchParams.get("status") || "all";
      const agentId = url.searchParams.get("agent_id") || "all";
      const sinceParam = url.searchParams.get("since");
      const since = sinceParam ? parseInt(sinceParam) : undefined;
      return json(res, {
        entries: deps.feedStore.list(agentId, { limit, status, since }),
        counts: deps.feedStore.counts(agentId, since),
        tokens: deps.feedStore.tokenSummary(agentId, since),
      });
    }

    // ── Jobs ──────────────────────────────────────────────
    if (req.method === "GET" && pathname === "/api/jobs" && deps.jobQueue) {
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
      return json(res, {
        jobs: deps.jobQueue.listAll(limit),
        counts: { queued: deps.jobQueue.getQueuedCount(), running: deps.jobQueue.getRunningCount() },
      });
    }
    const jobRetryMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);
    if (req.method === "POST" && jobRetryMatch && deps.jobQueue) {
      const jobId = jobRetryMatch[1];
      try {
        deps.jobQueue.requeueForRetry(jobId);
        return json(res, { ok: true });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }

    // ── Restart ───────────────────────────────────────────
    if (req.method === "POST" && pathname === "/api/restart") {
      const restartFn = (globalThis as Record<string, unknown>).__golem_request_restart as (() => void) | undefined;
      if (restartFn) {
        json(res, { ok: true, note: "Restarting..." });
        setTimeout(() => restartFn(), 500);
        return;
      }
      return json(res, { error: "Restart not available" }, 503);
    }

    // ── Models (OpenRouter) ───────────────────────────────
    if (req.method === "GET" && pathname === "/api/models") {
      try {
        const models = await fetchOpenRouterModels();
        return json(res, { models });
      } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 500); }
    }

    // ── Available tools ───────────────────────────────────
    if (req.method === "GET" && pathname === "/api/available-tools") {
      return json(res, { tools: [...Object.keys(allTools), ...Object.keys(getMCPTools())] });
    }

    // ── Available skills ──────────────────────────────────
    if (req.method === "GET" && pathname === "/api/available-skills") {
      try {
        // Scan both the custom skills dir and the default one (if different)
        const skillsDir = getSkillsDir();
        const defaultSkillsDir = path.resolve("skills");
        const dirs = skillsDir !== defaultSkillsDir ? [skillsDir, defaultSkillsDir] : [skillsDir];
        const allSkills = loadSkills(dirs);

        // Build usedBy map: skill name → agent IDs that have it enabled
        const usedByMap: Record<string, string[]> = {};
        if (deps.registry) {
          for (const agent of deps.registry.getAll()) {
            for (const skillName of agent.skills ?? []) {
              if (!usedByMap[skillName]) usedByMap[skillName] = [];
              usedByMap[skillName].push(agent.id);
            }
          }
        }

        const skills = allSkills.map((s) => {
          // Read frontmatter to get requirements
          let requires: { env?: string[]; bins?: string[] } = {};
          try {
            const content = fs.readFileSync(s.filePath, "utf-8");
            const meta = parseFrontmatter(content);
            if (meta?.requires) requires = meta.requires;
            if (meta?.metadata?.extended?.requires) {
              requires = {
                env: [...(requires.env ?? []), ...(meta.metadata.extended.requires.env ?? [])],
                bins: [...(requires.bins ?? []), ...(meta.metadata.extended.requires.bins ?? [])],
              };
            }
          } catch { /* ignore */ }

          return {
            name: s.name,
            description: s.description,
            eligible: s.eligible,
            requires,
            usedBy: usedByMap[s.name] ?? [],
          };
        });
        return json(res, { skills });
      } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 500); }
    }

    // ── Crons CRUD ────────────────────────────────────────
    if (req.method === "GET" && pathname === "/api/crons" && deps.cronStore) {
      try {
        const agentId = url.searchParams.get("agent_id") || undefined;
        return json(res, { crons: deps.cronStore.listCrons(agentId) });
      } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 500); }
    }

    const cronIdMatch = pathname.match(/^\/api\/crons\/(\d+)$/);
    if (req.method === "GET" && cronIdMatch && deps.cronStore) {
      const cron = deps.cronStore.getCronById(Number(cronIdMatch[1]));
      if (!cron) return json(res, { error: "Cron not found" }, 404);
      return json(res, { cron });
    }
    if (req.method === "POST" && pathname === "/api/crons" && deps.cronStore) {
      const body = await readBody(req);
      try {
        const input = JSON.parse(body);
        const schedule = input.schedule || (input.cron_expr ? { kind: "cron", value: input.cron_expr } : {});
        const taskDef = input.task || { kind: input.task_kind, message: input.description };
        const delivery = input.delivery || {};
        const cronAgentId = input.agent_id || deps.agentSettings?.getDefaultAgent() || "default";
        const agentConfig = deps.registry?.get(cronAgentId);
        const ownerId = agentConfig?.transport?.ownerId;
        let targetJid: string | undefined;
        if (delivery.to === "owner" || !delivery.to) {
          if (ownerId) targetJid = String(ownerId);
        } else {
          targetJid = String(delivery.to);
        }
        const platform = delivery.channel || "telegram";

        if (schedule.kind === "cron") {
          const { CronExpressionParser } = await import("cron-parser");
          try { CronExpressionParser.parse(schedule.value); } catch {
            return json(res, { error: `Invalid cron expression: ${schedule.value}` }, 400);
          }
          const cron = deps.cronStore.addCron(input.agent_id || deps.agentSettings?.getDefaultAgent() || "default", {
            name: input.name || taskDef.message || "API cron",
            description: taskDef.message || input.name || "API cron",
            cronExpr: schedule.value,
            taskKind: taskDef.kind || "agent_turn",
            targetJid,
            platform,
          });
          return json(res, { cron }, 201);
        }
        return json(res, { error: "Only cron scheduling is supported" }, 400);
      } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 400); }
    }
    if (req.method === "PUT" && cronIdMatch && deps.cronStore) {
      const body = await readBody(req);
      try {
        const input = JSON.parse(body);
        const id = Number(cronIdMatch[1]);
        const existing = deps.cronStore.getCronById(id);
        if (!existing) return json(res, { error: "Cron not found" }, 404);
        const agentId = existing.agent_id || deps.agentSettings?.getDefaultAgent() || "default";
        const fields: Record<string, unknown> = {};
        if (input.name !== undefined) fields.name = input.name;
        if (input.description !== undefined) fields.description = input.description;
        if (input.task_kind !== undefined) fields.task_kind = input.task_kind;
        if (typeof input.paused === "boolean") fields.paused = input.paused;
        if (input.cron_expr) fields.cron_expr = input.cron_expr;
        else if (input.schedule?.kind === "cron") fields.cron_expr = input.schedule.value;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic field mapping from API input
        if (Object.keys(fields).length > 0) deps.cronStore.updateCron(agentId, id, fields as any);
        return json(res, { cron: deps.cronStore.getCronById(id) });
      } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 400); }
    }
    if (req.method === "DELETE" && cronIdMatch && deps.cronStore) {
      const existing = deps.cronStore.getCronById(Number(cronIdMatch[1]));
      if (!existing) return json(res, { error: "Cron not found" }, 404);
      const ok = deps.cronStore.deleteCron(existing.agent_id || deps.agentSettings?.getDefaultAgent() || "default", existing.id);
      if (!ok) return json(res, { error: "Delete failed" }, 500);
      return json(res, { ok: true });
    }
    // Run a cron job immediately
    const cronRunMatch = pathname.match(/^\/api\/crons\/(\d+)\/run$/);
    if (req.method === "POST" && cronRunMatch && deps.cronStore) {
      const cron = deps.cronStore.getCronById(Number(cronRunMatch[1]));
      if (!cron) return json(res, { error: "Cron not found" }, 404);
      // Mark as run now (set next_run_at to now so the scheduler picks it up on next tick)
      deps.cronStore.updateCron(cron.agent_id || deps.agentSettings?.getDefaultAgent() || "default", cron.id, {
        next_run_at: Date.now(),
      });
      return json(res, { ok: true, message: "Cron scheduled to run on next tick" });
    }

    // ── Logs viewer ───────────────────────────────────────
    if (req.method === "GET" && pathname === "/api/logs") {
      try {
        const logsDir = getLogsDir();
        if (!fs.existsSync(logsDir)) return json(res, { endpoints: [] });
        const SKIP_DIRS = new Set(["test", "manual-test"]);
        const labels = loadLabels(logsDir) as Record<string, string>;
        const pins = loadPins(logsDir);
        const pinSet = new Set(pins);
        const now = Date.now();
        const LIVE_THRESHOLD = 60_000;
        const entries = fs.readdirSync(logsDir, { withFileTypes: true });
        const endpoints: Array<{ id: string; label: string; dates: string[]; hasLive: boolean; pinned: boolean }> = [];
        for (const entry of entries) {
          if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
          const epDir = path.join(logsDir, entry.name);
          const dateEntries = fs.readdirSync(epDir, { withFileTypes: true });
          const dates: string[] = [];
          let hasLive = false;
          for (const de of dateEntries) {
            if (!de.isDirectory()) continue;
            dates.push(de.name);
            if (!hasLive) {
              const files = fs.readdirSync(path.join(epDir, de.name));
              for (const f of files) {
                if (f.startsWith("_launchd_")) continue;
                const stat = fs.statSync(path.join(epDir, de.name, f));
                if (now - stat.mtimeMs < LIVE_THRESHOLD) { hasLive = true; break; }
              }
            }
          }
          dates.sort((a, b) => b.localeCompare(a));
          endpoints.push({ id: entry.name, label: labels[entry.name] || entry.name, dates, hasLive, pinned: pinSet.has(entry.name) });
        }
        endpoints.sort((a, b) => {
          if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
          if (a.hasLive !== b.hasLive) return a.hasLive ? -1 : 1;
          return (b.dates[0] || "").localeCompare(a.dates[0] || "");
        });
        return json(res, { endpoints });
      } catch (e) { return json(res, { error: "Failed to list logs", detail: String(e) }, 500); }
    }

    const logsLabelMatch = pathname.match(/^\/api\/logs\/([a-zA-Z0-9_-]+)\/label$/);
    if (req.method === "PUT" && logsLabelMatch) {
      const body = await readBody(req);
      try {
        const { label } = JSON.parse(body);
        if (!label || typeof label !== "string") return json(res, { error: "label required" }, 400);
        saveLabel(getLogsDir(), logsLabelMatch[1], label.trim());
        return json(res, { ok: true });
      } catch { return json(res, { error: "Invalid request" }, 400); }
    }

    const logsPinMatch = pathname.match(/^\/api\/logs\/([a-zA-Z0-9_-]+)\/pin$/);
    if (req.method === "POST" && logsPinMatch) {
      try {
        const pinned = togglePin(getLogsDir(), logsPinMatch[1]);
        return json(res, { ok: true, pinned });
      } catch { return json(res, { error: "Failed to toggle pin" }, 500); }
    }

    const logsDateMatch = pathname.match(/^\/api\/logs\/([a-zA-Z0-9_-]+)\/(\d{4}-\d{2}-\d{2})$/);
    if (req.method === "GET" && logsDateMatch) {
      try {
        const logsDir = getLogsDir();
        const dirPath = path.resolve(path.join(logsDir, logsDateMatch[1], logsDateMatch[2]));
        if (!dirPath.startsWith(path.resolve(logsDir))) return json(res, { error: "Forbidden" }, 403);
        if (!fs.existsSync(dirPath)) return json(res, { files: [] });
        const now = Date.now();
        const LIVE_THRESHOLD = 60_000;
        const fileEntries = fs.readdirSync(dirPath);
        const files: Array<{ name: string; size: number; modifiedAt: number; live: boolean; lines: number }> = [];
        for (const name of fileEntries) {
          if (name.startsWith("_launchd_")) continue;
          const filePath = path.join(dirPath, name);
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) continue;
          files.push({ name, size: stat.size, modifiedAt: stat.mtimeMs, live: now - stat.mtimeMs < LIVE_THRESHOLD, lines: countLinesFromBuffer(fs.readFileSync(filePath)) });
        }
        files.sort((a, b) => { if (a.live !== b.live) return a.live ? -1 : 1; return b.modifiedAt - a.modifiedAt; });
        return json(res, { files });
      } catch (e) { return json(res, { error: "Failed to list log files", detail: String(e) }, 500); }
    }

    const logsFileMatch = pathname.match(/^\/api\/logs\/([a-zA-Z0-9_-]+)\/(\d{4}-\d{2}-\d{2})\/(.+)$/);
    if (req.method === "GET" && logsFileMatch) {
      try {
        const logsDir = getLogsDir();
        const filePath = path.resolve(path.join(logsDir, logsFileMatch[1], logsFileMatch[2], logsFileMatch[3]));
        if (!filePath.startsWith(path.resolve(logsDir))) return json(res, { error: "Forbidden" }, 403);
        if (!fs.existsSync(filePath)) return json(res, { error: "File not found" }, 404);
        const buf = fs.readFileSync(filePath);
        const totalLines = countLinesFromBuffer(buf);
        const full = url.searchParams.get("full") === "true";
        const tail = parseInt(url.searchParams.get("tail") || "200");
        const content = full ? buf.toString("utf-8") : tailLines(buf, tail);
        return json(res, { content, totalLines, file: logsFileMatch[3] });
      } catch (e) { return json(res, { error: "Failed to read log file", detail: String(e) }, 500); }
    }

    // GET /prompt-explorer — prompt observability page
    if (req.method === "GET" && pathname === "/prompt-explorer") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Prompt Explorer</title>
<style>:root{color-scheme:dark}body{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0b0f14;color:#d8e1ea}header{padding:12px 16px;border-bottom:1px solid #1f2a36;display:flex;justify-content:space-between;align-items:center}.wrap{display:grid;grid-template-columns:420px 1fr;height:calc(100vh - 49px)}.list{border-right:1px solid #1f2a36;overflow:auto}.item{padding:10px 12px;border-bottom:1px solid #16202a;cursor:pointer}.item:hover{background:#111823}.item.active{background:#142033}.meta{color:#8fa5bd;font-size:12px}.detail{overflow:auto;padding:12px}pre{white-space:pre-wrap;word-wrap:break-word;background:#0f1620;border:1px solid #1f2a36;padding:10px;border-radius:8px}.row{margin-bottom:10px}.pill{display:inline-block;padding:2px 7px;border:1px solid #2d3e52;border-radius:999px;margin-right:6px;font-size:12px;color:#a9c1da}.ok{color:#7ee787}.fail{color:#ff7b72}.run{color:#d2a8ff}button{background:#1f6feb;color:white;border:0;border-radius:6px;padding:6px 10px;cursor:pointer}button:hover{background:#388bfd}</style></head>
<body><header><div><strong>Prompt Explorer</strong> <span id="count" class="meta"></span></div><div><button id="refresh">Refresh</button><span class="meta" id="updated"></span></div></header>
<div class="wrap"><div class="list" id="list"></div><div class="detail" id="detail"><div class="meta">No prompt trace yet.</div></div></div>
<script>const listEl=document.getElementById("list"),detailEl=document.getElementById("detail"),countEl=document.getElementById("count"),updatedEl=document.getElementById("updated"),refreshBtn=document.getElementById("refresh");let traces=[],selectedId=null;function esc(s){return String(s||"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}function statusClass(s){return s==="completed"?"ok":s==="failed"?"fail":"run"}function renderList(){listEl.innerHTML=traces.map(t=>'<div class="item '+(t.id===selectedId?"active":"")+'" data-id="'+esc(t.id)+'"><div><span class="pill">'+esc(t.chatType||"unknown")+'</span><span class="pill">'+esc(t.promptMode||"full")+'</span><span class="'+statusClass(t.status)+'">'+esc(t.status)+'</span></div><div>'+esc((t.instructions||"").slice(0,90))+'</div><div class="meta">'+esc(t.createdAt)+" · "+esc(t.model||"n/a")+"</div></div>").join("");listEl.querySelectorAll(".item").forEach(el=>{el.addEventListener("click",()=>{selectedId=el.getAttribute("data-id");renderList();renderDetail()})})}function renderDetail(){const t=traces.find(x=>x.id===selectedId)||traces[0];if(!t){detailEl.innerHTML='<div class="meta">No prompt trace yet.</div>';return}selectedId=t.id;const msgs=(t.messages||[]).map(m=>"["+m.role+"]\\n"+m.content).join("\\n\\n"),ctx=(t.contextMessages||[]).map(m=>"["+m.role+"]\\n"+m.content).join("\\n\\n");detailEl.innerHTML='<div class="row"><span class="pill">'+esc(t.id)+'</span><span class="'+statusClass(t.status)+'">'+esc(t.status)+'</span></div><div class="row meta">platform='+esc(t.platform||"n/a")+" · jid="+esc(t.jid||"n/a")+" · duration="+esc(t.durationMs||"n/a")+"ms · finish="+esc(t.finishReason||"n/a")+'</div><div class="row"><strong>Tools</strong><pre>'+esc((t.tools||[]).join(", "))+'</pre></div><div class="row"><strong>Instructions</strong><pre>'+esc(t.instructions||"")+'</pre></div><div class="row"><strong>Messages</strong><pre>'+esc(msgs)+'</pre></div><div class="row"><strong>Context</strong><pre>'+esc(ctx||"(none)")+'</pre></div><div class="row"><strong>Memory</strong><pre>'+esc(JSON.stringify(t.memory||{},null,2))+'</pre></div><div class="row"><strong>Result</strong><pre>'+esc(t.resultPreview||t.error||"(none)")+"</pre></div>"}async function load(){const r=await fetch("/api/prompt-traces?limit=100"),data=await r.json();traces=data.traces||[];if(!selectedId&&traces[0])selectedId=traces[0].id;countEl.textContent=traces.length?"("+traces.length+" traces)":"(no traces)";updatedEl.textContent=" updated "+new Date().toLocaleTimeString();renderList();renderDetail()}refreshBtn.addEventListener("click",load);load();setInterval(load,2000)</script></body></html>`);
      return;
    }

    // ── Platform Agent API ─────────────────────────────────────

    // ── Platform agent settings (SQLite-backed) ───────────────
    const agentSettingsMatch = pathname.match(/^\/api\/platform\/agents\/([a-z0-9-]+)\/settings$/);

    if (req.method === "GET" && agentSettingsMatch && deps.agentSettings) {
      const agentId = agentSettingsMatch[1];
      const all = deps.agentSettings.getAll(agentId);
      const obj: Record<string, string> = {};
      for (const [k, v] of all) obj[k] = v;
      // Compute resolved model from active tier + tiers map
      const activeTier = obj["model_tier"] || null;
      const baseModel = obj["llm.model"] || "";
      let resolvedModel = baseModel;
      if (activeTier && activeTier !== "default" && obj["llm.tiers"]) {
        try {
          const tiers = JSON.parse(obj["llm.tiers"]);
          if (tiers[activeTier]) resolvedModel = tiers[activeTier];
        } catch { /* use base model */ }
      }
      obj["_resolvedModel"] = resolvedModel;
      return json(res, obj);
    }

    if (req.method === "PATCH" && agentSettingsMatch && deps.agentSettings) {
      const agentId = agentSettingsMatch[1];
      try {
        const body = JSON.parse(await readBody(req));
        for (const [key, value] of Object.entries(body)) {
          deps.agentSettings.setSetting(agentId, key, value);
        }
        // Reschedule proactive timer if proactive settings changed
        if (deps.proactiveChecker && Object.keys(body).some((k: string) => k.startsWith("proactive."))) {
          deps.proactiveChecker.reschedule(agentId);
        }
        return json(res, { ok: true });
      } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 400); }
    }

    // ── Webhook Scenario CRUD ──────────────────────────────────
    const webhookScenariosMatch = pathname.match(
      /^\/api\/platform\/agents\/([a-z0-9-]+)\/webhook-scenarios(?:\/([a-z0-9-]+))?$/,
    );

    if (webhookScenariosMatch && deps.agentSettings) {
      const [, agentId, source] = webhookScenariosMatch;
      const { listAllScenarios, scenarioKey } = await import("./platform/webhook-router.js");
      const store = deps.agentSettings.getStore();

      // GET /api/platform/agents/{id}/webhook-scenarios — list all sources
      if (req.method === "GET" && !source) {
        return json(res, { sources: listAllScenarios(agentId, store) });
      }

      // GET /api/platform/agents/{id}/webhook-scenarios/{source} — list scenarios for source
      if (req.method === "GET" && source) {
        const raw = store.get(agentId, scenarioKey(source));
        return json(res, raw ? JSON.parse(raw) : []);
      }

      // PUT /api/platform/agents/{id}/webhook-scenarios/{source} — save scenarios
      if (req.method === "PUT" && source) {
        try {
          const body = JSON.parse(await readBody(req));
          if (!Array.isArray(body)) return json(res, { error: "Body must be an array of scenarios" }, 400);
          store.set(agentId, scenarioKey(source), JSON.stringify(body));
          return json(res, { ok: true });
        } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 400); }
      }

      // DELETE /api/platform/agents/{id}/webhook-scenarios/{source} — delete source
      if (req.method === "DELETE" && source) {
        store.delete(agentId, scenarioKey(source));
        return json(res, { ok: true });
      }
    }

    // ── Last webhook payload (for field discovery) ─────────────
    const lastPayloadMatch = pathname.match(
      /^\/api\/platform\/agents\/([a-z0-9-]+)\/webhook-last-payload\/([a-z0-9-]+)$/,
    );
    if (req.method === "GET" && lastPayloadMatch && deps.agentSettings) {
      const [, agentId, source] = lastPayloadMatch;
      const raw = deps.agentSettings.getStore().get(agentId, `webhook.last_payload.${source}`);
      if (!raw) return json(res, { payload: null, fields: [] });
      try {
        const payload = JSON.parse(raw);
        // Extract all field paths (dot-notation) for the UI field picker
        const fields: string[] = [];
        function walk(obj: unknown, prefix: string) {
          if (obj === null || obj === undefined || typeof obj !== "object") return;
          for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
            const path = prefix ? `${prefix}.${key}` : key;
            fields.push(path);
            if (val && typeof val === "object" && !Array.isArray(val)) {
              walk(val, path);
            }
          }
        }
        walk(payload, "");
        return json(res, { payload, fields });
      } catch {
        return json(res, { payload: null, fields: [] });
      }
    }

    // ── Create new agent ───────────────────────────────────
    if (req.method === "POST" && pathname === "/api/platform/agents" && deps.agentStore) {
      const body = await readBody(req);
      try {
        const input = JSON.parse(body);
        const id = input.id;
        if (!id || !/^[a-z0-9-]+$/.test(id)) {
          return json(res, { error: "Invalid agent id (lowercase alphanumeric with hyphens)" }, 400);
        }
        if (deps.agentStore.exists(id)) {
          return json(res, { error: `Agent "${id}" already exists` }, 409);
        }

        // If a real bot token was provided (not an env var reference), write it to .env
        const tokenVar = `${id.toUpperCase().replace(/-/g, "_")}_BOT_TOKEN`;
        let configBotToken = input.botToken || `\${${tokenVar}}`;
        if (input.botToken && !input.botToken.startsWith("${")) {
          try {
            const envPath = path.resolve(".env");
            let envContent = "";
            try { envContent = fs.readFileSync(envPath, "utf-8"); } catch { /* file doesn't exist */ }
            if (envContent.includes(`${tokenVar}=`)) {
              envContent = envContent.replace(new RegExp(`^[#\\s]*${tokenVar}=.*`, "gm"), `${tokenVar}=${input.botToken}`);
            } else {
              envContent += `${envContent && !envContent.endsWith("\n") ? "\n" : ""}${tokenVar}=${input.botToken}\n`;
            }
            fs.writeFileSync(envPath, envContent, "utf-8");
            process.env[tokenVar] = input.botToken;
            configBotToken = `\${${tokenVar}}`;
          } catch (envErr) {
            logger.warn(`Failed to write bot token to .env: ${envErr}`);
            // Fall through — store raw token in config as fallback
          }
        }

        const agentConfig = {
          id,
          name: input.name || id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " "),
          description: input.description || "",
          ...(input.characterName && { characterName: input.characterName }),
          ...(input.ownerName && { ownerName: input.ownerName }),
          ...(input.role && { role: input.role }),
          enabled: true,
          transport: {
            platform: "telegram" as const,
            botToken: configBotToken,
            ownerId: input.ownerId || 0,
          },
          llm: {
            provider: "openrouter",
            tier: (input.tier || "low") as "low" | "med" | "high",
            override: input.model || null, // if a specific model was provided, treat as override
            temperature: input.temperature ?? 0.2,
            maxSteps: input.maxSteps ?? 30,
            ...(input.reasoningEffort && { reasoningEffort: input.reasoningEffort }),
          },
          memory: {
            lastMessages: 12,
            semanticRecall: false,
            workingMemory: { enabled: true, scope: "resource" as const },
          },
          tools: input.tools || [],
          skills: input.skills || [],
          mcpServers: input.mcpServers || [],
          allowedGroups: [],
          adminGroups: [],
        };

        deps.agentStore.upsert(id, agentConfig as import("./platform/schemas.js").AgentRegistryConfig, {
          persona: input.persona || null,
          memoryTemplate: input.memoryTemplate || null,
          subAgents: { agents: {}, defaults: { instructions: "Complete the task and return results only." } },
        });

        logger.info(`Agent created: ${id}`, { agent: id });
        return json(res, { ok: true, id }, 201);
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }

    // ── Generate persona via LLM ─────────────────────────────
    if (req.method === "POST" && pathname === "/api/platform/agents/generate-persona") {
      const body = await readBody(req);
      try {
        const { name, description, role, behavior, ownerName, ownerRole } = JSON.parse(body);
        if (!name || !description) {
          return json(res, { error: "name and description are required" }, 400);
        }

        const { generateText } = await import("ai");
        const { getModelForId } = await import("./agent/model.js");
        const onboardingModel = deps.agentSettings?.getGlobalTiers()?.high || "anthropic/claude-sonnet-4-6";
        let agentContext = `Agent name: "${name}"\nAgent ID: "${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}"\nDescription: "${description}"${role ? `\nRole: "${role}"` : ""}`;
        if (ownerName) agentContext += `\nOwner name: "${ownerName}"`;
        if (ownerRole) agentContext += `\nOwner role: "${ownerRole}"`;
        if (behavior) {
          const styleParts: string[] = [];
          if (behavior.responseLength && behavior.responseLength !== "balanced") styleParts.push(`response length: ${behavior.responseLength}`);
          if (behavior.tone && behavior.tone !== "balanced") styleParts.push(`tone: ${behavior.tone}`);
          if (behavior.format && behavior.format !== "conversational") styleParts.push(`format: ${behavior.format}`);
          if (styleParts.length > 0) agentContext += `\nConfigured style: ${styleParts.join(", ")}`;
        }

        const [personaResult, memoryResult] = await Promise.all([
          generateText({
            model: getModelForId(onboardingModel),
            temperature: 0.7,
            maxOutputTokens: 1000,
            system: `You are an AI agent designer. Generate a persona file in markdown for a new AI assistant.
Use this structure: ## Identity (1-2 sentences), ## Boundaries (3-5 bullets), ## Notes (domain-specific).
Do NOT include a Tone & Style section — tone and response style are configured separately via behavior settings.
Be specific and tailored — avoid generic platitudes. Output ONLY the markdown content, no code fences.`,
            prompt: agentContext,
          }).catch(() => ({ text: "" })),
          generateText({
            model: getModelForId(onboardingModel),
            temperature: 0.7,
            maxOutputTokens: 1000,
            system: `You are an AI agent designer. Generate a working memory template in markdown for a Mastra AI agent.

Working memory is the agent's persistent scratchpad — key facts it keeps available about the user across conversations. The agent updates this via the updateWorkingMemory tool. Use labeled fields with empty placeholder hints in brackets.

Structure the template as a flat markdown document with these sections:
1. "User Profile" — name, role/occupation, and 2-3 domain-relevant personal facts
2. "Preferences" — communication style, preferred format, frequency, and domain-specific preferences (3-5 fields)
3. "Active Context" — current goals, ongoing projects, recent decisions (3-4 fields)
4. "Reflection" — patterns noticed, lessons learned, things to improve (2-3 fields)

Keep it concise: 10-15 fields total, each as a single "- **Label**: [hint]" line. Tailor fields to the agent's specific domain — avoid generic filler.
Output ONLY the markdown, no code fences.

<examples>
Example 1 — Fitness Coach:
# Working Memory

## User Profile
- **Name**: [first name]
- **Age/Height/Weight**: [if shared]
- **Activity Level**: [sedentary/moderate/active]
- **Injuries or Limitations**: [any physical constraints]

## Preferences
- **Communication Style**: [direct/encouraging/tough love]
- **Check-in Cadence**: [daily/weekly]
- **Preferred Workout Type**: [strength/cardio/mixed]
- **Dietary Approach**: [e.g., high protein, calorie counting]

## Active Context
- **Current Goal**: [e.g., lose 5kg, run a 5K]
- **Current Program**: [e.g., PPL 4x/week]
- **Recent Milestone**: [last achievement]

## Reflection
- **What's Working**: [effective strategies observed]
- **What Needs Adjustment**: [areas to improve]

Example 2 — Personal Assistant:
# Working Memory

## User Profile
- **Name**: [first name]
- **Role**: [job title / occupation]
- **Location/Timezone**: [city, TZ]

## Preferences
- **Communication Style**: [brief/detailed]
- **Preferred Language**: [en/he/auto]
- **Task Handling**: [execute immediately / ask first]

## Active Context
- **Current Projects**: [list of ongoing work]
- **Key Deadlines**: [upcoming dates]
- **Recent Decisions**: [choices made recently]

## Reflection
- **Patterns Noticed**: [recurring themes]
- **Lessons Learned**: [things to remember]
- **Improvement Areas**: [what to do better]

Example 3 — Study Tutor:
# Working Memory

## User Profile
- **Name**: [first name]
- **Level**: [high school/undergrad/grad]
- **Subject Focus**: [e.g., mathematics, history]

## Preferences
- **Explanation Style**: [step-by-step / high-level overview]
- **Practice Format**: [quizzes/worked examples/flashcards]
- **Session Length**: [short 15min / deep 45min]

## Active Context
- **Current Topic**: [what we're studying now]
- **Upcoming Exam**: [date and subject]
- **Weak Areas**: [concepts that need reinforcement]

## Reflection
- **Progress Observations**: [what's improving]
- **Recurring Mistakes**: [patterns in errors]
</examples>`,
            prompt: agentContext,
          }).catch(() => ({ text: "" })),
        ]);

        return json(res, {
          persona: personaResult.text.trim(),
          memoryTemplate: memoryResult.text.trim(),
        });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    // ── Generate / rotate webhook token ────────────────────
    if (req.method === "POST" && pathname === "/api/webhooks/generate-token" && deps.agentSettings) {
      try {
        const { randomBytes } = await import("node:crypto");
        const token = randomBytes(32).toString("hex");
        const envVar = "GOLEM_WEBHOOK_TOKEN";

        // Write to .env
        const envPath = path.resolve(".env");
        let envContent = "";
        try { envContent = fs.readFileSync(envPath, "utf-8"); } catch { /* file doesn't exist */ }
        if (envContent.includes(`${envVar}=`)) {
          envContent = envContent.replace(new RegExp(`^[#\\s]*${envVar}=.*`, "gm"), `${envVar}=${token}`);
        } else {
          envContent += `${envContent && !envContent.endsWith("\n") ? "\n" : ""}${envVar}=${token}\n`;
        }
        fs.writeFileSync(envPath, envContent, "utf-8");
        process.env[envVar] = token;

        // Save env var reference in global settings
        deps.agentSettings.setGlobal("global.webhooks.token", `\${${envVar}}`);
        deps.agentSettings.setGlobal("global.webhooks.enabled", "true");

        logger.info("Webhook token generated and saved to .env");
        return json(res, { ok: true, token, envVar });
      } catch (err) {
        return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
      }
    }

    // ── Detect user-installed binaries ───────────────────────
    if (req.method === "GET" && pathname === "/api/system/binaries") {
      // Scan directories where user-installed CLIs typically live
      const scanDirs = [
        path.join(os.homedir(), ".local", "bin"),  // pip --user, manual installs
        "/usr/local/bin",                           // Homebrew (Intel Mac), manual installs
      ];
      const seen = new Set<string>();
      const binaries: string[] = [];
      for (const dir of scanDirs) {
        try {
          const entries = fs.readdirSync(dir);
          for (const entry of entries) {
            // Skip dotfiles and files with extensions (config files, .sh/.fish scripts)
            if (!entry.startsWith(".") && !entry.includes(".") && !seen.has(entry)) {
              seen.add(entry);
              binaries.push(entry);
            }
          }
        } catch { /* directory doesn't exist */ }
      }
      binaries.sort();
      return json(res, { binaries, sources: scanDirs.map(d => d.replace(os.homedir(), "~")) });
    }

    // ── Global Settings ────────────────────────────────────
    if (req.method === "GET" && pathname === "/api/settings" && deps.agentSettings) {
      return json(res, deps.agentSettings.getAllGlobal());
    }

    if (req.method === "PATCH" && pathname === "/api/settings" && deps.agentSettings) {
      try {
        const body = JSON.parse(await readBody(req));
        for (const [key, value] of Object.entries(body)) {
          if (typeof value === "string") {
            deps.agentSettings.setGlobal(key, value);
          } else {
            deps.agentSettings.setGlobalJson(key, value);
          }
        }
        // Cascade global tiers to all agents (unless they have a per-agent override)
        if (body["global.llm.tiers"] && deps.registry) {
          const tiersJson = typeof body["global.llm.tiers"] === "string"
            ? body["global.llm.tiers"]
            : JSON.stringify(body["global.llm.tiers"]);
          for (const config of deps.registry.getAll()) {
            deps.agentSettings.setSetting(config.id, "llm.tiers", tiersJson);
          }
        }
        // Reload allowed binaries if changed
        if (body["global.runCommand.allowedBinaries"]) {
          const { setAllowedBinaries } = await import("./agent/tools/run-command-tool.js");
          setAllowedBinaries(deps.agentSettings.getAllowedBinaries());
        }
        return json(res, { ok: true });
      } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 400); }
    }

    // List all platform agents (including disabled)
    if (req.method === "GET" && pathname === "/api/platform/agents") {
      try {
        if (!deps.agentStore) return json(res, { agents: [] });
        const allRows = deps.agentStore.getAll();
        const agents: Record<string, unknown>[] = [];
        const tokenMap = new Map<string, string>();
        for (const row of allRows) {
          try {
            const cfg = JSON.parse(row.config_json);
            const agentId = cfg.id || row.id;
            const connected = !!deps.transports?.get(agentId);
            const cronCount = deps.cronStore ? deps.cronStore.listCrons(agentId).length : 0;
            // Resolve: override > tier > legacy model > unknown
            const agentGlobalTiers = deps.agentSettings?.getGlobalTiers() || {};
            const agentTierKey = cfg.llm?.tier || "low";
            const model = cfg.llm?.override || agentGlobalTiers[agentTierKey] || cfg.llm?.model || "unknown";

            const warnings: string[] = [];
            const resolvedToken = expandEnvVars(cfg.transport?.botToken || "");
            if (!resolvedToken) {
              warnings.push("Bot token not configured");
            } else {
              tokenMap.set(agentId, resolvedToken);
            }
            if (cfg.enabled !== false && !connected) {
              if (!resolvedToken) warnings.push("Missing bot token");
            }

            agents.push({
              id: agentId,
              name: cfg.name || row.id,
              description: cfg.description || "",
              enabled: cfg.enabled !== false,
              connected,
              model,
              toolCount: (cfg.tools?.length || 0) + (cfg.mcpServers?.length || 0),
              cronCount,
              warnings,
            });
          } catch { /* skip invalid */ }
        }

        // Detect duplicate bot tokens across agents
        const tokenToAgents = new Map<string, string[]>();
        for (const [agentId, token] of tokenMap) {
          const list = tokenToAgents.get(token) || [];
          list.push(agentId);
          tokenToAgents.set(token, list);
        }
        for (const [, agentIds] of tokenToAgents) {
          if (agentIds.length > 1) {
            for (const agent of agents) {
              if (agentIds.includes(agent.id as string)) {
                const others = agentIds.filter((id) => id !== agent.id).join(", ");
                (agent.warnings as string[]).push(`Duplicate bot token (shared with ${others})`);
              }
            }
          }
        }

        return json(res, { agents });
      } catch (err) { return json(res, { error: String(err) }, 500); }
    }

    // Get single platform agent detail
    const platformAgentMatch = pathname.match(/^\/api\/platform\/agents\/([a-z0-9-]+)$/);
    if (req.method === "GET" && platformAgentMatch && deps.agentStore) {
      const id = platformAgentMatch[1];
      const row = deps.agentStore.get(id);
      if (!row) return json(res, { error: "Agent not found" }, 404);
      const config = JSON.parse(row.config_json);
      // Mask bot token
      if (config.transport?.botToken) {
        const token = String(config.transport.botToken);
        config.transport.botToken = token.startsWith("${") ? token : "****" + token.slice(-4);
      }
      // Resolve the actual model being used: override > tier > fallback
      const globalTiers = deps.agentSettings?.getGlobalTiers() || {};
      const tierKey = config.llm?.tier || "low";
      const resolvedModel = config.llm?.override || globalTiers[tierKey] || config.llm?.model || "unknown";
      // Add resolved model to response for UI display
      config.llm._resolvedModel = resolvedModel;

      return json(res, {
        config,
        persona: row.persona || "",
        memoryTemplate: row.memory_template || "",
        subAgents: row.sub_agents_json ? JSON.parse(row.sub_agents_json) : { agents: {} },
      });
    }

    // Update platform agent config
    if (req.method === "PUT" && platformAgentMatch && deps.agentStore) {
      const id = platformAgentMatch[1];
      if (!deps.agentStore.exists(id)) return json(res, { error: "Agent not found" }, 404);
      const body = await readBody(req);
      try {
        const newConfig = JSON.parse(body);
        deps.agentStore.updateConfig(id, newConfig);
        return json(res, { ok: true });
      } catch (err) { return json(res, { error: String(err) }, 400); }
    }

    // Update persona or memory-template
    const platformFileMatch = pathname.match(/^\/api\/platform\/agents\/([a-z0-9-]+)\/(persona|memory-template)$/);
    if (req.method === "PUT" && platformFileMatch && deps.agentStore) {
      const [, id, fileType] = platformFileMatch;
      if (!deps.agentStore.exists(id)) return json(res, { error: "Agent not found" }, 404);
      const body = await readBody(req);
      try {
        const { content } = JSON.parse(body);
        if (fileType === "persona") {
          deps.agentStore.updatePersona(id, content);
        } else {
          deps.agentStore.updateMemoryTemplate(id, content);
        }
        return json(res, { ok: true });
      } catch (err) { return json(res, { error: String(err) }, 400); }
    }

    // Update sub-agents
    const subAgentsMatch = pathname.match(/^\/api\/platform\/agents\/([a-z0-9-]+)\/sub-agents$/);
    if (req.method === "PUT" && subAgentsMatch && deps.agentStore) {
      const id = subAgentsMatch[1];
      if (!deps.agentStore.exists(id)) return json(res, { error: "Agent not found" }, 404);
      const body = await readBody(req);
      try {
        const data = JSON.parse(body);
        deps.agentStore.updateSubAgents(id, data);
        if (deps.subAgentRegistry) {
          deps.subAgentRegistry.rebuild(id);
        }
        return json(res, { ok: true, reloaded: !!deps.subAgentRegistry });
      } catch (err) { return json(res, { error: String(err) }, 400); }
    }

    // Toggle agent enabled/disabled
    const statusMatch = pathname.match(/^\/api\/platform\/agents\/([a-z0-9-]+)\/status$/);
    if (req.method === "PATCH" && statusMatch && deps.agentStore) {
      const id = statusMatch[1];
      const config = deps.agentStore.getConfig(id);
      if (!config) return json(res, { error: "Agent not found" }, 404);
      const body = await readBody(req);
      try {
        const { enabled } = JSON.parse(body);
        config.enabled = !!enabled;
        deps.agentStore.updateConfig(id, config);
        return json(res, { ok: true, enabled: config.enabled });
      } catch (err) { return json(res, { error: String(err) }, 400); }
    }

    // Delete agent
    const agentIdMatch = pathname.match(/^\/api\/platform\/agents\/([a-z0-9-]+)$/);
    if (req.method === "DELETE" && agentIdMatch && deps.agentStore) {
      const id = agentIdMatch[1];
      if (!deps.agentStore.exists(id)) return json(res, { error: "Agent not found" }, 404);
      deps.agentStore.delete(id);
      return json(res, { ok: true, message: `Agent "${id}" deleted. Restart to apply.` });
    }

    // Agent-scoped crons
    const agentCronsMatch = pathname.match(/^\/api\/platform\/agents\/([a-z0-9-]+)\/crons$/);
    if (req.method === "GET" && agentCronsMatch && deps.cronStore) {
      const id = agentCronsMatch[1];
      return json(res, { crons: deps.cronStore.listCrons(id) });
    }

    // Get the full assembled system prompt for an agent
    const promptMatch = pathname.match(/^\/api\/platform\/agents\/([a-z0-9-]+)\/prompt$/);
    if (req.method === "GET" && promptMatch) {
      const id = promptMatch[1];
      const agentConfig = deps.agentStore?.getConfig(id);
      if (!agentConfig) return json(res, { error: "Agent not found" }, 404);
      const { buildPlatformPromptSections } = await import("./platform/instructions.js");
      const behavior = deps.agentSettings?.getBehavior(id);
      const sections = buildPlatformPromptSections({
        agentName: agentConfig.name || id,
        characterName: agentConfig.characterName,
        ownerName: agentConfig.ownerName,
        role: agentConfig.role,
        lastMessages: agentConfig.memory?.lastMessages ?? 12,
        behavior,
      });
      const persona = deps.agentStore?.getPersona(id) ?? "";
      // Insert persona after Opening so UI shows it in the right order
      const ordered: { label: string; content: string; editable?: boolean }[] = [];
      for (const s of sections) {
        ordered.push(s);
        if (s.label === "Opening") {
          ordered.push({ label: "Your Identity & Persona", content: persona, editable: true });
        }
      }
      return json(res, { sections: ordered });
    }

    // List MCP servers from mcp-servers.yaml
    if (req.method === "GET" && pathname === "/api/platform/mcp-servers") {
      const mcpServerNames = Object.keys(getMCPTools()).map(t => t.split("_")[0]).filter((v, i, a) => a.indexOf(v) === i);
      return json(res, { servers: mcpServerNames });
    }

    // Always-available tools that every platform agent gets
    if (req.method === "GET" && pathname === "/api/platform/always-available-tools") {
      return json(res, { tools: ["cron", "send_media", "task_write", "task_check", "switch_model"] });
    }

    // MCP servers with their individual tools grouped
    if (req.method === "GET" && pathname === "/api/platform/mcp-tools") {
      const mcpToolNames = Object.keys(getMCPTools());
      const serverNames = mcpToolNames.map(t => t.split("_")[0]).filter((v, i, a) => a.indexOf(v) === i);
      const allToolNames = Object.keys(allTools).concat(Object.keys(getMCPTools()));
      const grouped: Record<string, string[]> = {};
      for (const name of serverNames) {
        const prefix = `${name}_`;
        grouped[name] = allToolNames.filter(t => t.startsWith(prefix));
      }
      return json(res, { servers: grouped });
    }

    // ── Webhook GET (verification handshake) ────────────────────
    // Platforms like Meta, Strava, and Slack send a GET with a challenge
    // param during webhook registration. Echo it back to confirm ownership.
    if (req.method === "GET" && pathname.startsWith("/hooks/")) {
      const hubChallenge = url.searchParams.get("hub.challenge");
      const challenge = url.searchParams.get("challenge");
      if (hubChallenge) {
        logger.info(`webhook GET verification: hub.challenge echoed`, { path: pathname });
        return json(res, { "hub.challenge": hubChallenge });
      }
      if (challenge) {
        logger.info(`webhook GET verification: challenge echoed`, { path: pathname });
        return json(res, { challenge });
      }
      return json(res, { ok: true, status: "webhook endpoint active" });
    }

    // ── Webhook endpoints ──────────────────────────────────────
    const webhookConfig = deps.webhookConfig || {
      enabled: deps.agentSettings?.isWebhooksEnabled() ?? false,
      token: deps.agentSettings?.getWebhookToken() || undefined,
    };

    if (webhookConfig?.enabled && req.method === "POST" && pathname.startsWith("/hooks/")) {
      // Body size limit: 1MB
      const contentLength = parseInt(req.headers["content-length"] || "0", 10);
      if (contentLength > 1_048_576) {
        logger.error(`webhook payload too large: ${contentLength} bytes`, { path: pathname });
        return json(res, { ok: false, error: "Payload too large (max 1MB)" }, 413);
      }

      const now = Date.now();
      const windowMs = (webhookConfig as Record<string, unknown>).authWindowMs as number || 300_000;
      const maxFailures = (webhookConfig as Record<string, unknown>).maxAuthFailures as number || 3;
      const recentFailures = authFailures.filter(t => now - t < windowMs).length;
      if (recentFailures >= maxFailures) {
        logger.warn(`webhook rate limited: ${recentFailures} auth failures in window`, { path: pathname });
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
        res.end(JSON.stringify({ ok: false, error: "Too many auth failures. Retry later." }));
        return;
      }

      const subPath = pathname.slice("/hooks/".length);

      // Check if this is an agent-scoped route that allows unauthenticated access
      const hookMatch = subPath.match(/^([a-z0-9-]+)\/([a-z0-9-]+)$/);
      let skipAuth = false;
      if (hookMatch && deps.agentSettings) {
        const { sourceAllowsUnauthenticated } = await import("./platform/webhook-router.js");
        skipAuth = sourceAllowsUnauthenticated(hookMatch[1], hookMatch[2], deps.agentSettings.getStore());
      }

      // Auth check (skipped for allowUnauthenticated sources)
      if (!skipAuth) {
        const rawToken = webhookConfig.token;
        const token = rawToken ? expandEnvVars(rawToken) : rawToken;
        if (token) {
          const authHeader = req.headers.authorization || "";
          const providedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : req.headers["x-golem-token"] as string;
          if (providedToken !== token) {
            authFailures.push(now);
            while (authFailures.length > 0 && now - authFailures[0] > windowMs) authFailures.shift();
            logger.warn(`webhook auth failure`, { path: pathname });
            return json(res, { ok: false, error: "Unauthorized" }, 401);
          }
        }
      }

      // Read body with 1MB enforcement
      let body = "";
      let bodySize = 0;
      for await (const chunk of req) {
        bodySize += chunk.length;
        if (bodySize > 1_048_576) {
          logger.error(`webhook body exceeded 1MB during streaming`, { path: pathname });
          return json(res, { ok: false, error: "Payload too large (max 1MB)" }, 413);
        }
        body += chunk;
      }
      let payload: Record<string, unknown> = {};
      try { payload = body ? JSON.parse(body) : {}; } catch {
        logger.error(`webhook body parse error`, { path: pathname });
        return json(res, { ok: false, error: "Invalid JSON" }, 400);
      }

      // Agent-scoped: /hooks/{agentId}/{source}
      if (hookMatch && deps.onWebhookMessage && deps.agentSettings) {
        const [, agentId, source] = hookMatch;

        // Validate agent exists
        if (deps.registry && !deps.registry.get(agentId)) {
          return json(res, { ok: false, error: `Agent "${agentId}" not found` }, 404);
        }

        // Dedup: skip identical payloads within 60s window
        const dedupKey = webhookDedupKey(agentId, source, body);
        if (isWebhookDuplicate(dedupKey)) {
          console.log(`[webhook] ${agentId}/${source}: duplicate payload, skipped`);
          logger.warn(`webhook duplicate payload skipped`, { agent: agentId, source });
          return json(res, { ok: true, duplicate: true }, 202);
        }

        const requestId = randomUUID().slice(0, 8);

        // Return 202 immediately — classification + agent processing happen async.
        // Platforms like Strava retry if they don't get 200 within 2 seconds.
        logger.info(`webhook received`, { agent: agentId, source, requestId });
        json(res, { ok: true, requestId, agentId, source }, 202);

        // Async: classify, route, and process in the background
        (async () => {
          try {
            const { routeWebhook } = await import("./platform/webhook-router.js");
            const store = deps.agentSettings!.getStore();

            // Store last payload for field discovery in the UI
            store.set(agentId, `webhook.last_payload.${source}`, JSON.stringify(payload).slice(0, 50_000));

            const result = await routeWebhook(agentId, source, payload, store);

            if (result.matched && result.prompt) {
              const messageText =
                `[Webhook: ${source} → "${result.scenarioName}" (id: ${requestId})]\n\n` +
                result.prompt;
              console.log(`[webhook] ${agentId}/${source} id=${requestId}: matched "${result.scenarioName}"`);
              logger.info(`webhook scenario matched: "${result.scenarioName}"`, { agent: agentId, source, requestId });

              const r = await deps.onWebhookMessage!(messageText, `${agentId}:${source}`, requestId);
              console.log(`[webhook] result id=${requestId}: ${r.slice(0, 100)}`);
            } else {
              console.log(`[webhook] ${agentId}/${source} id=${requestId}: no scenario match, dropped`);
              logger.warn(`webhook no scenario match`, { agent: agentId, source, requestId });
              deps.feedStore?.log(agentId, {
                source: "webhook",
                sourceName: source,
                input: `Unmatched webhook from ${source}`,
                status: "skipped",
              });
            }
          } catch (err) {
            console.error(`[webhook] ${agentId}/${source} id=${requestId} async error:`, err instanceof Error ? err.message : err);
            logger.error(`webhook async error: ${err instanceof Error ? err.message : String(err)}`, { agent: agentId, source, requestId });
          }
        })();
        return;
      }

      // Source name validation failure (non-matching format)
      if (subPath.includes("/")) {
        return json(res, { ok: false, error: "Invalid hook path. Source names must match [a-z0-9-]." }, 400);
      }

      return json(res, { ok: false, error: `Unknown hook: ${subPath}` }, 404);
    }

    return json(res, { error: "not found" }, 404);
  });

  const port = deps.port ?? config.serverPort;
  server.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
    console.log(`[server] web UI at http://localhost:3015`);
    logger.info(`Server listening on port ${port}`, { port: String(port) });

    // Auto-open the UI in the default browser on first start
    import("node:child_process").then(({ exec }) => {
      const url = "http://localhost:3015";
      const cmd = process.platform === "darwin" ? `open ${url}` : process.platform === "win32" ? `start ${url}` : `xdg-open ${url}`;
      exec(cmd);
    });
  });
  return server;
}
