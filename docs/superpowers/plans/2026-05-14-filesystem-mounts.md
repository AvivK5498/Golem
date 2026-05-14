# Per-Agent Filesystem Mounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents read/write external directories (e.g. Obsidian vaults) by plumbing per-agent configurable filesystem mounts into the Mastra Workspace, each with its own read/write flag.

**Architecture:** A new per-agent `filesystem.mounts` setting (JSON array). When an agent has ≥1 mount, its Workspace switches from `filesystem:` to `mounts:` (a `CompositeFilesystem`) — Mastra forbids both. The project root is demoted to a `/workspace` mount; each configured mount lands at `/mnt/<name>`; skill directory paths are rewritten to virtual paths. A shared `buildAgentMounts()` helper does this for both top-level agents and sub-agents (which inherit the parent's mounts). Agents with zero mounts keep the existing code path untouched.

**Tech Stack:** TypeScript (ES modules, Node 20+), Mastra `@mastra/core` Workspace/LocalFilesystem, better-sqlite3 settings store, Next.js 16 UI.

**Spec:** `docs/superpowers/specs/2026-05-14-filesystem-mounts-design.md` · **Bead:** `Personal_Agent-oug` · **Branch:** `feat/filesystem-mounts` (already checked out)

**Note on verification:** This project's owner tests manually and does not want new test files/frameworks. Do NOT add `*.test.ts` files. Verification per task is:
- `npx tsc --noEmit -p tsconfig.json` — must be **clean** (the baseline passes; any error is yours).
- `npx eslint <files this task changed>` — scoped to the task's own files. **Do not run `npm run lint`** — it lints the whole tree and `src/test-harness.ts` has **13 pre-existing `no-explicit-any` errors + 1 warning** unrelated to this work. Leave those alone (owner's rule: don't fix adjacent/pre-existing code). For every file *except* `src/test-harness.ts`, scoped eslint must be **0 errors**.
- Task 7 modifies `src/test-harness.ts`, which is **gitignored** (`.gitignore` line 74) — a local-only dev tool, never tracked. Its `--mount` changes stay on disk, **uncommitted**. Verification is the Step 7/8 smoke tests (running the real harness), plus confirming zero new errors beyond the 13-error/1-warning eslint baseline.
- Task 7 also runs the real test harness; Task 8/9 have live smoke checks.

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `src/platform/agent-settings.ts` | `FilesystemMount` type, `FILESYSTEM_MOUNTS` key, `getMounts()` getter | Modify |
| `src/utils/paths.ts` | `expandTilde()` helper | Modify |
| `src/agents/agent-mounts.ts` | `buildAgentMounts()` — shared composite-mount builder + skill-path rewriting | **Create** |
| `src/platform/platform.ts` | Use `buildAgentMounts()` for top-level agents; `needsWorkspace` gains `hasMounts`; pass mounts resolver to `SubAgentRegistry`; pass `mounts` to prompt builder | Modify |
| `src/platform/sub-agent-registry.ts` | Thread a `mountsResolver` through `load`/`rebuild` to the loader | Modify |
| `src/agents/loader.ts` | `loadSubAgents` gains `parentMounts` param; workspace branch uses `buildAgentMounts()` | Modify |
| `src/platform/instructions.ts` | `mounts` param on `PromptParams` + new "Filesystem Mounts" prompt section | Modify |
| `src/server.ts` | `GET /api/platform/fs/exists` helper endpoint | Modify |
| `src/test-harness.ts` | `--mount` flag + workspace block routed through `buildAgentMounts()` | Modify |
| `ui/app/agents/[id]/page.tsx` | New "Filesystem" tab + `MountsEditor` component | Modify |
| `DESIGN.md`, `CLAUDE.md` | Document the new tab + current state | Modify |

---

## Task 1: `FilesystemMount` type, settings key, and getter

**Files:**
- Modify: `src/platform/agent-settings.ts`

- [ ] **Step 1: Add the `FilesystemMount` type**

In `src/platform/agent-settings.ts`, immediately after the `BEHAVIOR_DEFAULTS` const (ends at line 28, the closing `};`), add:

```typescript

// ── Filesystem mount type ──────────────────────────────────

export interface FilesystemMount {
  /** Slug → virtual path /mnt/<name>; matches /^[a-z0-9-]+$/, unique per agent. */
  name: string;
  /** Host absolute path. A leading ~ is expanded at workspace-build time. */
  path: string;
  /** Read-only or read-write access to this mount. */
  access: "ro" | "rw";
  /** Human description shown to the agent in its prompt. */
  description: string;
  /** Mount kind — only "vault" is active; reserved for future "brain" support. */
  kind: "vault";
}
```

- [ ] **Step 2: Add the settings key**

In the `SETTINGS_KEYS` object, immediately after the `MCP_SERVERS: "mcpServers",` line (line 77), add:

```typescript

  // Filesystem mounts (external directories — Obsidian vaults, etc.)
  FILESYSTEM_MOUNTS: "filesystem.mounts",
```

- [ ] **Step 3: Add the `getMounts()` getter**

In the `AgentSettings` class, immediately after the `getMcpServers()` method (the `}` closing it at line 346), add:

```typescript

  /** Per-agent filesystem mounts (external directories like Obsidian vaults). */
  getMounts(agentId: string): FilesystemMount[] {
    const raw = this.store.getJson<FilesystemMount[]>(agentId, SETTINGS_KEYS.FILESYSTEM_MOUNTS) ?? [];
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (m): m is FilesystemMount =>
        !!m &&
        typeof m.name === "string" &&
        typeof m.path === "string" &&
        (m.access === "ro" || m.access === "rw") &&
        m.kind === "vault",
    );
  }
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/platform/agent-settings.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/platform/agent-settings.ts
git commit -m "feat: add FilesystemMount type, settings key, and getMounts() getter"
```

---

## Task 2: `expandTilde()` path helper

**Files:**
- Modify: `src/utils/paths.ts`

- [ ] **Step 1: Add the `os` import**

In `src/utils/paths.ts`, change the import block at the top (lines 7-8):

```typescript
import fs from "node:fs";
import path from "node:path";
```

to:

```typescript
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
```

- [ ] **Step 2: Add the `expandTilde()` function**

At the end of `src/utils/paths.ts` (after the `dataPath` function, after line 38), add:

```typescript

/** Expand a leading ~ or ~/ in a path to the user's home directory. */
export function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/utils/paths.ts`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/utils/paths.ts
git commit -m "feat: add expandTilde() path helper"
```

---

## Task 3: `buildAgentMounts()` shared helper

**Files:**
- Create: `src/agents/agent-mounts.ts`

Depends on Task 1 (`FilesystemMount`) and Task 2 (`expandTilde`).

- [ ] **Step 1: Create the helper file**

Create `src/agents/agent-mounts.ts` with exactly this content:

```typescript
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
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/agents/agent-mounts.ts`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/agents/agent-mounts.ts
git commit -m "feat: add buildAgentMounts() shared composite-mount builder"
```

---

## Task 4: Wire mounts into top-level platform agents

**Files:**
- Modify: `src/platform/platform.ts`

Depends on Task 1 and Task 3.

- [ ] **Step 1: Add the `buildAgentMounts` import**

In `src/platform/platform.ts`, find line 32:

```typescript
import { loadSubAgents, resolveSkillPaths } from "../agents/loader.js";
```

Add directly below it:

```typescript
import { buildAgentMounts } from "../agents/agent-mounts.js";
```

- [ ] **Step 2: Resolve the agent's mounts**

Find this block (lines 321-324):

```typescript
  const WORKSPACE_READ = "workspace_read";
  const WORKSPACE_WRITE = "workspace_write";
  const hasWorkspaceRead = resolvedToolIds.includes(WORKSPACE_READ);
  const hasWorkspaceWrite = resolvedToolIds.includes(WORKSPACE_WRITE);
```

Replace it with:

```typescript
  const WORKSPACE_READ = "workspace_read";
  const WORKSPACE_WRITE = "workspace_write";
  const hasWorkspaceRead = resolvedToolIds.includes(WORKSPACE_READ);
  const hasWorkspaceWrite = resolvedToolIds.includes(WORKSPACE_WRITE);
  const mounts = agentSettings.getMounts(config.id);
  const hasMounts = mounts.length > 0;
```

- [ ] **Step 3: Add `hasMounts` to `needsWorkspace`**

Find line 342:

```typescript
  const needsWorkspace = hasSkills || hasWorkspaceRead || hasWorkspaceWrite;
```

Replace with:

```typescript
  const needsWorkspace = hasSkills || hasWorkspaceRead || hasWorkspaceWrite || hasMounts;
```

- [ ] **Step 4: Branch the workspace construction**

Find this block (lines 500-521):

```typescript
  if (needsWorkspace) {
    // Read-write only when workspace_write is explicitly enabled.
    // Skills-only agents (no workspace_read/write) get read-only access.
    const readOnly = !hasWorkspaceWrite;
    // If skills are in an external directory (GOLEM_SKILLS_DIR), disable containment
    // so Mastra can access skill files outside the project root.
    //
    // NOTE: Mastra Workspace basePath stays at process.cwd() so skills (which
    // live in the project root, outside the per-agent sandbox) remain
    // accessible. The per-agent sandbox is enforced separately via the
    // `repoPath` requestContext value, which code_agent and run_command read
    // to scope their cwd.
    const hasExternalSkills = hasSkills && skillPaths.some(p => !p.startsWith(process.cwd()));
    agentOptions.workspace = new Workspace({
      id: `${config.id}-workspace`,
      name: `${config.id} workspace`,
      filesystem: new LocalFilesystem({ basePath: process.cwd(), contained: !hasExternalSkills, readOnly }),
      skills: hasSkills ? skillPaths : undefined,
      bm25: hasSkills,
    });
    if (hasSkills) agentOptions.skillsFormat = "markdown";
  }
```

Replace it with:

```typescript
  if (needsWorkspace) {
    if (hasMounts) {
      // Agent has configured filesystem mounts. Mastra's Workspace forbids
      // `filesystem` + `mounts` together, so the project root is demoted to a
      // /workspace mount and skill paths are rewritten to virtual paths.
      // See buildAgentMounts.
      const built = buildAgentMounts({
        cwd: process.cwd(),
        configuredMounts: mounts,
        skillPaths,
        hasWorkspaceWrite,
      });
      agentOptions.workspace = new Workspace({
        id: `${config.id}-workspace`,
        name: `${config.id} workspace`,
        mounts: built.mounts,
        skills: hasSkills ? built.skillPaths : undefined,
        bm25: hasSkills,
      });
    } else {
      // Read-write only when workspace_write is explicitly enabled.
      // Skills-only agents (no workspace_read/write) get read-only access.
      const readOnly = !hasWorkspaceWrite;
      // If skills are in an external directory (GOLEM_SKILLS_DIR), disable containment
      // so Mastra can access skill files outside the project root.
      //
      // NOTE: Mastra Workspace basePath stays at process.cwd() so skills (which
      // live in the project root, outside the per-agent sandbox) remain
      // accessible. The per-agent sandbox is enforced separately via the
      // `repoPath` requestContext value, which code_agent and run_command read
      // to scope their cwd.
      const hasExternalSkills = hasSkills && skillPaths.some(p => !p.startsWith(process.cwd()));
      agentOptions.workspace = new Workspace({
        id: `${config.id}-workspace`,
        name: `${config.id} workspace`,
        filesystem: new LocalFilesystem({ basePath: process.cwd(), contained: !hasExternalSkills, readOnly }),
        skills: hasSkills ? skillPaths : undefined,
        bm25: hasSkills,
      });
    }
    if (hasSkills) agentOptions.skillsFormat = "markdown";
  }
```

- [ ] **Step 5: Pass a mounts resolver to `SubAgentRegistry`**

Find line 1011:

```typescript
  const subAgentRegistry = new SubAgentRegistry(loadSubAgents, getMCPTools(), agentStore);
```

Replace with:

```typescript
  const subAgentRegistry = new SubAgentRegistry(loadSubAgents, getMCPTools(), agentStore, (id) => agentSettings.getMounts(id));
```

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/platform/platform.ts`
Expected: no errors. (Note: `SubAgentRegistry`'s 4th constructor arg is added in Task 5; if running Task 4 strictly alone, `tsc` will flag the extra arg. Run Tasks 4 and 5 together, or expect this single error to clear after Task 5. Subagent-driven execution should treat Tasks 4 and 5 as a pair for the typecheck gate.)

- [ ] **Step 7: Commit**

```bash
git add src/platform/platform.ts
git commit -m "feat: wire filesystem mounts into top-level platform agents"
```

---

## Task 5: Wire mounts into sub-agents (inheritance)

**Files:**
- Modify: `src/platform/sub-agent-registry.ts`
- Modify: `src/agents/loader.ts`

Depends on Task 1 and Task 3. Pairs with Task 4 for the typecheck gate.

- [ ] **Step 1: Update `sub-agent-registry.ts` — imports and type**

In `src/platform/sub-agent-registry.ts`, find lines 9-12:

```typescript
import type { Agent } from "@mastra/core/agent";
import { logger } from "../utils/external-logger.js";

type LoadSubAgentsFn = (agentId: string | undefined, dynamicTools?: Record<string, unknown>, preloadedConfig?: Record<string, unknown> | null) => Record<string, Agent>;
```

Replace with:

```typescript
import type { Agent } from "@mastra/core/agent";
import { logger } from "../utils/external-logger.js";
import type { FilesystemMount } from "./agent-settings.js";

type LoadSubAgentsFn = (agentId: string | undefined, dynamicTools?: Record<string, unknown>, preloadedConfig?: Record<string, unknown> | null, parentMounts?: FilesystemMount[]) => Record<string, Agent>;
```

- [ ] **Step 2: Update `sub-agent-registry.ts` — constructor**

Find lines 14-24:

```typescript
export class SubAgentRegistry {
  private agents = new Map<string, Record<string, Agent>>();
  private loader: LoadSubAgentsFn;
  private dynamicTools: Record<string, unknown>;
  private agentStore?: { getSubAgents(id: string): Record<string, unknown> | null };

  constructor(loader: LoadSubAgentsFn, dynamicTools: Record<string, unknown> = {}, agentStore?: { getSubAgents(id: string): Record<string, unknown> | null }) {
    this.loader = loader;
    this.dynamicTools = dynamicTools;
    this.agentStore = agentStore;
  }
```

Replace with:

```typescript
export class SubAgentRegistry {
  private agents = new Map<string, Record<string, Agent>>();
  private loader: LoadSubAgentsFn;
  private dynamicTools: Record<string, unknown>;
  private agentStore?: { getSubAgents(id: string): Record<string, unknown> | null };
  private mountsResolver?: (agentId: string) => FilesystemMount[];

  constructor(
    loader: LoadSubAgentsFn,
    dynamicTools: Record<string, unknown> = {},
    agentStore?: { getSubAgents(id: string): Record<string, unknown> | null },
    mountsResolver?: (agentId: string) => FilesystemMount[],
  ) {
    this.loader = loader;
    this.dynamicTools = dynamicTools;
    this.agentStore = agentStore;
    this.mountsResolver = mountsResolver;
  }
```

- [ ] **Step 3: Update `sub-agent-registry.ts` — `load()`**

Find lines 26-36 (the `load` method):

```typescript
  /** Load sub-agents for a parent agent. Called once per agent at startup. */
  load(agentId: string): Record<string, Agent> {
    const preloaded = this.agentStore?.getSubAgents(agentId) ?? null;
    const subAgents = this.loader(agentId, this.dynamicTools, preloaded);
    this.agents.set(agentId, subAgents);
    const count = Object.keys(subAgents).length;
    if (count > 0) {
      logger.info(`Sub-agent registry loaded ${count} sub-agents for "${agentId}"`, { agent: agentId, count: String(count) });
    }
    return subAgents;
  }
```

Replace with:

```typescript
  /** Load sub-agents for a parent agent. Called once per agent at startup. */
  load(agentId: string): Record<string, Agent> {
    const preloaded = this.agentStore?.getSubAgents(agentId) ?? null;
    const parentMounts = this.mountsResolver?.(agentId) ?? [];
    const subAgents = this.loader(agentId, this.dynamicTools, preloaded, parentMounts);
    this.agents.set(agentId, subAgents);
    const count = Object.keys(subAgents).length;
    if (count > 0) {
      logger.info(`Sub-agent registry loaded ${count} sub-agents for "${agentId}"`, { agent: agentId, count: String(count) });
    }
    return subAgents;
  }
```

- [ ] **Step 4: Update `sub-agent-registry.ts` — `rebuild()`**

Find this line inside the `rebuild` method (line 52):

```typescript
      const preloaded = this.agentStore?.getSubAgents(agentId) ?? null;
      const subAgents = this.loader(agentId, this.dynamicTools, preloaded);
```

Replace with:

```typescript
      const preloaded = this.agentStore?.getSubAgents(agentId) ?? null;
      const parentMounts = this.mountsResolver?.(agentId) ?? [];
      const subAgents = this.loader(agentId, this.dynamicTools, preloaded, parentMounts);
```

- [ ] **Step 5: Update `loader.ts` — imports**

In `src/agents/loader.ts`, find line 18:

```typescript
import { getSkillsDir } from "../utils/paths.js";
```

Replace with:

```typescript
import { getSkillsDir } from "../utils/paths.js";
import { buildAgentMounts } from "./agent-mounts.js";
import type { FilesystemMount } from "../platform/agent-settings.js";
```

- [ ] **Step 6: Update `loader.ts` — `loadSubAgents` signature**

Find lines 224-228:

```typescript
export function loadSubAgents(
  agentId: string | undefined,
  dynamicTools: Record<string, unknown> = {},
  preloadedConfig?: Record<string, unknown> | null,
): Record<string, Agent> {
```

Replace with:

```typescript
export function loadSubAgents(
  agentId: string | undefined,
  dynamicTools: Record<string, unknown> = {},
  preloadedConfig?: Record<string, unknown> | null,
  parentMounts: FilesystemMount[] = [],
): Record<string, Agent> {
```

- [ ] **Step 7: Update `loader.ts` — workspace branch**

Find lines 353-373:

```typescript
    const hasSkills = skillPaths.length > 0;
    const needsWorkspace = hasWorkspaceRead || hasWorkspaceWrite || hasSkills;

    if (needsWorkspace) {
      const readOnly = !hasWorkspaceWrite;
      // If any configured skill lives outside the project root (e.g. when
      // GOLEM_SKILLS_DIR points at an external dir like ~/golem-data/skills),
      // Mastra's containment check rejects it with a permission error and the
      // skill loads as empty. Disable containment in that case so the
      // filesystem can reach the external skill directory — mirrors the
      // platform-agent path in platform.ts.
      const hasExternalSkills = hasSkills && skillPaths.some(p => !p.startsWith(process.cwd()));
      agentOptions.workspace = new Workspace({
        id: `sub-${id}-workspace`,
        name: `${id} workspace`,
        filesystem: new LocalFilesystem({ basePath: process.cwd(), contained: !hasExternalSkills, readOnly }),
        skills: hasSkills ? skillPaths : undefined,
        bm25: hasSkills,
      });
      if (hasSkills) agentOptions.skillsFormat = "markdown";
    }
```

Replace it with:

```typescript
    const hasSkills = skillPaths.length > 0;
    const hasMounts = parentMounts.length > 0;
    const needsWorkspace = hasWorkspaceRead || hasWorkspaceWrite || hasSkills || hasMounts;

    if (needsWorkspace) {
      if (hasMounts) {
        // Sub-agent inherits the parent agent's filesystem mounts. Mastra
        // forbids `filesystem` + `mounts` together — see buildAgentMounts.
        const built = buildAgentMounts({
          cwd: process.cwd(),
          configuredMounts: parentMounts,
          skillPaths,
          hasWorkspaceWrite,
        });
        agentOptions.workspace = new Workspace({
          id: `sub-${id}-workspace`,
          name: `${id} workspace`,
          mounts: built.mounts,
          skills: hasSkills ? built.skillPaths : undefined,
          bm25: hasSkills,
        });
      } else {
        const readOnly = !hasWorkspaceWrite;
        // If any configured skill lives outside the project root (e.g. when
        // GOLEM_SKILLS_DIR points at an external dir like ~/golem-data/skills),
        // Mastra's containment check rejects it with a permission error and the
        // skill loads as empty. Disable containment in that case so the
        // filesystem can reach the external skill directory — mirrors the
        // platform-agent path in platform.ts.
        const hasExternalSkills = hasSkills && skillPaths.some(p => !p.startsWith(process.cwd()));
        agentOptions.workspace = new Workspace({
          id: `sub-${id}-workspace`,
          name: `${id} workspace`,
          filesystem: new LocalFilesystem({ basePath: process.cwd(), contained: !hasExternalSkills, readOnly }),
          skills: hasSkills ? skillPaths : undefined,
          bm25: hasSkills,
        });
      }
      if (hasSkills) agentOptions.skillsFormat = "markdown";
    }
```

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/platform/sub-agent-registry.ts src/agents/loader.ts`
Expected: no errors (this clears the Task 4 Step 6 note about the 4th constructor arg).

- [ ] **Step 9: Commit**

```bash
git add src/platform/sub-agent-registry.ts src/agents/loader.ts
git commit -m "feat: sub-agents inherit parent filesystem mounts"
```

---

## Task 6: "Filesystem Mounts" system prompt section

**Files:**
- Modify: `src/platform/instructions.ts`
- Modify: `src/platform/platform.ts`

Depends on Task 1.

- [ ] **Step 1: Import the `FilesystemMount` type in `instructions.ts`**

In `src/platform/instructions.ts`, find line 6:

```typescript
import type { BehaviorConfig } from "./agent-settings.js";
```

Replace with:

```typescript
import type { BehaviorConfig, FilesystemMount } from "./agent-settings.js";
```

- [ ] **Step 2: Add `mounts` to `PromptParams`**

In `src/platform/instructions.ts`, find the end of the `PromptParams` interface — the `inboundWasVoice?: boolean;` field and the closing `}` (lines 226-227):

```typescript
  inboundWasVoice?: boolean;
}
```

Replace with:

```typescript
  inboundWasVoice?: boolean;
  /**
   * Per-agent filesystem mounts. When non-empty, a "Filesystem Mounts" section
   * is added listing each mount's virtual path, access mode, and description.
   */
  mounts?: FilesystemMount[];
}
```

- [ ] **Step 3: Destructure `mounts` in `buildPlatformPromptSections`**

Find the destructuring block (lines 231-243):

```typescript
  const {
    agentName,
    characterName,
    ownerName = "the user",
    role = "personal assistant",
    lastMessages = 12,
    isGroup = false,
    behavior,
    tempoSincePreviousUserMessage,
    tempoBand,
    ttsMode,
    inboundWasVoice = false,
  } = params;
```

Replace with:

```typescript
  const {
    agentName,
    characterName,
    ownerName = "the user",
    role = "personal assistant",
    lastMessages = 12,
    isGroup = false,
    behavior,
    tempoSincePreviousUserMessage,
    tempoBand,
    ttsMode,
    inboundWasVoice = false,
    mounts,
  } = params;
```

- [ ] **Step 4: Push the "Filesystem Mounts" section**

Find the `sections.push(...)` call that pushes Memory / Failure Handling / Formatting — it ends at line 307 with `);`. Immediately after that `);` (and before the `const responseLength = behavior?.responseLength || "balanced";` line at 309), insert:

```typescript

  // Filesystem mounts — external directories the agent can read/write. Static
  // (config-stable) so it stays in the cacheable prompt prefix.
  if (mounts && mounts.length > 0) {
    const rows = mounts.map(m => {
      const mode = m.access === "rw" ? "read-write" : "read-only";
      return `- /mnt/${m.name} (${mode}) — ${m.description || "no description"}`;
    });
    sections.push({
      label: "Filesystem Mounts",
      content: `You have these directories mounted. Use the workspace file tools (read_file, write_file, edit_file, list_files, grep) to work with them.\n\n${rows.join("\n")}`,
    });
  }
```

- [ ] **Step 5: Pass `mounts` from `platform.ts`**

In `src/platform/platform.ts`, find the `buildPlatformPromptSections` call (lines 367-377):

```typescript
      const promptSections = buildPlatformPromptSections({
        agentName: config.name,
        characterName: config.characterName,
        ownerName: config.ownerName,
        role: config.role,
        lastMessages: agentSettings.getLastMessages(config.id) ?? 12,
        isGroup,
        behavior,
        ttsMode,
        inboundWasVoice,
      });
```

Replace with:

```typescript
      const promptSections = buildPlatformPromptSections({
        agentName: config.name,
        characterName: config.characterName,
        ownerName: config.ownerName,
        role: config.role,
        lastMessages: agentSettings.getLastMessages(config.id) ?? 12,
        isGroup,
        behavior,
        ttsMode,
        inboundWasVoice,
        mounts,
      });
```

(`mounts` is the variable added to `createPlatformAgent` in Task 4 Step 2 — it is in closure scope here.)

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/platform/instructions.ts src/platform/platform.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/platform/instructions.ts src/platform/platform.ts
git commit -m "feat: add Filesystem Mounts system prompt section"
```

---

## Task 7: `--mount` flag in the test harness

**Files:**
- Modify: `src/test-harness.ts`

Depends on Task 3 and Task 6.

- [ ] **Step 1: Add imports**

In `src/test-harness.ts`, find line 38:

```typescript
import { resolveSkillPaths } from "./agents/loader.js";
```

Replace with:

```typescript
import { resolveSkillPaths } from "./agents/loader.js";
import { buildAgentMounts } from "./agents/agent-mounts.js";
import type { FilesystemMount } from "./platform/agent-settings.js";
```

- [ ] **Step 2: Add the `mounts` accumulator and `parseMountSpec`**

Find the CLI variable declarations — line 56:

```typescript
const messageParts: string[] = [];
```

Replace with:

```typescript
const messageParts: string[] = [];
const mounts: FilesystemMount[] = [];

/** Parse a --mount spec "name:path:access" → FilesystemMount. Splits on the
 *  first and last colon so the path may itself contain colons. */
function parseMountSpec(spec: string): FilesystemMount {
  const first = spec.indexOf(":");
  const last = spec.lastIndexOf(":");
  if (first === -1 || first === last) {
    throw new Error(`Bad --mount spec "${spec}" (expected name:path:access, e.g. vault:/path/to/dir:rw)`);
  }
  const name = spec.slice(0, first);
  const mountPath = spec.slice(first + 1, last);
  const access = spec.slice(last + 1);
  if (access !== "ro" && access !== "rw") {
    throw new Error(`Bad --mount access "${access}" in "${spec}" (must be "ro" or "rw")`);
  }
  return { name, path: mountPath, access, description: `test mount: ${name}`, kind: "vault" };
}
```

- [ ] **Step 3: Parse the `--mount` flag**

Find this line in the arg-parsing loop (line 67):

```typescript
  if (args[i] === "--smart-memory" && args[i + 1]) { smartMemorySpec = args[++i]; continue; }
```

Add directly below it:

```typescript
  if (args[i] === "--mount" && args[i + 1]) { mounts.push(parseMountSpec(args[++i])); continue; }
```

- [ ] **Step 4: Pass `mounts` to the prompt builder**

Find the `buildPlatformPromptSections` call (lines 260-268):

```typescript
      const sections = buildPlatformPromptSections({
        agentName: testConfig.name,
        ownerName: testConfig.ownerName,
        role: testConfig.role,
        lastMessages: testConfig.memory.lastMessages,
        behavior,
        ...(tempo && { tempoSincePreviousUserMessage: tempo }),
        ...(tempoBand && { tempoBand }),
      });
```

Replace with:

```typescript
      const sections = buildPlatformPromptSections({
        agentName: testConfig.name,
        ownerName: testConfig.ownerName,
        role: testConfig.role,
        lastMessages: testConfig.memory.lastMessages,
        behavior,
        ...(mounts.length > 0 && { mounts }),
        ...(tempo && { tempoSincePreviousUserMessage: tempo }),
        ...(tempoBand && { tempoBand }),
      });
```

- [ ] **Step 5: Route the workspace block through `buildAgentMounts()`**

Find the workspace IIFE (lines 292-309):

```typescript
    ...(() => {
      const skillPaths = resolveSkillPaths(testConfig.skills || []);
      if (skillPaths.length > 0) {
        console.log(`[harness] Skills: ${skillPaths.map(p => p.split("/").pop()).join(", ")}`);
        const hasExternalSkills = skillPaths.some(p => !p.startsWith(process.cwd()));
        return {
          workspace: new Workspace({
            id: "test-workspace",
            name: "test workspace",
            filesystem: new LocalFilesystem({ basePath: process.cwd(), contained: !hasExternalSkills, readOnly: true }),
            skills: skillPaths,
            bm25: true,
          }),
          skillsFormat: "markdown",
        };
      }
      return {};
    })(),
```

Replace it with:

```typescript
    ...(() => {
      const skillPaths = resolveSkillPaths(testConfig.skills || []);
      const hasSkills = skillPaths.length > 0;
      if (hasSkills) {
        console.log(`[harness] Skills: ${skillPaths.map(p => p.split("/").pop()).join(", ")}`);
      }
      if (mounts.length > 0) {
        console.log(`[harness] Mounts: ${mounts.map(m => `/mnt/${m.name} (${m.access})`).join(", ")}`);
        const built = buildAgentMounts({
          cwd: process.cwd(),
          configuredMounts: mounts,
          skillPaths,
          hasWorkspaceWrite: false,
        });
        return {
          workspace: new Workspace({
            id: "test-workspace",
            name: "test workspace",
            mounts: built.mounts,
            skills: hasSkills ? built.skillPaths : undefined,
            bm25: hasSkills,
          }),
          ...(hasSkills && { skillsFormat: "markdown" as const }),
        };
      }
      if (hasSkills) {
        const hasExternalSkills = skillPaths.some(p => !p.startsWith(process.cwd()));
        return {
          workspace: new Workspace({
            id: "test-workspace",
            name: "test workspace",
            filesystem: new LocalFilesystem({ basePath: process.cwd(), contained: !hasExternalSkills, readOnly: true }),
            skills: skillPaths,
            bm25: true,
          }),
          skillsFormat: "markdown" as const,
        };
      }
      return {};
    })(),
```

- [ ] **Step 6: Typecheck and scoped lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: clean (exit 0).

Run: `npx eslint src/test-harness.ts`
Expected: `src/test-harness.ts` has a **pre-existing baseline of 13 errors + 1 warning** (`no-explicit-any`, `prefer-const`, an unused-disable warning) that are NOT yours — do not fix them (owner's rule: don't touch adjacent/pre-existing code). Your job: confirm the error/warning **count did not increase** from that baseline. If your added code introduced a *new* eslint error, fix only that. To compare cleanly: `git stash && npx eslint src/test-harness.ts; git stash pop` shows the baseline, then re-run on your version.

```bash
rm -rf /tmp/golem-mount-test && mkdir -p /tmp/golem-mount-test && echo "existing note" > /tmp/golem-mount-test/note.md
npx tsx src/test-harness.ts --verbose --mount vault:/tmp/golem-mount-test:rw "List the files under /mnt/vault, then create /mnt/vault/created-by-agent.md with the text 'hello from the agent'."
```

Expected: harness prints `[harness] Mounts: /mnt/vault (rw)`; verbose tool-call lines show `list_files` / `write_file` on `/mnt/vault/...` succeeding. Then verify the write landed on real disk:

```bash
cat /tmp/golem-mount-test/created-by-agent.md
```

Expected: prints `hello from the agent` (exact wording may vary slightly with the LLM, but the file must exist with agent-written content).

- [ ] **Step 8: Smoke test — a ro mount rejects writes**

```bash
npx tsx src/test-harness.ts --verbose --mount vault:/tmp/golem-mount-test:ro "Create /mnt/vault/should-fail.md with the text 'nope'."
```

Expected: the `write_file` tool call returns a permission/read-only error in the verbose output; `/tmp/golem-mount-test/should-fail.md` does NOT exist (`ls /tmp/golem-mount-test` should not list it).

- [ ] **Step 9: Do NOT commit — `src/test-harness.ts` is gitignored**

`src/test-harness.ts` is intentionally gitignored (`.gitignore` line 74, under "# Tests"; also excluded from the npm package via `package.json` `files`). It is a local-only dev tool and is never tracked. The `--mount` changes therefore stay **on disk, uncommitted** — that is the correct end state. Do NOT `git add` or `git add -f` this file. The deliverable is the working file on disk, verified by the Step 7/8 smoke tests.

---

## Task 8: `GET /api/platform/fs/exists` endpoint

**Files:**
- Modify: `src/server.ts`

Independent of other tasks.

- [ ] **Step 1: Add the endpoint**

In `src/server.ts`, find the end of the agent-settings PATCH handler — the closing of that `if` block at line 879:

```typescript
        return json(res, { ok: true });
      } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 400); }
    }

    // ── Webhook Scenario CRUD ──────────────────────────────────
```

Replace it with:

```typescript
        return json(res, { ok: true });
      } catch (err) { return json(res, { error: err instanceof Error ? err.message : String(err) }, 400); }
    }

    // ── Filesystem path existence check (for the agent Filesystem tab) ──
    if (req.method === "GET" && pathname === "/api/platform/fs/exists") {
      const qPath = new URL(req.url ?? "", "http://localhost").searchParams.get("path") ?? "";
      const expanded = qPath === "~"
        ? os.homedir()
        : qPath.startsWith("~/")
          ? path.join(os.homedir(), qPath.slice(2))
          : qPath;
      let exists = false;
      let isDirectory = false;
      try {
        const st = fs.statSync(expanded);
        exists = true;
        isDirectory = st.isDirectory();
      } catch { /* path does not exist — leave both false */ }
      return json(res, { path: qPath, exists, isDirectory });
    }

    // ── Webhook Scenario CRUD ──────────────────────────────────
