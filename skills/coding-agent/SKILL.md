---
name: coding-agent
description: "Delegate coding tasks to Claude Code. Use when: building features, creating handlers, refactoring, reviewing PRs, iterative coding. NOT for: simple file edits (use filesystem), or quick config changes (use config_update)."
requires:
  env: []
  bins: [claude]
---
# Coding Agent

Delegate coding work to Claude Code via the `code_agent` tool. You are the **orchestrator** — describe the task, let the coding agent execute.

## When to Use

- Building new features, handlers, or scripts
- Refactoring or restructuring code across multiple files
- Creating new skills with scripts/
- Reviewing PRs or analyzing codebases
- Any task that requires reading multiple files, writing code, and running tests
- Installing dependencies (`npm install`, `bun add`)
- Running tests (`bun test`)

## When NOT to Use

- Simple file reads/edits -> use workspace tools
- Config changes -> use `config_update`
- Quick shell commands (git, curl) -> use `run_command`

## How to Use

### Basic Task

```
code_agent(
  task: "Build a health-check handler in src/scheduler/handlers/health-check.ts that pings an endpoint every 30 seconds and alerts the user if it returns non-200.",
  effort: "low"
)
```

### Effort Levels

| Effort | Model | Best for |
|--------|-------|----------|
| **low** (default) | Claude Sonnet | Single-file edits, small fixes, tests, config changes |
| **high** | Claude Opus | Multi-file features, complex refactors, deep debugging |

### Good Task Descriptions

Be specific. Include:
1. **What** to build (feature, handler, script)
2. **Where** to put it (file path)
3. **Pattern** to follow (reference existing code)
4. **How to test** (run tests, verify output)

**Good:**
> "Create a TypeScript job handler in src/scheduler/handlers/health-check.ts that polls https://example.com/health every 30 seconds. If non-200, return the error as the job result. Follow the JobHandler pattern from existing handlers. Include error handling."

**Bad:**
> "Build me a health checker"

## Platform-Specific Patterns

### Creating a New Handler (auto-loaded)

Handlers in `src/scheduler/handlers/` are hot-reloaded. The coding agent should:
1. Read an existing handler as a reference
2. Create a new handler file implementing the `JobHandler` interface
3. Export it as a named export
4. The job-worker picks it up automatically — no restart needed

### Creating a New Skill

Skills in `skills/` are also hot-loaded. The coding agent should:
1. Read `skills/skill-creator/SKILL.md` for the format
2. Create `skills/<name>/SKILL.md` with YAML frontmatter
3. Optionally add `scripts/`, `references/`, `assets/` subdirectories
4. The skill loader picks it up within 30 seconds

## Rules

1. **You are the orchestrator** — do NOT hand-code patches yourself. Delegate to code_agent.
2. **If the agent fails** — explain what went wrong. Do not silently take over and write the code yourself.
3. **Be patient** — coding tasks take 10-120 seconds. Wait for the result.
4. **Report back** — after code_agent finishes, summarize what was built and whether it needs a restart.
5. **Working directory matters** — always set `cwd` to the project root so the agent has full context.
