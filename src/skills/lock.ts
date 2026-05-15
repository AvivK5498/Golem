import fs from "node:fs";
import path from "node:path";
import { dataPath } from "../utils/paths.js";

export interface SkillLockEntry {
  source: string;          // canonicalized source locator (e.g. "github:owner/repo/skill")
  sourceType: "github" | "skills_sh";
  ref: string | null;
  installedAt: string;     // ISO timestamp
}

export type SkillsLock = Record<string, SkillLockEntry>;

function lockPath(): string {
  return dataPath("skills-lock.json");
}

export function readLock(): SkillsLock {
  const p = lockPath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as SkillsLock;
    return {};
  } catch {
    return {};
  }
}

function writeLock(lock: SkillsLock): void {
  const p = lockPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(lock, null, 2), "utf-8");
}

export function updateLockEntry(key: string, entry: SkillLockEntry): void {
  const lock = readLock();
  lock[key] = entry;
  writeLock(lock);
}

export function removeLockEntry(key: string): void {
  const lock = readLock();
  if (!(key in lock)) return;
  delete lock[key];
  writeLock(lock);
}