```

(`fs`, `path`, and `os` are already imported at the top of `server.ts`, lines 2-4. `pathname` is already in scope — it's used by `agentSettingsMatch` just above.)

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/server.ts`
Expected: no errors.

- [ ] **Step 3: Smoke test the endpoint**

Start the platform if not running (`npm start` in another terminal, or rely on the launchd service), then:

```bash
curl -s "http://localhost:3847/api/platform/fs/exists?path=$(pwd)" ; echo
curl -s "http://localhost:3847/api/platform/fs/exists?path=/nonexistent/path/xyz" ; echo
```

Expected: first returns `{"path":"...","exists":true,"isDirectory":true}`; second returns `{"path":"/nonexistent/path/xyz","exists":false,"isDirectory":false}`. (Port is `GOLEM_PORT` or default `3847`.)

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: add GET /api/platform/fs/exists endpoint"
```

---

## Task 9: "Filesystem" tab + `MountsEditor` component (UI)

**Files:**
- Modify: `ui/app/agents/[id]/page.tsx`

Depends on Task 8 (the path-exists endpoint).

- [ ] **Step 1: Add `"filesystem"` to the `TabId` type**

In `ui/app/agents/[id]/page.tsx`, find line 75:

```typescript
type TabId = "identity" | "model" | "memory" | "tools" | "subagents" | "crons" | "webhooks" | "telegram" | "proactive" | "runtime";
```

Replace with:

```typescript
type TabId = "identity" | "model" | "memory" | "tools" | "subagents" | "filesystem" | "crons" | "webhooks" | "telegram" | "proactive" | "runtime";
```

- [ ] **Step 2: Add the nav entry under "Capabilities"**

Find the Capabilities group in `NAV_GROUPS`:

```typescript
  {
    label: "Capabilities",
    items: [
      { id: "tools", label: "Tools / MCP / Skills" },
      { id: "subagents", label: "Sub-agents" },
      { id: "crons", label: "Schedules" },
    ],
  },
