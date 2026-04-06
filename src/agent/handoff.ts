/**
 * Handoff file management — shared workspace artifacts for multi-agent collaboration.
 *
 * When a task requires multiple sub-agents or phases, the main agent creates a
 * handoff file. Sub-agents append their findings to it. The main agent reads
 * the completed file and synthesizes the final response.
 *
 * Format: Markdown body with XML section tags for clear boundaries.
 * Storage: data/handoffs/<id>.md, TTL-based cleanup.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dataPath } from "../utils/paths.js";

const HANDOFF_DIR = dataPath("handoffs");
const TTL_MS = 60 * 60 * 1000; // 1 hour

export interface HandoffMetadata {
  id: string;
  topic: string;
  createdAt: string;
  jid: string;
}

function ensureDir(): void {
  if (!fs.existsSync(HANDOFF_DIR)) {
    fs.mkdirSync(HANDOFF_DIR, { recursive: true });
  }
}

export function handoffPath(id: string): string {
  return path.join(HANDOFF_DIR, `${id}.md`);
}

/**
 * Create a new handoff file with the initial template.
 * Returns the file path.
 */
export function createHandoff(params: {
  topic: string;
  jid: string;
  sections?: string[];
}): { id: string; filePath: string } {
  ensureDir();

  const id = `handoff-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const filePath = handoffPath(id);
  const now = new Date().toISOString();
  const sections = params.sections ?? ["findings"];

  const sectionBlocks = sections
    .map((s) => `<${s}>\n\n</${s}>`)
    .join("\n\n");

  const content = `<handoff>
<metadata>
id: ${id}
topic: ${params.topic}
created: ${now}
</metadata>

${sectionBlocks}
</handoff>
`;

  fs.writeFileSync(filePath, content, "utf-8");
  return { id, filePath };
}

/**
 * Append content to a named section in a handoff file.
 * If the section exists, content is inserted before the closing tag.
 * If not, a new section is added before </handoff>.
 */
export function appendToHandoff(params: {
  filePath: string;
  section: string;
  content: string;
  agent?: string;
}): { success: boolean; error?: string } {
  if (!fs.existsSync(params.filePath)) {
    return { success: false, error: `Handoff file not found: ${params.filePath}` };
  }

  let file = fs.readFileSync(params.filePath, "utf-8");
  const closeTag = `</${params.section}>`;
  const agentHeader = params.agent ? `### ${params.agent}\n` : "";
  const block = `${agentHeader}${params.content}\n\n`;

  if (file.includes(closeTag)) {
    // Insert before closing tag
    file = file.replace(closeTag, `${block}${closeTag}`);
  } else {
    // Add new section before </handoff>
    const newSection = `<${params.section}>\n${block}</${params.section}>`;
    file = file.replace("</handoff>", `${newSection}\n\n</handoff>`);
  }

  fs.writeFileSync(params.filePath, file, "utf-8");
  return { success: true };
}

/**
 * Read a handoff file's content.
 */
export function readHandoff(filePath: string): { content: string } | { error: string } {
  if (!fs.existsSync(filePath)) {
    return { error: `Handoff file not found: ${filePath}` };
  }
  return { content: fs.readFileSync(filePath, "utf-8") };
}

/**
 * Evict handoff files older than TTL.
 */
export function evictExpiredHandoffs(): void {
  if (!fs.existsSync(HANDOFF_DIR)) return;
  const now = Date.now();
  for (const file of fs.readdirSync(HANDOFF_DIR)) {
    const filePath = path.join(HANDOFF_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > TTL_MS) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  }
}
