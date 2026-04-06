import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import YAML from "yaml";
import type { SkillEntry, SkillMetadata } from "./types.js";
import { logger } from "../utils/external-logger.js";

// Parse YAML frontmatter from SKILL.md content
export function parseFrontmatter(content: string): SkillMetadata | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  try {
    return YAML.parse(match[1]) as SkillMetadata;
  } catch {
    return null;
  }
}

// Check if a binary is available on PATH
function isBinAvailable(bin: string): boolean {
  try {
    execSync(`which ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Valid skill name: lowercase alphanumeric and hyphens, no leading/trailing/consecutive hyphens, max 64 chars
const SKILL_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

// Validate a parsed skill entry before adding it to the loaded set
export function validateSkill(
  meta: SkillMetadata,
  dirName: string
): boolean {
  if (!meta.name || typeof meta.name !== "string") {
    console.warn(`[skills] skipping ${dirName}: missing or invalid name`);
    logger.warn("Skill skipped: missing or invalid name", { dir: dirName });
    return false;
  }
  if (!SKILL_NAME_RE.test(meta.name) || meta.name.length > 64) {
    console.warn(
      `[skills] skipping ${dirName}: invalid skill name "${meta.name}"`
    );
    logger.warn("Skill skipped: invalid name", { dir: dirName, skill: meta.name });
    return false;
  }
  if (!meta.description || typeof meta.description !== "string") {
    console.warn(`[skills] skipping ${dirName}: missing description`);
    logger.warn("Skill skipped: missing description", { dir: dirName, skill: meta.name ?? "unknown" });
    return false;
  }
  if (meta.description.length > 1024) {
    console.warn(`[skills] skipping ${dirName}: description too long`);
    logger.warn("Skill skipped: description too long", { dir: dirName, skill: meta.name });
    return false;
  }
  return true;
}

// Check if all requirements are met.
// Supports both Golem format (requires.env/bins) and
// extended metadata format (metadata.extended.requires.env/bins).
export function checkEligibility(meta: SkillMetadata): boolean {
  const extendedReqs = meta.metadata?.extended?.requires;

  const envVars = [
    ...(meta.requires?.env ?? []),
    ...(extendedReqs?.env ?? []),
  ];
  for (const envVar of envVars) {
    if (!process.env[envVar]) return false;
  }

  const bins = [
    ...(meta.requires?.bins ?? []),
    ...(extendedReqs?.bins ?? []),
  ];
  for (const bin of bins) {
    if (!isBinAvailable(bin)) return false;
  }

  return true;
}

// Scan a single directory for skill subdirectories containing SKILL.md
function scanDir(dir: string): SkillEntry[] {
  const resolvedDir = dir.startsWith("~") ? dir.replace("~", os.homedir()) : path.resolve(dir);
  if (!fs.existsSync(resolvedDir)) return [];

  const entries: SkillEntry[] = [];
  for (const name of fs.readdirSync(resolvedDir)) {
    const skillDir = path.join(resolvedDir, name);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.statSync(skillDir).isDirectory()) continue;
    if (!fs.existsSync(skillFile)) continue;

    try {
      const content = fs.readFileSync(skillFile, "utf-8");
      const meta = parseFrontmatter(content);
      if (!meta) {
        console.warn(`[skills] skipping ${name}: failed to parse frontmatter`);
        continue;
      }
      if (!validateSkill(meta, name)) continue;

      entries.push({
        name: meta.name,
        description: meta.description,
        dir: skillDir,
        filePath: skillFile,
        eligible: checkEligibility(meta),
        hasScripts: fs.existsSync(path.join(skillDir, "scripts")),
        hasReferences: fs.existsSync(path.join(skillDir, "references")),
        hasAssets: fs.existsSync(path.join(skillDir, "assets")),
      });
    } catch (err) {
      console.warn(`[skills] skipping ${name}: ${err}`);
      continue;
    }
  }
  return entries;
}

// Module-level cache for skill summaries
let cachedSkills: SkillEntry[] | null = null;
let cacheKey: string | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

// Load all skills from configured directories
// First dir has priority — later dirs don't override existing names
export function loadSkills(dirs: string[]): SkillEntry[] {
  const key = dirs.join("|");
  const now = Date.now();

  // Return cached result if valid
  if (cachedSkills && cacheKey === key && now - cacheTime < CACHE_TTL_MS) {
    return cachedSkills;
  }

  // Cache miss - scan directories
  const seen = new Set<string>();
  const all: SkillEntry[] = [];

  for (const dir of dirs) {
    for (const entry of scanDir(dir)) {
      if (!seen.has(entry.name)) {
        seen.add(entry.name);
        all.push(entry);
      }
    }
  }

  // Update cache
  cachedSkills = all;
  cacheKey = key;
  cacheTime = now;

  const eligible = all.filter((s) => s.eligible).length;
  const ineligible = all.length - eligible;
  logger.info("Skills loaded", { total: String(all.length), eligible: String(eligible), ineligible: String(ineligible) });

  return all;
}

// For tests - clear the skill cache
export function clearSkillCache(): void {
  cachedSkills = null;
  cacheKey = null;
  cacheTime = 0;
}

// Generate brief summary string for system prompt injection (legacy format)
export function getSkillSummaries(skills: SkillEntry[]): string {
  const eligible = skills.filter((s) => s.eligible);
  if (eligible.length === 0) return "";
  return eligible.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

// Generate XML-formatted skills block for system prompt
export function formatSkillsForPrompt(skills: SkillEntry[]): string {
  const eligible = skills.filter((s) => s.eligible);
  if (eligible.length === 0) return "";
  const entries = eligible.map((s) => {
    const relativePath = path.relative(process.cwd(), s.filePath);
    return `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n    <location>${relativePath}</location>\n  </skill>`;
  });
  return `<available_skills>\n${entries.join("\n")}\n</available_skills>`;
}
