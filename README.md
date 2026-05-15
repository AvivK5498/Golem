<h1 align="center">Golem</h1>

<p align="center"><strong>Build, configure, and ship an AI agent in minutes.</strong></p>

<p align="center">🤖 Multi-agent &nbsp;•&nbsp; 💬 Telegram-native &nbsp;•&nbsp; 🧠 Working memory &nbsp;•&nbsp; 🔧 Skills & MCP &nbsp;•&nbsp; ⏰ Schedules & webhooks</p>

<p align="center">
  <a href="https://mastra.ai"><img src="https://img.shields.io/badge/built%20on-Mastra-7c3aed" alt="Built on Mastra"></a>
  <a href="https://openrouter.ai"><img src="https://img.shields.io/badge/LLMs-OpenRouter%20%2B%20Codex-0ea5e9" alt="LLMs"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-22c55e" alt="MIT License"></a>
</p>

![Welcome](screenshots/welcome.png)

## From zero to your first agent in 2 minutes

```bash
git clone https://github.com/AvivK5498/Golem.git
cd Golem && npm install
cp .env.example .env   # add your OpenRouter API key
npm start              # opens http://localhost:3015
```

The onboarding wizard takes it from there — providers, model tiers, your Telegram bot, your first agent's persona. Done.

## Why I built Golem

I'm Aviv. I love what LLMs can do, but I got tired of chatbots.

Chatbots are passive. You open a tab, you type, they answer, you close the tab. That's not an assistant — that's a search bar with manners. I wanted something that *acts*: an operator that lives on my phone, reacts to webhooks, runs on a schedule, remembers what I told it last week, and uses the tools I give it without me having to babysit a prompt.

I also didn't want to rent it. I wanted to own the keys, own the data, run it on a laptop under launchd, and spin up a new agent every time I had a new job to delegate.

So I built Golem. One process, N agents, each with its own Telegram bot, its own persona, its own toolset, its own memory. No SaaS. No tab.

## Philosophy

- **Agents act, they don't chat.** Every agent has tools, schedules, webhooks, and the agency to use them. Conversation is one input among many.
- **One bot per job.** Specialized agents beat one mega-prompt. Spin up a research agent, a code agent, a personal assistant — each with its own bot, its own boundaries.
- **Telegram-native, not Telegram-bolted-on.** Your agents live where you already are. Voice notes in, voice replies out. Group chats, media, buttons, identity.
- **You own the stack.** Your machine, your SQLite, your API keys, your bot tokens. Portable. Forkable. No cloud account required.
- **Configuration is data.** No YAML to edit by hand. The web UI writes SQLite; everything is hot-reloadable.

## What your agent can do out of the box

| Capability | What it actually means |
|---|---|
| **Multi-agent platform** | Run N agents in one process, each with its own Telegram bot, persona, model tier, and toolset. |
| **AI-generated personas** | Describe the job in a sentence; Golem writes the persona — identity, boundaries, domain expertise. |
| **Working memory** | A persistent scratchpad per agent. Tell it your coffee order on Monday, it remembers on Friday. |
| **Skills & MCP** | Drop a `SKILL.md` into `skills/` or wire up an MCP server. Your agent learns a new trick. |
| **Filesystem mounts** | Mount an Obsidian vault or any directory at `/mnt/<name>`. Read-only or read-write. Sub-agents inherit. |
| **Schedules & webhooks** | Cron-driven check-ins, webhook handlers (GitHub, Strava, CI) with LLM-based scenario routing. |
| **Proactive check-ins** | Agents initiate. Configurable cadence, probability gates, active-hours windows. |
| **Voice in, voice out** | Whisper transcription via Groq, optional ElevenLabs TTS replies — per-agent modes. |
| **Group chats, handled** | LLM classifier decides when to chime in. Identity tagging keeps multi-bot rooms sane. |
| **Sub-agent delegation** | A parent agent hands a job to a specialist child. Results compacted before they return. |
| **Code agent** | Delegate coding tasks to Claude Code with live progress. Effort-based model selection. |
| **Tool approval** | Destructive operations ping you on Telegram with Approve/Deny buttons. 15-minute expiry. |
| **Command security** | Allowlist-based binary execution for `run_command`. You decide what shell commands an agent may run. |
| **Conversation tempo** | Agents see elapsed time between messages and adapt — greetings, stale references, context freshness. |
| **Phoenix observability** | OpenTelemetry traces for every turn. Full prompt/response history in the UI for debugging. |

![Dashboard](screenshots/dashboard.png)

## How it works

