<h1 align="center">Golem</h1>

<p align="center"><strong>Build, configure, and ship an AI agent in minutes.</strong></p>

<p align="center">🤖 Multi-agent &nbsp;•&nbsp; 💬 Telegram-native &nbsp;•&nbsp; 🧠 Working memory &nbsp;•&nbsp; 🔧 Skills & MCP &nbsp;•&nbsp; ⏰ Schedules & webhooks</p>

<p align="center">
  <a href="https://mastra.ai"><img src="https://img.shields.io/badge/built%20on-Mastra-7c3aed" alt="Built on Mastra"></a>
  <a href="https://openrouter.ai"><img src="https://img.shields.io/badge/LLMs-OpenRouter%20%2B%20Codex-0ea5e9" alt="LLMs"></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-22c55e" alt="MIT License"></a>
</p>

![Welcome](screenshots/welcome.png)

## Install on a VPS in two commands

```bash
npm install -g golem-agent
golem install-daemon
```

That's it. The daemon is now running under systemd (Linux) or launchd (macOS), starts at login, and survives reboots. To configure your first agent:

1. SSH to your VPS with port-forwarding:
   ```bash
   ssh -L 3015:localhost:3015 you@your-vps
   ```
2. Open **http://localhost:3015** in your laptop's browser.
3. Walk the five-step onboarding wizard.

The UI binds to `127.0.0.1` only — never to a public interface. SSH provides the auth and the tunnel; there's no separate password to manage and no TLS to provision. Tailscale Serve and similar tools work the same way if you'd rather not tunnel every time.

> First time on a Linux VPS? After `install-daemon` runs, you'll see a reminder to enable lingering: `sudo loginctl enable-linger $USER`. Without it, systemd kills your user services when you log out.

## What your agent can do out of the box

![Dashboard](screenshots/dashboard.png)

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
| **Phoenix observability** | OpenTelemetry traces for every turn. Full prompt/response history in the UI for debugging. |

## Managing your install

Everyday operation is the `golem` CLI:

```bash
golem status        # is the daemon running? where's the data dir?
golem logs -f       # tail the daemon logs (journald / launchd / data-dir fallback)
golem doctor        # validate Node, disk, OpenRouter key, every bot token via getMe
golem stop          # graceful SIGTERM with a 10s grace window
golem start         # foreground start (the daemon uses this under systemd/launchd)
golem update        # pull the latest published version (placeholder — manual `npm i -g` for now)
```

**Configuration lives at:**
- `~/.local/share/golem/` on Linux (or `$XDG_DATA_HOME/golem`)
- `~/Library/Application Support/golem/` on macOS
- Override with `GOLEM_DATA_DIR`

`golem status` prints the resolved path, and the data directory is chmod'd to `700` so secrets aren't world-readable.

**Logs live at:**
- Linux: `journalctl --user -u golem` (or `golem logs`)
- macOS: `~/Library/Logs/com.golem.agent.log` (or `golem logs`)

## Philosophy

- **Agents act, they don't chat.** Every agent has tools, schedules, webhooks, and the agency to use them. Conversation is one input among many.
- **One bot per job.** Specialized agents beat one mega-prompt. Spin up a research agent, a code agent, a personal assistant — each with its own bot, its own boundaries.
- **Telegram-native, not Telegram-bolted-on.** Your agents live where you already are. Voice notes in, voice replies out. Group chats, media, buttons, identity.
- **You own the stack.** Your machine, your SQLite, your API keys, your bot tokens. Portable. Forkable. No cloud account required.
- **Configuration is data.** No YAML to edit by hand. The web UI writes SQLite; everything is hot-reloadable.

## How it works

```
You ──Telegram──▶ Bot ──▶ Agent (Mastra)
                          │
                          ├─▶ Tools (read/write workspace, web search, code agent, ...)
                          ├─▶ Skills (declarative SKILL.md capabilities)
                          ├─▶ Sub-agents (delegate specialised work)
                          ├─▶ MCP servers (any tool you can speak MCP to)
                          ├─▶ Working memory (your coffee order)
                          └─▶ Recall (semantic + recency)
```

