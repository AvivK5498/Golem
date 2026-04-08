/**
 * Centralized path resolution for runtime data and skills.
 *
 * Uses lazy resolution so environment variables from .env are available
 * (dotenv loads after module imports in ESM).
 */
import fs from "node:fs";
import path from "node:path";

let _dataDir: string | null = null;
let _skillsDir: string | null = null;

/** Root directory for all runtime data (SQLite DBs, logs, handoffs, approvals) */
export function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = path.resolve(process.env.GOLEM_DATA_DIR || "data");
    fs.mkdirSync(_dataDir, { recursive: true });
  }
  return _dataDir;
}

/** Root directory for skill definitions */
export function getSkillsDir(): string {
  if (!_skillsDir) _skillsDir = path.resolve(process.env.GOLEM_SKILLS_DIR || "skills");
  return _skillsDir;
}

/** Per-agent sandboxed workspace directory. Created on first access. */
export function getAgentWorkspace(agentId: string): string {
  const dir = path.join(getDataDir(), "workspaces", agentId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve a filename relative to the data directory */
export function dataPath(filename: string): string {
  return path.join(getDataDir(), filename);
}
