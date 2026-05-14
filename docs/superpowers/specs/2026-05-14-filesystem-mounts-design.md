# Per-Agent Filesystem Mounts — Design

**Bead:** `Personal_Agent-oug`
**Date:** 2026-05-14
**Status:** Approved (design), pending implementation plan

## Problem

Agents whose persona tells them to read/write external directories (e.g. an Obsidian
vault) currently can't. Mastra's workspace filesystem is rooted at `process.cwd()`
(`platform.ts:516`), so workspace tools cannot reach paths outside the project root.
When an agent is told to "log to Obsidian," it flails — runs `read` as a shell command
via `run_command`, guesses at "today's file," reports `updateWorkingMemory unavailable`.

The fix: a per-agent, configurable list of external directories ("mounts") plumbed into
the agent's workspace, with each mount independently read-only or read-write, plus a
system-prompt section telling the agent what's mounted and where.

This also lays plumbing for a future "agent brain" feature — a brain is the same
primitive (a named external directory) plus a skill. The `kind` field reserves that
seam without building it now.

## Decisions (from grilling)

1. **Write model:** per-mount filesystems, each with its own `readOnly`. A vault can be
   read-write while the Golem codebase stays read-only. (Rejected: single `allowedPaths`
   filesystem — only one shared `readOnly` flag, can't isolate vault-write from
   project-write.)
2. **Addressing:** virtual paths `/mnt/<name>`. The agent never sees host-specific
   absolute paths; prompt text is portable.
3. **UI placement:** new "Filesystem" tab in the Capabilities nav group of the agent
   detail page.
4. **Per-mount `description` field:** included — without it the prompt section can only
   show a bare path.
5. **Sub-agents:** inherit all of the parent agent's mounts.

## Verified constraints (Mastra `@mastra/core`)

- `Workspace` constructor **throws** `Cannot use both "filesystem" and "mounts"`. The two
  are mutually exclusive. → An agent with mounts passes `mounts:` only; the project root
  is demoted to a `/workspace` mount. An agent with zero mounts keeps the existing
  `filesystem:` branch verbatim.
- With `mounts`, `Workspace._fs` becomes a `CompositeFilesystem` that routes operations
  by path prefix — pure in-process routing, no sandbox/FUSE, no copying. `/mnt/x/foo.md`
  → the `x` mount's `LocalFilesystem(basePath)` → real file on disk.
- A `LocalFilesystem` mount with `contained: false` warns and breaks path routing under a
  composite. → every mount stays `contained: true`; the external-skills dir (the one
  place Golem uses `contained: false` today) becomes its own mount instead.
- Skill discovery resolves through `Workspace._fs` (`source = skillSource ?? _fs ??
  LocalSkillSource`). → in the composite branch, skill paths must be rewritten to virtual
  paths under their mount. `resolveSkillPaths` returns dirs under at most two roots
  (default `skills/` + optional `GOLEM_SKILLS_DIR`), so this is bounded.
- `LocalFilesystem` supports read **and** write outside `basePath`; `readOnly` and
  reachability are independent flags.

## Data model

New per-agent setting `filesystem.mounts` in `settings.db`, a JSON array:

```ts
type FilesystemMount = {
  name: string;        // slug → virtual path /mnt/<name>; /^[a-z0-9-]+$/, unique per agent,
                       // and not equal to "workspace"
  path: string;        // host absolute path; leading ~ expanded
  access: "ro" | "rw";
  description: string; // shown to the agent in the prompt section
  kind: "vault";       // reserved enum; only "vault" accepted now, "brain" later
};
```

Stored/read exactly like `allowedGroups` and `tools` — JSON via the settings store.

## Architecture

### Backend — `buildAgentMounts()` helper (new)

A single shared helper builds the `mounts` object so the composite logic isn't duplicated
between top-level agents (`platform.ts`) and sub-agents (`agents/loader.ts`).

Inputs: cwd, resolved skill paths, the mounts config array, `hasWorkspaceWrite`,
`hasExternalSkills`.

Output: a `{ mounts, skillPaths }` pair where:

