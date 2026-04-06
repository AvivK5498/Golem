/**
 * MCP Client singleton that connects to configured MCP servers
 * and provides their tools to the agent.
 */
import { MCPClient } from "@mastra/mcp";
import type { Tool } from "@mastra/core/tools";
import { expandEnvVars } from "../config.js";
import fs from "node:fs";
import yaml from "yaml";
import { logger } from "../utils/external-logger.js";

let mcpClient: MCPClient | null = null;
let mcpTools: Record<string, Tool> = {};

interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Whitelist of tool names to register. If omitted, all tools are registered. */
  tools?: string[];
}

/**
 * Initialize the MCP client.
 * Pass `serversOverride` to use a specific config (e.g., from platform.yaml)
 * instead of reading from config.yaml.
 */
export async function initMCPClient(
  serversOverride?: Record<string, MCPServerConfig>,
): Promise<void> {
  let servers = serversOverride;
  if (!servers) {
    // Read from dedicated mcp-servers.yaml (preferred) or fallback to config.yaml
    const mcpPath = "mcp-servers.yaml";
    if (fs.existsSync(mcpPath)) {
      try {
        const raw = fs.readFileSync(mcpPath, "utf-8");
        servers = (yaml.parse(raw) as { servers?: Record<string, MCPServerConfig> })?.servers;
      } catch { /* fall through */ }
    }
  }

  if (!servers || Object.keys(servers).length === 0) {
    console.log("[mcp] no servers configured");
    return;
  }

  console.log(`[mcp] connecting to ${Object.keys(servers).length} server(s): ${Object.keys(servers).join(", ")}`);

  try {
    mcpClient = new MCPClient({
      servers: Object.fromEntries(
        Object.entries(servers).map(([name, cfg]) => {
          // HTTP server (url-based)
          if (cfg.url) {
            const headers = cfg.headers
              ? Object.fromEntries(
                  Object.entries(cfg.headers).map(([k, v]) => [k, expandEnvVars(v)])
                )
              : undefined;
            return [
              name,
              {
                url: new URL(cfg.url),
                requestInit: headers ? { headers } : undefined,
              },
            ];
          }

          // Stdio server (command-based)
          return [
            name,
            {
              command: cfg.command!,
              args: cfg.args,
              env: cfg.env
                ? {
                    ...process.env,
                    ...Object.fromEntries(
                      Object.entries(cfg.env).map(([k, v]) => [k, expandEnvVars(v)])
                    ),
                  }
                : undefined,
            },
          ];
        })
      ),
      timeout: 30000,
    });

    const allTools = await mcpClient.listTools();

    // Build per-server tool whitelists
    const toolWhitelist = new Set<string>();
    let hasAnyWhitelist = false;
    for (const [serverName, cfg] of Object.entries(servers)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tools whitelist is a config extension not in MCPServerConfig type
      const cfgTools = (cfg as any).tools as string[] | undefined;
      if (cfgTools && cfgTools.length > 0) {
        hasAnyWhitelist = true;
        for (const t of cfgTools) {
          // MCP tools are prefixed with server name: "context7_query-docs"
          // Accept both raw name and prefixed name in the whitelist
          toolWhitelist.add(t);
          toolWhitelist.add(`${serverName}_${t}`);
        }
      }
    }

    // Filter tools by whitelist (if any server defines one)
    const rawTools = hasAnyWhitelist
      ? Object.fromEntries(
          Object.entries(allTools).filter(([name]) => {
            // If this tool's server has no whitelist, keep it (e.g., context7)
            const serverName = Object.keys(servers).find(s => name.startsWith(`${s}_`));
            const serverCfg = serverName ? servers[serverName] : undefined;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const srvTools = (serverCfg as any)?.tools as string[] | undefined;
            if (!srvTools || srvTools.length === 0) return true;
            // Server has a whitelist — check if this tool is in it
            return toolWhitelist.has(name);
          })
        )
      : allTools;

    if (Object.keys(allTools).length !== Object.keys(rawTools).length) {
      console.log(`[mcp] filtered ${Object.keys(allTools).length} → ${Object.keys(rawTools).length} tool(s) via whitelist`);
    }

    // Wrap MCP tools to cap result size (prevent context overflow)
    const MAX_RESULT_CHARS = 30_000;
    mcpTools = Object.fromEntries(
      Object.entries(rawTools).map(([name, tool]) => {
        if (!tool.execute) {
          return [name, tool];
        }

        const originalExecute = tool.execute.bind(tool);
        type ExecuteInput = Parameters<typeof originalExecute>[0];
        type ExecuteContext = Parameters<typeof originalExecute>[1];
        return [
          name,
          {
            ...tool,
            execute: async (input: ExecuteInput, context: ExecuteContext) => {
              const result = await originalExecute(input, context);
              if (typeof result === "string" && result.length > MAX_RESULT_CHARS) {
                return result.slice(0, MAX_RESULT_CHARS) + "\n[truncated - result too large]";
              }
              return result;
            },
          },
        ];
      })
    );

    console.log(`[mcp] loaded ${Object.keys(mcpTools).length} tool(s): ${Object.keys(mcpTools).join(", ")}`);
    try { logger.info(`MCP connected: ${Object.keys(mcpTools).length} tools from ${Object.keys(servers).length} server(s)`, { servers: Object.keys(servers).join(","), tools: String(Object.keys(mcpTools).length) }); } catch { /* ignore */ }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mcp] failed to initialize: ${msg}`);
    try { logger.error(`MCP connect failure: ${msg}`, { servers: Object.keys(servers).join(",") }); } catch { /* ignore */ }
    mcpClient = null;
    mcpTools = {};
  }
}

/**
 * Get all MCP tools. Returns empty object if no servers configured.
 */
export function getMCPTools(): Record<string, Tool> {
  return mcpTools;
}

/**
 * Disconnect from all MCP servers. Call on shutdown.
 */
export async function disconnectMCP(): Promise<void> {
  if (mcpClient) {
    console.log("[mcp] disconnecting...");
    try { logger.info("MCP disconnecting"); } catch { /* ignore */ }
    await mcpClient.disconnect();
    mcpClient = null;
    mcpTools = {};
  }
}