```

Replace with:

```typescript
  {
    label: "Capabilities",
    items: [
      { id: "tools", label: "Tools / MCP / Skills" },
      { id: "subagents", label: "Sub-agents" },
      { id: "filesystem", label: "Filesystem" },
      { id: "crons", label: "Schedules" },
    ],
  },
```

- [ ] **Step 3: Add the `Mount` type and `MountsEditor` component**

In `ui/app/agents/[id]/page.tsx`, find the line `function SubAgentsEditor(` (around line 603). Immediately **before** that line, insert:

```typescript
type Mount = { name: string; path: string; access: "ro" | "rw"; description: string; kind: "vault" };

function MountsEditor({ agentId, settingsData, refetchSettings }: {
  agentId: string;
  settingsData: Record<string, string> | null;
  refetchSettings: () => void;
}) {
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [newName, setNewName] = useState("");
  const [newNameError, setNewNameError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pathStatus, setPathStatus] = useState<Record<number, "checking" | "ok" | "missing">>({});

  useEffect(() => {
    if (!settingsData) return;
    if (settingsData["filesystem.mounts"]) {
      try {
        const parsed = JSON.parse(settingsData["filesystem.mounts"]);
        if (Array.isArray(parsed)) setMounts(parsed);
      } catch { /* ignore malformed JSON */ }
    }
  }, [settingsData]);

  function updateMount(idx: number, patch: Partial<Mount>) {
    setMounts(prev => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  }

  function deleteMount(idx: number) {
    setMounts(prev => prev.filter((_, i) => i !== idx));
    setPathStatus(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  }

  function addMount() {
    const name = newName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!name) { setNewNameError("Enter a name first"); return; }
    if (name === "workspace") { setNewNameError(`"workspace" is reserved`); return; }
    if (mounts.some(m => m.name === name)) { setNewNameError(`"${name}" already exists`); return; }
    setNewNameError("");
    setMounts(prev => [...prev, { name, path: "", access: "rw", description: "", kind: "vault" }]);
    setNewName("");
  }

  async function checkPath(idx: number, p: string) {
    if (!p.trim()) {
      setPathStatus(prev => {
        const next = { ...prev };
        delete next[idx];
        return next;
      });
      return;
    }
    setPathStatus(prev => ({ ...prev, [idx]: "checking" }));
    try {
      const res = await fetch(`/api/platform/fs/exists?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      setPathStatus(prev => ({ ...prev, [idx]: data.exists && data.isDirectory ? "ok" : "missing" }));
    } catch {
      setPathStatus(prev => ({ ...prev, [idx]: "missing" }));
    }
  }

  async function saveAll() {
    for (const m of mounts) {
      if (!m.name || !/^[a-z0-9-]+$/.test(m.name)) { toast.error(`Invalid mount name "${m.name}"`); return; }
      if (!m.path.trim()) { toast.error(`Mount "${m.name}" has no path`); return; }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agents/${agentId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "filesystem.mounts": mounts }),
      });
      if (res.ok) {
        refetchSettings();
        toast.success("Mounts saved — restart to apply");
      } else {
        toast.error("Failed to save mounts");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs">Filesystem Mounts</CardTitle>
          <span className="text-[9px] text-muted-foreground">restart required</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          External directories (e.g. Obsidian vaults) the agent can read or write. Each mount appears to the agent at <code className="font-mono">/mnt/&lt;name&gt;</code>. Sub-agents inherit these mounts.
        </p>

        {mounts.map((m, idx) => (
          <div key={idx} className="border border-border/60 rounded-md p-3 space-y-3 bg-card/30">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono">/mnt/{m.name}</span>
              <Button size="sm" variant="ghost" className="h-5 text-[9px] px-1.5 text-destructive" onClick={() => deleteMount(idx)}>
                Remove
              </Button>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Host path</label>
              <input
                value={m.path}
                onChange={e => updateMount(idx, { path: e.target.value })}
                onBlur={e => checkPath(idx, e.target.value)}
                placeholder="/Users/you/Obsidian/Vault or ~/Obsidian/Vault"
                className={`${inputClass} font-mono ${pathStatus[idx] === "missing" ? "!border-destructive" : pathStatus[idx] === "ok" ? "!border-green-600" : ""}`}
              />
              {pathStatus[idx] === "checking" && <p className="text-[9px] text-muted-foreground">Checking…</p>}
              {pathStatus[idx] === "ok" && <p className="text-[9px] text-green-600">Directory exists</p>}
              {pathStatus[idx] === "missing" && <p className="text-[9px] text-destructive">Not found or not a directory</p>}
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Access</label>
              <select
                value={m.access}
                onChange={e => updateMount(idx, { access: e.target.value as "ro" | "rw" })}
                className={`${inputClass} h-[38px]`}
              >
                <option value="rw">read-write</option>
                <option value="ro">read-only</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Description</label>
              <input
                value={m.description}
                onChange={e => updateMount(idx, { description: e.target.value })}
                placeholder="What the agent uses this mount for"
                className={inputClass}
              />
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <div className="relative">
            <input
              value={newName}
              onChange={e => { setNewName(e.target.value); setNewNameError(""); }}
              onKeyDown={e => e.key === "Enter" && addMount()}
              placeholder="mount-name"
              className={`${inputClass} w-40 !py-1 !text-[11px] ${newNameError ? "!border-destructive" : ""}`}
            />
            {newNameError && <p className="absolute -bottom-4 left-0 text-[9px] text-destructive whitespace-nowrap">{newNameError}</p>}
          </div>
          <Button size="sm" variant="outline" onClick={addMount} className="h-6 text-[10px] px-2">Add Mount</Button>
        </div>

        <div className="flex justify-end pt-3">
          <Button onClick={saveAll} disabled={saving} size="sm">{saving ? "Saving..." : "Save Mounts"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

```

- [ ] **Step 4: Render the tab**

Find the line `{tab === "telegram" && (` in the render switch (around line 2244). Immediately **before** that line, insert:

```typescript
            {tab === "filesystem" && (
              <MountsEditor agentId={id} settingsData={settingsData} refetchSettings={refetchSettings} />
            )}
```

(`id`, `settingsData`, and `refetchSettings` are already in scope in the component body — `id` is the route param, `settingsData`/`refetchSettings` come from the `useFetch` call at lines 1136-1138.)

- [ ] **Step 5: Typecheck the UI**

Run: `cd ui && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 6: Manual UI check**

With the platform + UI running (`npm start`), open `http://localhost:3015/agents/<an agent id>`, click the **Filesystem** tab under Capabilities. Verify: you can add a mount, the host-path field shows a green "Directory exists" when you enter a real directory and a red "Not found" otherwise, and "Save Mounts" shows the success toast. Reload the page and confirm the mount persists.

- [ ] **Step 7: Commit**

```bash
git add ui/app/agents/\[id\]/page.tsx
git commit -m "feat: add Filesystem tab with MountsEditor to agent detail page"
```

---

## Task 10: Documentation

**Files:**
- Modify: `DESIGN.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `DESIGN.md`**

Read `DESIGN.md`. Find where the agent detail page tabs / capabilities are documented (search for "Sub-agents" or "Capabilities" or the tab list). Add a short entry for the **Filesystem** tab consistent with the surrounding style — one or two sentences: it configures per-agent filesystem mounts (external directories like Obsidian vaults), each mount has a name → `/mnt/<name>` virtual path, a host path, an access mode (read-only / read-write), and a description; sub-agents inherit the parent's mounts. If `DESIGN.md` has no per-tab section, add a brief "Filesystem mounts" subsection near the agent-detail UI description instead.

- [ ] **Step 2: Update `CLAUDE.md` "Current State"**

In `CLAUDE.md`, find the "## Current State" section. Update the `**Last updated**` date to today (`2026-05-14`) and add a bullet: `- Per-agent filesystem mounts — external directories (Obsidian vaults) mounted at /mnt/<name> via Mastra CompositeFilesystem; configured in the agent Filesystem tab`.

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md CLAUDE.md
git commit -m "docs: document per-agent filesystem mounts"
```

---

## Done

After Task 10: close the bead.

```bash
bd close Personal_Agent-oug --reason "Per-agent filesystem mounts implemented — buildAgentMounts helper, platform + sub-agent wiring, prompt section, --mount harness flag, fs/exists endpoint, Filesystem UI tab."
```

Do NOT push — pushing waits for the owner's explicit approval (per CLAUDE.md).