- `mounts` maps virtual paths to `LocalFilesystem` instances:
  - `/workspace` → `LocalFilesystem({ basePath: cwd, contained: true, readOnly: !hasWorkspaceWrite })`
  - `/mnt/<name>` → `LocalFilesystem({ basePath: expandTilde(path), contained: true, readOnly: access === "ro" })`, one per configured mount
  - `/ext-skills` → `LocalFilesystem({ basePath: <GOLEM_SKILLS_DIR>, contained: true, readOnly: true })`, only when external skills exist
- `skillPaths` are the input skill dirs rewritten to virtual paths under `/workspace`
  (or `/ext-skills`).

### `platform.ts` (`createPlatformAgent`, ~336–521)

- Resolve `const mounts = agentSettings.getMounts(config.id)`; `hasMounts = mounts.length > 0`.
- `needsWorkspace = hasSkills || hasWorkspaceRead || hasWorkspaceWrite || hasMounts`.
- In the `if (needsWorkspace)` block: **if `hasMounts`**, call `buildAgentMounts()` and
  construct `new Workspace({ mounts, skills: rewrittenSkillPaths, ... })`. **Else**, the
  existing `new Workspace({ filesystem: new LocalFilesystem(...) })` path is unchanged.

### `agents/loader.ts` (sub-agent workspace, ~348–373)

Same branching. Sub-agents call `buildAgentMounts()` with the **parent agent's** mounts
list, so they inherit all mounts.

### System prompt — `instructions.ts`

A new static section (built in `buildPlatformPromptSections`, inserted near the Memory
section, **before** the cache boundary since mounts are config-stable):

```
## Filesystem Mounts

You have these directories mounted. Use the workspace file tools (read_file, write_file,
edit_file, list_files, grep) to work with them.

- /mnt/nutrition (read-write) — daily nutrition log + meal notes
- /mnt/reference (read-only) — research notes vault
```

Only rendered when the agent has ≥1 mount.

### UI — agent detail page

- New `TabId` `"filesystem"` added to the Capabilities group in `NAV_GROUPS`
  (`ui/app/agents/[id]/page.tsx`).
- A `MountsEditor` component following the existing `SubAgentsEditor` pattern: an
  add-row input + button, an expandable list with delete buttons, one Save button.
  Each row edits `name`, `path`, `access` (dropdown), `description`.
- Saves the `filesystem.mounts` key through the **existing**
  `PATCH /api/platform/agents/[id]/settings` endpoint — no new settings route.
- Inline path-existence indicator (red/green) per row, backed by one tiny new endpoint
  `GET /api/platform/fs/exists?path=<host path>` in `server.ts`.

## Error handling

- **Non-existent mount path:** backend logs a warning at agent build (same style as the
  existing duplicate-token warnings) and skips that mount; the agent still starts. The
  UI's exists-check surfaces it earlier, at config time.
- **Invalid or duplicate `name`, or `name === "workspace"`:** rejected with a clear
  error before save.
- **`kind` other than `"vault"`:** rejected — the enum is reserved but not yet active.
- **`access` other than `ro`/`rw`:** rejected.

## Components touched

| Unit | Change |
|------|--------|
| `src/platform/agent-settings.ts` | `FILESYSTEM_MOUNTS` key, `FilesystemMount` type, `getMounts()` getter |
| `buildAgentMounts()` helper | New — shared composite-mount builder + skill-path rewriting |
| `src/platform/platform.ts` | Call helper in the `needsWorkspace` branch when `hasMounts`; add `hasMounts` to `needsWorkspace` |
| `src/agents/loader.ts` | Same branching for sub-agents; pass parent's mounts |
| `src/platform/instructions.ts` | New "Filesystem Mounts" prompt section |
| `src/server.ts` | `GET /api/platform/fs/exists` helper endpoint |
| `ui/app/agents/[id]/page.tsx` | New "Filesystem" tab + `MountsEditor` component |

## Out of scope

- The "agent brain" feature itself (`kind: "brain"` behavior) — only the enum seam is
  reserved.
- Per-sub-agent mount configuration — sub-agents inherit, no independent config.
- Migrating the existing `contained: false` external-skills path for **non-mount**
  agents — that branch is untouched; only agents that opt into mounts get the new
  composite path.

## Verification

User tests manually. Automated smoke test possible via `src/test-harness.ts` (builds a
real agent with the full pipeline): configure a mount, confirm the agent can
`read_file`/`write_file` under `/mnt/<name>`, and confirm a `ro` mount rejects writes.
