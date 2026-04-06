---
name: skill-creator
description: Use when user asks to create, build, or add a new skill or capability to the agent
requires:
  env: []
  bins: []
---
# Skill Creator

Help the owner create new skills for this agent. This skill is used by the admin sub-agent. Skills are modular capabilities defined in Markdown files that extend what the agent can do.

## Design Principles

1. **Concise context** -- Tokens are a shared resource. Keep skill instructions focused and minimal. Every line should earn its place.
2. **Appropriate degrees of freedom** -- Match specificity to task fragility. Fragile tasks (API calls with exact schemas) need precise instructions. Flexible tasks (writing, analysis) need loose guidance.
3. **Progressive disclosure** -- The system prompt only shows skill name + description. Full SKILL.md content is loaded on demand.

## Skill Format

A skill is a directory `skills/{name}/` containing a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: my-skill
description: One-line description of what this skill does (max 1024 chars)
requires:
  env: []       # Environment variables needed (e.g., [OPENAI_API_KEY])
  bins: []      # Binary executables needed (e.g., [curl, ffmpeg])
---
# Skill Title

Instructions for the LLM on how to use this skill...
```

### Naming Rules

- Lowercase letters, digits, and hyphens only
- No leading, trailing, or consecutive hyphens
- Maximum 64 characters
- Prefer verb-led names: `generate-images`, `send-email`, `track-expenses`

### What to Include in Instructions

- When and why to use this skill
- Step-by-step instructions for the LLM
- Available tools the skill leverages (e.g., `run_command`, `schedule_job`, `web_search`, `web_fetch`)
- Example interactions showing input and expected behavior
- Error handling guidance

### What NOT to Include

- Implementation code (skills are instructions, not code)
- Redundant information the LLM already knows
- Long reference docs (use a `references/` subdirectory if needed)

## Creation Process

When the owner asks to create a skill, follow these steps in order:

### Step 1: Understand

Ask the owner:
- What should this skill do?
- What external APIs or tools does it need?
- Are there any environment variables or binaries required?

Gather enough context to write a useful skill. Ask follow-up questions if the idea is vague.

### Step 2: Research (conditional)

If the skill needs external tools, APIs, or packages, research before planning:

- Search for relevant packages, public APIs, CLI tools, or best practices.
- Read API documentation, package READMEs, or pricing/free-tier details for promising options.
- Present findings to the owner: "I found these options: [list with pros/cons]. Which approach would you prefer?"
- Let the owner choose before moving to Plan.

Skip this step if the skill is straightforward and only uses built-in tools (e.g., reformatting text, filesystem operations).

### Step 3: Plan

Outline the skill:
- **Name** (following the naming rules above)
- **Description** (one-line summary, max 1024 chars)
- **Required env vars and binaries**
- **Key instructions** for the LLM

Present this plan to the owner and wait for feedback before drafting.

### Step 4: Draft

Write the complete SKILL.md content. Show the full draft to the owner in the chat. Do not write anything to disk yet.

### Step 5: Approve

Ask the owner: "Does this look good? Any changes?"

Revise based on feedback. Iterate until the owner is satisfied. Do NOT write to disk until the owner explicitly approves.

### Step 6: Write

Once approved, use workspace tools to:
1. Create the directory: `skills/{name}/`
2. Write the file: `skills/{name}/SKILL.md`

### Step 7: Confirm

Tell the owner the skill has been created and when it will be available:

- "Skill '{name}' created. It will be available on your next message."
- If the skill requires environment variables: "Note: this skill needs {VAR_NAME} set in your .env file. Add it and the skill will activate automatically."

## Example

Owner: "I want a skill that generates images using AI"

1. **Understand**: What kind of images? Any style preference? Budget for API costs?
2. **Research**: Search for image generation APIs. Find options:
   - Replicate API -- many models, pay-per-use, easy REST interface
   - Stability AI -- good quality, REST API, needs API key
   - OpenAI DALL-E -- via existing OpenAI key if available
   Present options to owner. Owner chooses Replicate.
3. **Plan**: name: `generate-images`, requires `REPLICATE_API_TOKEN`, uses `web_fetch` to call Replicate API, returns image URL to the user.
4. **Draft**: Show the full SKILL.md with frontmatter, instructions, and examples.
5. **Approve**: Owner reviews and says "looks good" (or requests changes).
6. **Write**: Create `skills/generate-images/SKILL.md` via workspace tools.
7. **Confirm**: "Skill 'generate-images' created. Add REPLICATE_API_TOKEN to your .env to activate it."

## Async / Background Skills

For skills that call external APIs with long-running jobs (video generation, CI builds, inference endpoints), use the `http-poll` handler via `schedule_job`. **Do not create new handlers or modify agent code.**

The SKILL.md should document the exact `schedule_job` call:

```
schedule_job({
  type: "http-poll",
  input: {
    label: "human-readable name",
    submitUrl: "https://api.example.com/run",
    submitHeaders: { "Authorization": "Bearer ${API_KEY}" },
    submitBody: { ... },
    jobIdPath: "id",
    statusUrlTemplate: "https://api.example.com/status/${jobId}",
    statusHeaders: { "Authorization": "Bearer ${API_KEY}" },
    statusPath: "status",
    completedStatuses: ["COMPLETED"],
    failedStatuses: ["FAILED", "ERROR"],
    resultPath: "output.url",
    errorPath: "error",
    pollIntervalMs: 10000,
    maxPollMs: 600000
  }
})
```

The handler automatically: submits, polls, pins a progress message, edits it with status updates, and delivers the result.

If the user provides an API key, store it with `store_secret` before creating the skill. Reference it in headers as `${ENV_VAR_NAME}` — the agent resolves it from `process.env` at call time.

### Extended Skill Format (Optional)

Skills can include subdirectories for additional resources:

```
my-skill/
├── SKILL.md          (required)
└── Optional subdirs:
    ├── scripts/       - Executable code (Python/Bash helpers)
    ├── references/    - Documentation, API specs, examples
    └── assets/        - Images, templates, static files
```

These subdirectories are detected automatically by the loader. When creating skills with helper scripts, put them in `scripts/` so they're properly scanned for security before installation.

**Security note**: Skills with scripts are automatically scanned for dangerous patterns (shell injection, eval, crypto-mining) before installation. Critical findings block installation.
