import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getSkillsDir } from "../utils/paths.js";
import { isValidSkillKey, parseSource, type ParsedSource } from "./import-source.js";

// Tight ref whitelist — feeds into `git clone --branch <ref>` as a positional.
// Reject anything that could be interpreted as a flag, or contains shell-meaningful chars.
const SAFE_REF_RE = /^[A-Za-z0-9._/-]+$/;

function isSafeRef(ref: string): boolean {
  if (!ref || ref.length > 256) return false;
  if (ref.startsWith("-")) return false;
  if (ref.includes("..")) return false;
  return SAFE_REF_RE.test(ref);
}

function gitClone(url: string, dest: string, ref?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ref && !isSafeRef(ref)) {
      reject(new Error(`unsafe ref: "${ref}"`));
      return;
    }
    const args = ["clone", "--depth", "1"];
    if (ref) args.push("--branch", ref);
    args.push("--", url, dest);
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git clone failed: ${stderr.trim() || `code ${code}`}`));
    });
  });
}

async function pathExists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

// Claude-Code plugin layout: skills listed in .claude-plugin/plugin.json as
// `./tools/.../<skill>/SKILL.md` entries.
async function resolveFromPluginManifest(repoRoot: string, skillName: string): Promise<string | null> {
  try {
    const manifestPath = path.join(repoRoot, ".claude-plugin", "plugin.json");
    const raw = await fs.readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(raw) as { skills?: unknown };
    const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
    const repoRootResolved = path.resolve(repoRoot) + path.sep;
    for (const entry of skills) {
      if (typeof entry !== "string") continue;
      const normalized = entry.replace(/^\.\//, "");
      const dir = normalized.replace(/\/SKILL\.md$/i, "");
      if (path.basename(dir) !== skillName) continue;
      const abs = path.resolve(repoRoot, dir);
      // Boundary check: refuse manifest entries that escape repoRoot.
      if (abs !== path.resolve(repoRoot) && !abs.startsWith(repoRootResolved)) continue;
      if (await pathExists(abs)) return abs;
    }
    return null;
  } catch {
    return null;
  }
}

// Fallback: walk the clone for any dir named <skillName> that contains SKILL.md.
async function findSkillByDirName(repoRoot: string, skillName: string, maxDepth = 6): Promise<string | null> {
  const SKIP = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "venv"]);
  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth > maxDepth) return null;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return null; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP.has(entry.name)) continue;
      const childDir = path.join(dir, entry.name);
      if (entry.name === skillName) {
        if (await pathExists(path.join(childDir, "SKILL.md"))) return childDir;
      }
      const found = await walk(childDir, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return walk(repoRoot, 0);
}

export interface ImportResult {
  key: string;
  destDir: string;
  source: string;        // canonical locator (github:owner/repo[/skill])
  sourceType: "github" | "skills_sh";
  ref: string | null;
}

/**
 * Clone the repo to a temp dir, resolve the skill subtree, then atomically
 * move into <skillsDir>/<key>. Returns the canonical source locator and
 * resolved key for the lockfile.
 */
export async function importSkill(opts: { source: string; ref?: string }): Promise<ImportResult> {
  const parsed: ParsedSource | null = parseSource(opts.source);
  if (!parsed) {
    throw new Error(`unrecognized source format: ${opts.source}`);
  }

  const destRoot = getSkillsDir();
  await fs.mkdir(destRoot, { recursive: true });
  const destRootResolved = path.resolve(destRoot) + path.sep;

  const ref = opts.ref ?? parsed.ref;
  const url = `https://github.com/${parsed.owner}/${parsed.repo}.git`;

  const tmp = await fs.mkdtemp(path.join(destRoot, ".import-"));
  try {
    await gitClone(url, tmp, ref);

    let sourceDir: string;
    let key: string;

    if (parsed.skillName) {
      if (!isValidSkillKey(parsed.skillName)) {
        throw new Error(`skill name "${parsed.skillName}" is not a valid skill key (kebab-case only).`);
      }
      const direct = path.join(tmp, parsed.skillName);
      const nested = path.join(tmp, "skills", parsed.skillName);
      if (await pathExists(direct)) sourceDir = direct;
      else if (await pathExists(nested)) sourceDir = nested;
      else {
        const fromManifest = await resolveFromPluginManifest(tmp, parsed.skillName);
        if (fromManifest) sourceDir = fromManifest;
        else {
          const fromWalk = await findSkillByDirName(tmp, parsed.skillName);
          if (fromWalk) sourceDir = fromWalk;
          else {
            throw new Error(
              `skill "${parsed.skillName}" not found in ${parsed.owner}/${parsed.repo} ` +
                `(looked in /, /skills/, .claude-plugin/plugin.json, recursive walk)`,
            );
          }
        }
      }
      key = parsed.skillName;
    } else {
      if (!isValidSkillKey(parsed.repo)) {
        throw new Error(
          `repo name "${parsed.repo}" is not a valid skill key (kebab-case only); ` +
            `pass a skill name explicitly.`,
        );
      }
      // Whole repo IS the skill — must contain SKILL.md at root.
      if (!(await pathExists(path.join(tmp, "SKILL.md")))) {
        throw new Error(
          `${parsed.owner}/${parsed.repo} has no SKILL.md at its root — ` +
            `pass an explicit skill name (e.g. github:${parsed.owner}/${parsed.repo}/<skill>).`,
        );
      }
      sourceDir = tmp;
      key = parsed.repo;
    }

    const dest = path.resolve(destRoot, key);
    if (!dest.startsWith(destRootResolved) && dest !== path.resolve(destRoot)) {
      throw new Error(`resolved dest "${dest}" escapes skills dir`);
    }

    await fs.rm(dest, { recursive: true, force: true });
    // verbatimSymlinks: don't follow symlinks out of the clone (defensive
    // against a hostile bundle like `evil -> /home/user/.ssh`).
    await fs.cp(sourceDir, dest, { recursive: true, verbatimSymlinks: true });

    const sourceLocator = parsed.skillName
      ? `github:${parsed.owner}/${parsed.repo}/${parsed.skillName}`
      : `github:${parsed.owner}/${parsed.repo}`;

    return {
      key,
      destDir: dest,
      source: sourceLocator,
      sourceType: parsed.kind,
      ref: ref ?? null,
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// Preview: fetch GitHub repo metadata + (optionally) the resolved SKILL.md
// frontmatter so the UI can show a confidence card before install.

export interface PreviewResult {
  owner: string;
  repo: string;
  stars: number;
  forks: number;
  lastCommitISO: string | null;
  lastCommitAgeDays: number | null;
  defaultBranch: string;
  description: string | null;
  topics: string[];
  requestedSkill: string | null;
  skillMeta: { key: string; name: string; description: string | null; path: string } | null;
  sourceLocator: string;
}

async function fetchRepoMeta(owner: string, repo: string): Promise<Omit<PreviewResult, "requestedSkill" | "skillMeta" | "sourceLocator">> {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "golem-skill-installer",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) throw new Error(`repo not found: ${owner}/${repo}`);
    if (res.status === 403 || res.status === 429) {
      throw new Error(
        process.env.GITHUB_TOKEN
          ? "GitHub rate-limited (try again shortly)"
          : "GitHub rate-limited (set GITHUB_TOKEN to raise the limit)",
      );
    }
    throw new Error(`GitHub returned ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  const pushedAt = typeof data.pushed_at === "string" ? data.pushed_at : null;
  const lastCommitAgeDays = pushedAt
    ? Math.floor((Date.now() - new Date(pushedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  return {
    owner,
    repo,
    stars: typeof data.stargazers_count === "number" ? data.stargazers_count : 0,
    forks: typeof data.forks_count === "number" ? data.forks_count : 0,
    lastCommitISO: pushedAt,
    lastCommitAgeDays,
    defaultBranch: typeof data.default_branch === "string" ? data.default_branch : "main",
    description: typeof data.description === "string" ? data.description : null,
    topics: Array.isArray(data.topics) ? (data.topics as string[]) : [],
  };
}

// Minimal frontmatter parser — extracts `name:` and `description:` only.
function parseSkillFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const block = m[1];
  const out: { name?: string; description?: string } = {};
  for (const line of block.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    // Strip matching quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === "name") out.name = val;
    else if (key === "description") out.description = val;
  }
  return out;
}

async function fetchSkillMeta(
  owner: string,
  repo: string,
  skill: string,
  defaultBranch: string,
): Promise<PreviewResult["skillMeta"]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "golem-skill-installer",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`;
  const treeRes = await fetch(treeUrl, { headers });
  if (!treeRes.ok) return null;
  const treeData = (await treeRes.json()) as { tree?: Array<{ path?: string; type?: string }> };
  const skillPath = (treeData.tree ?? [])
    .filter((e) => typeof e.path === "string" && e.path.endsWith("/SKILL.md"))
    .map((e) => e.path as string)
    .find((p) => {
      const segs = p.split("/");
      return segs[segs.length - 2] === skill;
    });
  if (!skillPath) return null;

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}/${skillPath}`;
  const rawRes = await fetch(rawUrl);
  if (!rawRes.ok) return null;
  const md = await rawRes.text();
  const fm = parseSkillFrontmatter(md);
  return {
    key: skill,
    name: fm.name?.trim() || skill,
    description: fm.description?.trim() || null,
    path: skillPath,
  };
}

export async function previewSkill(source: string): Promise<PreviewResult> {
  const parsed = parseSource(source);
  if (!parsed) throw new Error(`unrecognized source format: ${source}`);
  const meta = await fetchRepoMeta(parsed.owner, parsed.repo);
  let skillMeta: PreviewResult["skillMeta"] = null;
  if (parsed.skillName) {
    skillMeta = await fetchSkillMeta(parsed.owner, parsed.repo, parsed.skillName, meta.defaultBranch);
  }
  const sourceLocator = parsed.skillName
    ? `github:${parsed.owner}/${parsed.repo}/${parsed.skillName}`
    : `github:${parsed.owner}/${parsed.repo}`;
  return {
    ...meta,
    requestedSkill: parsed.skillName ?? null,
    skillMeta,
    sourceLocator,
  };
}
