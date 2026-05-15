/**
 * Centralized path resolution for runtime data and skills.
 *
 * Resolution order for the data directory:
 *   1. GOLEM_DATA_DIR env var (explicit override — anything goes)
 *   2. ./data/ in cwd if it exists as a directory (preserves dev workflow:
 *      cloning the repo and running `npm start` keeps writing to repo-local data/)
 *   3. OS-native default:
 *        macOS:   ~/Library/Application Support/golem
 *        Linux:   $XDG_DATA_HOME/golem  (default ~/.local/share/golem)
 *        Windows: %APPDATA%/golem
 *
 * The directory is created on first access and chmod'd to 0700 (best-effort;
 * silently ignored on filesystems that don't support unix modes).
 *
 * Lazy resolution so dotenv (loaded after module imports in ESM) wins.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type DataDirSource = "env" | "cwd" | "default";

interface ResolvedDataDir {
  path: string;
  source: DataDirSource;
}

let _resolved: ResolvedDataDir | null = null;
let _skillsDir: string | null = null;

function homeDir(): string {
  // Prefer $HOME so tests and users can override portably. Node's homeDir()
  // honors $HOME on POSIX, but Bun's doesn't in all cases.
  return process.env.HOME || (process.platform === "win32" ? process.env.USERPROFILE : null) || os.homedir();
}

function osDefaultDataDir(): string {
  const home = homeDir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "golem");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "golem");
  }
  // Linux / other *nix: XDG Base Directory spec
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(xdgDataHome, "golem");
}

function resolveDataDir(): ResolvedDataDir {
  if (process.env.GOLEM_DATA_DIR) {
    return { path: path.resolve(process.env.GOLEM_DATA_DIR), source: "env" };
  }
  const cwdData = path.resolve("data");
  try {
    if (fs.statSync(cwdData).isDirectory()) {
      return { path: cwdData, source: "cwd" };
    }
  } catch {
    // not present — fall through
  }
  return { path: osDefaultDataDir(), source: "default" };
}

function ensureDataDir(): ResolvedDataDir {
  if (!_resolved) {
    _resolved = resolveDataDir();
    fs.mkdirSync(_resolved.path, { recursive: true });
    try {
      fs.chmodSync(_resolved.path, 0o700);
    } catch {
      // best-effort: ignore on filesystems without unix mode support
    }
  }
  return _resolved;
}

/** Root directory for all runtime data (SQLite DBs, logs, handoffs, approvals) */
export function getDataDir(): string {
  return ensureDataDir().path;
}

/**
 * Describe how the data directory was resolved. Useful for the first-run banner
 * and `golem doctor`. Calling this triggers resolution if it hasn't happened yet.
 */
export function describeDataDirResolution(): ResolvedDataDir {
  return { ...ensureDataDir() };
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

/** Expand a leading ~ or ~/ in a path to the user's home directory. */
export function expandTilde(p: string): string {
  if (p === "~") return homeDir();
  if (p.startsWith("~/")) return path.join(homeDir(), p.slice(2));
  return p;
}

/**
 * Test-only: clear the memoized data/skills paths so the next call re-resolves
 * from env + cwd. Do not call from production code.
 */
export function _resetPathCacheForTests(): void {
  _resolved = null;
  _skillsDir = null;
}