1. **`npm start`** boots the platform daemon and the Next.js control plane.
2. **The onboarding wizard** asks for an OpenRouter key (or a Codex login), three model tiers (low/med/high), and a Telegram bot token from [@BotFather](https://t.me/BotFather).
3. **You describe your first agent** in a sentence. Golem generates a persona, picks tools, and seeds working memory.
4. **You message the bot on Telegram.** That's it. The agent is live. Configure tools, skills, schedules, and webhooks from the web UI as you go.

## Skills

Skills are markdown files that teach agents how to use tools for specific tasks. Each skill lives in `skills/<name>/SKILL.md`:

```yaml
---
name: my-skill
description: "What this skill does"
requires:
  env: [API_KEY]
  bins: [some-cli]
---

# My Skill

Instructions for the agent on how to use this skill...
```

![Skills](screenshots/skills.png)

---

## Under the hood

For the engineers. Golem is a **single Node.js process**, multi-tenant by convention. No microservices, no external DB, no Kubernetes. A laptop under `launchd` is the production target.

### Architecture

- **Backend** (port 3847) — HTTP API, Telegram transports, agent runners, job scheduler.
- **Web UI** (port 3015) — Next.js 16 control plane, proxied to backend.

All state lives in SQLite under the data directory:

| Database | Purpose |
|---|---|
| `agents.db` | Agent definitions (config, persona, memory template) |
| `settings.db` | Runtime settings (model tiers, behavior, integrations) |
| `platform-memory.db` | Conversation history and working memory |
| `crons.db` | Scheduled tasks |
| `jobs.db` | Async job queue (coding, HTTP polling, workflows) |
| `feed.db` | Activity audit log |

### Agent message flow

```
Telegram → Transport → Dedup → Chat classification
  → Media processing (vision / voice transcription)
  → AgentRunner → agent.generate() with memory + tools
  → Response → Telegram
```

### Processors pipeline

Input processors run before each LLM step, in order:

- **PromptCache** — marks the Anthropic prompt-cache boundary
- **ImageStripper** — strips base64 image data from history
- **AsyncJobGuard** — stops the agent loop after an async job dispatch
- **ToolCallFilter** — strips tool calls from recalled history
- **SubAgentResultCompactor** — compacts verbose sub-agent results
- **ToolResultSanitizer** — caps oversized tool results
- **MessageTimestamp** — prepends `[Apr 18 09:35]` markers for tempo awareness
- **OwnerStepBudget** — enforces a per-step tool-call budget (8 primary, 4 sub-agent)
- **TokenLimiter** — 170K-token-per-turn ceiling
- **ToolErrorGate** — disables tools after repeated failures

Output processors run after each turn, before memory persistence:

- **SubAgentResultCompactor**, **ToolResultSanitizer**, **ImageStripper**, **ReasoningStripper**, **GroupIdentity**.

### LLM tiers, not model IDs

Three global tiers (low / med / high) map to specific OpenRouter model IDs. Each agent stores a *tier*, not a model. Change the tier's model and every agent on it updates. Override per-agent when you need to.

### Behavior dropdowns

Each agent's response style is governed by five dropdowns:

| Setting | Options |
|---|---|
| Response Length | Brief / Balanced / Detailed |
| Agency | Execute first / Ask before acting / Consultative |
| Tone | Casual / Balanced / Professional |
| Format | Texting / Conversational / Structured |
| Language | English / Hebrew / Auto-detect |

## Requirements

- macOS or Linux (Windows not supported yet)
- Node.js 20+
- An [OpenRouter](https://openrouter.ai/keys) API key, or a ChatGPT Plus/Pro subscription for Codex models
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key for LLM access |
| `GROQ_API_KEY` | No | Voice transcription (Whisper, free tier) |
| `ELEVENLABS_API_KEY` | No | Voice replies (TTS) |
| `GOLEM_DATA_DIR` | No | Custom data directory (default: `./data`) |
| `GOLEM_SKILLS_DIR` | No | Custom skills directory (default: `./skills`) |

### Optional: code agent

To let your agents delegate coding tasks to [Claude Code](https://claude.ai/code):

```bash
npm install -g @anthropic-ai/claude-code
claude login   # one-time OAuth in browser
```

Then enable the `code_agent` tool on any agent. It can write code, refactor, run tests, and install dependencies by spawning Claude Code sessions.

## Development

### Test harness

A standalone CLI that exercises the full agent pipeline without Telegram. Real LLM calls, Phoenix traces, no transport mocks.

```bash
npm run test:agent "Hello, what can you do?"
npm run test:agent -- --verbose "Run ls /tmp"
npm run test:agent -- --image /path/to/image.jpg "What do you see?"
npm run test:agent -- --mount vault:/path/to/dir:rw "Read and write files under /mnt/vault"
```

### Unit tests

```bash
bun test
```

## Tech stack

- **Runtime**: Node.js 20+ / TypeScript (ES modules)
- **Agent framework**: [Mastra](https://mastra.ai) (`@mastra/core`)
- **LLM providers**: [OpenRouter](https://openrouter.ai) (300+ models) + [OpenAI Codex](https://openai.com/index/introducing-codex/) (ChatGPT subscription, fair-use quota)
- **Messaging**: Telegram ([grammY](https://grammy.dev))
- **Memory**: LibSQL (conversation history + working memory)
- **Storage**: SQLite (better-sqlite3)
- **UI**: Next.js 16 + shadcn/ui + Tailwind CSS v4
- **Observability**: Phoenix (OpenTelemetry)
- **Testing**: Bun test runner

---

## Ready to ship your AI agent?

```bash
git clone https://github.com/AvivK5498/Golem.git
cd Golem && npm install
cp .env.example .env
npm start
```

Open **http://localhost:3015**, walk the wizard, message your bot. Welcome to Golem.

## License

MIT
