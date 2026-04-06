import { hookRegistry } from "./index.js";
import type { MessageTransport } from "../transport/interface.js";
import type { ChatAddress } from "../transport/types.js";
import { logger } from "../utils/external-logger.js";

/** promptModes where file diffs should NOT be sent (no human waiting) */
const SILENT_MODES = new Set(["autonomous"]);

/** Files that change frequently and aren't interesting to notify about */
const IGNORED_FILES = new Set(["data/tool-calls.log"]);

/**
 * Register a hook that sends file-change diffs to the owner via Telegram
 * whenever the agent mutates a file through the filesystem tool.
 *
 * Fires on after_tool_call for filesystem write/append/patch actions.
 */
export function registerFileDiffNotifier(
  transports: { telegram?: MessageTransport },
  ownerAddress: ChatAddress,
): () => void {
  const unregister = hookRegistry.register("after_tool_call", async (ctx) => {
    const toolName = ctx.toolName as string;

    // Handle workspace edit_file (replaced the old filesystem tool)
    if (toolName === "mastra_workspace_edit_file") {
      let args: { path?: string; old_string?: string; new_string?: string };
      try {
        args = typeof ctx.args === "string" ? JSON.parse(ctx.args) : (ctx.args as typeof args);
      } catch {
        return;
      }

      const filePath = args?.path;
      if (!filePath || !args.old_string || !args.new_string) return;
      if (IGNORED_FILES.has(filePath)) return;

      const promptMode = ctx.promptMode as string | undefined;
      if (promptMode && SILENT_MODES.has(promptMode)) return;

      const result = ctx.result as string | undefined;
      if (result?.startsWith("Error:")) return;

      const diff = computeMinimalDiff(args.old_string, args.new_string);
      if (!diff) return;

      const shortPath = filePath.replace(/^.*\/(?=src\/)/, "");
      const msg = `📝 **edited** \`${shortPath}\`\n\`\`\`diff\n${truncate(diff, 600)}\n\`\`\``;

      if (!ownerAddress.id) return;

      const transport = transports.telegram;
      if (!transport) return;

      transport.sendText(ownerAddress, msg).catch((err) => {
        console.error("[file-diff] failed to notify:", err instanceof Error ? err.message : err);
        logger.error("File diff notification failed", { tool: "edit_file", error: err instanceof Error ? err.message : String(err) });
      });
      return;
    }

    // Handle workspace write_file
    if (toolName === "mastra_workspace_write_file") {
      let args: { path?: string; content?: string };
      try {
        args = typeof ctx.args === "string" ? JSON.parse(ctx.args) : (ctx.args as typeof args);
      } catch {
        return;
      }

      const filePath = args?.path;
      if (!filePath) return;
      if (IGNORED_FILES.has(filePath)) return;

      const promptMode = ctx.promptMode as string | undefined;
      if (promptMode && SILENT_MODES.has(promptMode)) return;

      const result = ctx.result as string | undefined;
      if (result?.startsWith("Error:")) return;

      const msg = formatDiffMessage("write", filePath, args.content);
      if (!msg) return;

      if (!ownerAddress.id) return;

      const transport = transports.telegram;
      if (!transport) return;

      transport.sendText(ownerAddress, msg).catch((err) => {
        console.error("[file-diff] failed to notify:", err instanceof Error ? err.message : err);
        logger.error("File diff notification failed", { tool: "write_file", error: err instanceof Error ? err.message : String(err) });
      });
      return;
    }

    // Legacy filesystem tool (kept for backwards compat)
    if (toolName !== "filesystem") return;

    let args: { action?: string; path?: string; content?: string; old_text?: string };
    try {
      args = typeof ctx.args === "string" ? JSON.parse(ctx.args) : (ctx.args as typeof args);
    } catch {
      return;
    }

    const action = args?.action;
    if (!action || !["write", "append", "patch"].includes(action)) return;

    const filePath = args.path;
    if (!filePath) return;

    // Skip ignored files
    if (IGNORED_FILES.has(filePath)) return;

    // Skip silent modes (autonomous/cron) — no human is waiting
    const promptMode = ctx.promptMode as string | undefined;
    if (promptMode && SILENT_MODES.has(promptMode)) return;

    // Don't notify on errors
    const result = ctx.result as string | undefined;
    if (result?.startsWith("Error:")) return;

    // Build the diff message
    const msg = formatDiffMessage(action, filePath, args.content, args.old_text);
    if (!msg) return;

    if (!ownerAddress.id) return;

    const transport = transports.telegram;
    if (!transport) return;

    // Fire and forget — don't block the agent loop
    transport.sendText(ownerAddress, msg).catch((err) => {
      console.error("[file-diff] failed to notify:", err instanceof Error ? err.message : err);
      logger.error("File diff notification failed", { tool: "filesystem", error: err instanceof Error ? err.message : String(err) });
    });
  });

  return unregister;
}

function formatDiffMessage(
  action: string,
  filePath: string,
  content?: string,
  oldText?: string,
): string | null {
  const shortPath = filePath.replace(/^.*\/(?=src\/)/, "");

  switch (action) {
    case "write": {
      const lines = content?.split("\n").length ?? 0;
      if (lines > 10) {
        // Large file — just show summary + first few lines
        const firstLines = content!.split("\n").slice(0, 5).map(l => `+ ${l}`).join("\n");
        return `📝 **wrote** \`${shortPath}\` (${lines} lines)\n\`\`\`diff\n${firstLines}\n+ ... (${lines - 5} more)\n\`\`\``;
      }
      const preview = truncate(content?.trim() ?? "", 400);
      const diffLines = preview.split("\n").map(l => `+ ${l}`).join("\n");
      return `📝 **wrote** \`${shortPath}\` (${lines} lines)\n\`\`\`diff\n${diffLines}\n\`\`\``;
    }
    case "append": {
      const preview = truncate(content?.trim() ?? "", 400);
      const diffLines = preview.split("\n").map(l => `+ ${l}`).join("\n");
      return `📝 **appended to** \`${shortPath}\`\n\`\`\`diff\n${diffLines}\n\`\`\``;
    }
    case "patch": {
      const oldLines = (oldText ?? "").split("\n").length;
      const newLines = (content ?? "").split("\n").length;
      return `📝 **patched** \`${shortPath}\` (−${oldLines} lines, +${newLines} lines)`;
    }
    default:
      return null;
  }
}

/**
 * Compute a minimal line-level diff between old and new text.
 * Shows only changed lines with up to 1 line of context.
 */
function computeMinimalDiff(oldText: string, newText: string): string | null {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Find first differing line
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }

  // Find last differing line (from the end)
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const removedLines = oldLines.slice(start, oldEnd + 1);
  const addedLines = newLines.slice(start, newEnd + 1);

  if (removedLines.length === 0 && addedLines.length === 0) return null;

  const parts: string[] = [];

  // 1 line of context before
  if (start > 0) parts.push(`  ${oldLines[start - 1]}`);

  for (const l of removedLines) parts.push(`- ${l}`);
  for (const l of addedLines) parts.push(`+ ${l}`);

  // 1 line of context after
  const contextAfterIdx = oldEnd + 1;
  if (contextAfterIdx < oldLines.length) parts.push(`  ${oldLines[contextAfterIdx]}`);

  return parts.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