The web UI doesn't reach Mastra directly. It reads/writes SQLite tables (`agents.db`, `settings.db`, `crons.db`, `feed.db`) and the platform reacts. That's why everything is hot-reloadable: change a persona, the next message uses the new one.

![Skills](screenshots/skills.png)

## Skills

A skill is a `SKILL.md` file with YAML frontmatter and human-readable instructions. The agent decides when to invoke one based on `description`. Two bundled skills out of the box: web-search and time-zone-aware scheduling. Add your own under `~/.local/share/golem/skills/` or set `GOLEM_SKILLS_DIR`.

## Requirements

- **OS:** Linux (x86_64 or arm64) or macOS. Windows isn't supported yet.
- **Node:** 20 or newer.
- **An OpenRouter API key** ([get one](https://openrouter.ai/keys)).
- **A Telegram bot token** ([@BotFather](https://t.me/BotFather)).
- **Optional:** Groq API key (free Whisper tier), ElevenLabs (TTS), a Claude Code login (delegated coding).

Environment overrides:

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | LLM access (set by the wizard or in your `.env`) |
| `GOLEM_DATA_DIR` | Override the data directory |
| `GOLEM_SKILLS_DIR` | Override the skills directory |
| `GROQ_API_KEY` | Voice transcription |
| `ELEVENLABS_API_KEY` | Voice replies |

## Development

```bash
git clone https://github.com/AvivK5498/Golem.git
cd Golem && npm install
cp .env.example .env
npm start                # runs platform + Next.js dev UI together on :3015
```

`npm start` uses `concurrently` to bring up both processes. `bun test` runs the unit suite. `npm run test:agent "your prompt"` exercises an agent end-to-end against real LLMs without Telegram.

```bash
npm run test:agent "Hello, what can you do?"
npm run test:agent -- --verbose "Run ls /tmp"
npm run test:agent -- --image /path/to/image.jpg "What do you see?"
npm run test:agent -- --mount vault:/path/to/dir:rw "Read and write files under /mnt/vault"
```

To publish a release: `npm run build && npm publish` (prepublishOnly runs typecheck + tests + build automatically).

## FAQ

**Why SSH tunnels instead of a public web UI with a password?**
Exposing a self-hosted admin panel to the internet — even with auth — is one of the most reliable ways to get owned. Locking the UI to `127.0.0.1` removes that whole class of vulnerability. The trade-off is one extra `ssh -L` flag, which we think is worth it. OpenClaw and similar tools land on the same answer.

**Can I run it without the daemon, just for testing?**
Yes — `git clone` + `npm start` runs both the platform and the dev UI without installing anything system-wide. The daemon is only needed when you want Golem to run unattended.

**Does it need ffmpeg?**
No. Voice transcription sends the OGG/Opus blob straight to the Whisper API — no transcoding needed.

**What about Docker?**
Not officially supported in v1. Per-agent filesystem mounts (Obsidian vaults at `/mnt/<name>`) get awkward in Docker because every new mount needs a compose-file edit and a container restart.

**How do I back up my install?**
Stop the daemon, tar the data directory, copy it somewhere safe. The data directory is the install — everything else is reproducible from `npm install`.

```bash
golem stop
tar czf golem-backup-$(date +%F).tgz -C ~/.local/share golem
```

**How do I uninstall?**
`golem uninstall-daemon` removes the systemd unit or launchd plist and stops the daemon. `npm uninstall -g golem-agent` removes the package itself. Your data directory stays put; remove it manually if you want a clean slate.

**Which models does it use?**
You pick three OpenRouter model IDs during onboarding — one each for the low, medium, and high tiers. Agents reference a tier (or override with a specific model). Cheap thinking on small queries, expensive thinking when it matters.

## Tech stack

Node.js 20+ · TypeScript · [Mastra](https://mastra.ai) · [OpenRouter](https://openrouter.ai) · Telegram ([grammY](https://grammy.dev)) · LibSQL + SQLite · Next.js 16 + shadcn/ui · Phoenix (OpenTelemetry) · Bun test

## License

MIT
