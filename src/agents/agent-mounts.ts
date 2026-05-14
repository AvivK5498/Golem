/**
 * buildAgentMounts — assemble the Mastra Workspace `mounts` map for an agent
 * that has configured filesystem mounts.
 *
 * Mastra's Workspace constructor throws if it gets both `filesystem` and
 * `mounts`. So an agent with mounts demotes the project root to a `/workspace`
 * mount and — when skills live outside the project root — adds an
 * `/ext-skills` mount. Skill directory paths are rewritten to the matching
 * virtual path, because skill discovery resolves through the workspace
 * filesystem (a CompositeFilesystem here) rather than off the real disk.
 */
import fs from "node:fs";
import path from "node:path";
import { LocalFilesystem } from "@mastra/core/workspace";
import { getSkillsDir, expandTilde } from "../utils/paths.js";
import type { FilesystemMount } from "../platform/agent-settings.js";

export interface BuildAgentMountsResult {
  /** Virtual mount path → LocalFilesystem, for `new Workspace({ mounts })`. */
  mounts: Record<string, LocalFilesystem>;
  /** Skill directories rewritten to virtual paths under their mount. */
  skillPaths: string[];
}

const WORKSPACE_MOUNT = "/workspace";
const EXT_SKILLS_MOUNT = "/ext-skills";

/** Rewrite a real host path to a virtual path under the given mount + base. */
function toVirtual(mountPath: string, base: string, hostPath: string): string {
  const rel = path.relative(base, hostPath).split(path.sep).join("/");
  return path.posix.join(mountPath, rel);
}

export function buildAgentMounts(opts: {
  cwd: string;
  configuredMounts: FilesystemMount[];
  skillPaths: string[];
  hasWorkspaceWrite: boolean;
}): BuildAgentMountsResult {
  const { cwd, configuredMounts, skillPaths, hasWorkspaceWrite } = opts;
  const mounts: Record<string, LocalFilesystem> = {};

  // Project root → /workspace. Read-only unless workspace_write is enabled —
  // mirrors the non-mount code path's `readOnly: !hasWorkspaceWrite`.
  mounts[WORKSPACE_MOUNT] = new LocalFilesystem({
    basePath: cwd,
    contained: true,
    readOnly: !hasWorkspaceWrite,
  });

  // Skills outside cwd come from getSkillsDir() (GOLEM_SKILLS_DIR). They can't
  // live under /workspace, so they get their own read-only /ext-skills mount.
  const skillsDir = getSkillsDir();
  const hasExternalSkills = skillPaths.some(p => !p.startsWith(cwd));
  if (hasExternalSkills) {
    mounts[EXT_SKILLS_MOUNT] = new LocalFilesystem({
      basePath: skillsDir,
      contained: true,
      readOnly: true,
    });
  }
  const rewrittenSkillPaths = skillPaths.map(p =>
    p.startsWith(cwd)
      ? toVirtual(WORKSPACE_MOUNT, cwd, p)
      : toVirtual(EXT_SKILLS_MOUNT, skillsDir, p),
  );

  // Configured external mounts → /mnt/<name>. Skip invalid, duplicate, or
  // missing-on-disk entries with a warning — the agent still starts.
  const seen = new Set<string>();
  for (const m of configuredMounts) {
    if (!/^[a-z0-9-]+$/.test(m.name) || m.name === "workspace") {
      console.warn(`[agent-mounts] skipping mount with invalid name "${m.name}"`);
      continue;
    }
    if (seen.has(m.name)) {
      console.warn(`[agent-mounts] skipping duplicate mount name "${m.name}"`);
      continue;
    }
    const hostPath = expandTilde(m.path);
    if (!fs.existsSync(hostPath)) {
      console.warn(`[agent-mounts] mount "${m.name}" path does not exist, skipping: ${hostPath}`);
      continue;
    }
    seen.add(m.name);
    mounts[`/mnt/${m.name}`] = new LocalFilesystem({
      basePath: hostPath,
      contained: true,
      readOnly: m.access === "ro",
    });
  }

  return { mounts, skillPaths: rewrittenSkillPaths };
}
