#!/usr/bin/env node
/**
 * Discover tools from an MCP server and run security checks.
 *
 * Usage:
 *   node bin/mcp-discover.mjs --url https://api.example.com/mcp
 *   node bin/mcp-discover.mjs --command npx --args "-y,open-meteo-mcp-server"
 *   node bin/mcp-discover.mjs --url https://api.example.com/mcp --header "Authorization:Bearer key123"
 */
import { MCPClient } from "@mastra/mcp";

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

const url = getArg("url");
const command = getArg("command");
const rawArgs = getArg("args");
const header = getArg("header");

if (!url && !command) {
  console.error("Usage: mcp-discover --url <url> [--header 'Key:Value'] | --command <cmd> --args 'arg1,arg2'");
  process.exit(1);
}

// ── Security checks for remote servers ──
const warnings = [];

if (url) {
  const parsed = new URL(url);

  // Check HTTPS
  if (parsed.protocol !== "https:") {
    warnings.push("NO_TLS: Server uses HTTP, not HTTPS. Data is transmitted in plaintext.");
  }

  // Check domain reputation (verified namespaces use real domains)
  const host = parsed.hostname;
  if (host.includes("smithery.ai")) {
    warnings.push("PROXY_HOST: Server is proxied through Smithery. The actual server code is not verified by Smithery.");
  }
  if (host === "localhost" || host === "127.0.0.1") {
    warnings.push("LOCAL_HOST: Server is running locally. Not a remote integration.");
  }
}

// ── Connect and discover tools ──
const serverConfig = {};
if (url) {
  serverConfig.url = new URL(url);
  if (header) {
    const [key, ...rest] = header.split(":");
    serverConfig.requestInit = { headers: { [key.trim()]: rest.join(":").trim() } };
  }
} else {
  serverConfig.command = command;
  serverConfig.args = rawArgs ? rawArgs.split(",") : [];
}

try {
  const client = new MCPClient({
    servers: { probe: serverConfig },
    timeout: 30000,
  });

  const tools = await client.listTools();
  const toolList = Object.entries(tools).map(([name, tool]) => {
    const desc = tool.description || "(no description)";
    const cleanName = name.replace(/^probe_/, "");
    return { name: cleanName, description: desc };
  });

  // ── Analyze tool descriptions for sensitive operations ──
  const sensitivePatterns = [
    { pattern: /\b(book|purchase|buy|order|checkout)\b/i, label: "TRANSACTIONAL" },
    { pattern: /\b(payment|credit.?card|billing|charge|stripe|paypal)\b/i, label: "PAYMENT" },
    { pattern: /\b(passport|ssn|social.?security|national.?id|identity)\b/i, label: "PII" },
    { pattern: /\b(password|secret|credential|private.?key|token)\b/i, label: "CREDENTIALS" },
    { pattern: /\b(delete|remove|destroy|drop|purge)\b/i, label: "DESTRUCTIVE" },
  ];

  const toolsWithFlags = toolList.map((tool) => {
    const flags = [];
    for (const { pattern, label } of sensitivePatterns) {
      if (pattern.test(tool.description)) {
        flags.push(label);
      }
    }
    return { ...tool, flags: flags.length > 0 ? flags : undefined };
  });

  // Collect tool-level warnings
  for (const tool of toolsWithFlags) {
    if (tool.flags?.length) {
      warnings.push(`SENSITIVE_TOOL: "${tool.name}" — ${tool.flags.join(", ")} (review before whitelisting)`);
    }
  }

  const safe = toolsWithFlags.filter((t) => !t.flags);
  const sensitive = toolsWithFlags.filter((t) => t.flags);

  console.log(JSON.stringify({
    tools: toolsWithFlags,
    count: toolList.length,
    safe_tools: safe.map((t) => t.name),
    sensitive_tools: sensitive.map((t) => ({ name: t.name, flags: t.flags })),
    warnings,
    recommendation: safe.length > 0
      ? `Whitelist these safe tools: ${safe.map((t) => t.name).join(", ")}`
      : "All tools have sensitive flags. Ask the user which ones to enable.",
  }, null, 2));

  await client.disconnect();
  process.exit(0);
} catch (err) {
  console.error(JSON.stringify({ error: err.message || String(err), warnings }));
  process.exit(1);
}
