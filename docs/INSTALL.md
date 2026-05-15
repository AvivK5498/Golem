# Installing Golem

Three paths. Pick the one that fits your situation.

| | When to use | Time |
|---|---|---|
| [Deploy on Vultr](#deploy-on-vultr-one-click) | You want a VPS and don't have one yet | 3 min |
| [Manual VPS install](#manual-vps-install) | You have a server already (any provider) | 5 min |
| [Local development](#local-development) | You want to hack on Golem itself | 5 min |

---

## Deploy on Vultr (one-click)

The [Deploy on Vultr badge in the README](../README.md) links to a pre-filled Vultr deploy page. The first-boot startup script (registered in the Vultr account that owns the badge) installs Node, runs `npm install -g golem-agent`, and runs `golem install-daemon` automatically. By the time you can SSH in, the daemon is already running.

After the instance boots (~2 minutes):

```bash
# 1. SSH to confirm the bootstrap finished
ssh root@<vps-ip>
# (the MOTD will tell you Golem is running and what to do next)

# 2. From your laptop in a separate terminal, open the tunnel
ssh -L 3015:localhost:3015 root@<vps-ip>

# 3. Open http://localhost:3015 in your browser and walk the wizard
```

The startup script source lives in [`scripts/vultr-startup.sh`](../scripts/vultr-startup.sh) — feel free to inspect it or fork it.

---

## Manual VPS install

Works on any Linux VPS provider (Hetzner, DigitalOcean, AWS, Hetzner, etc.) running Ubuntu 22.04+, Debian 12+, or Fedora 40+.

### 1. Provision a box

Specs: **1GB RAM minimum** (2GB comfortable), 20GB disk, Ubuntu 24.04 LTS. Any x86_64 or arm64 will do.

### 2. SSH in and install Node 20+

```bash
# Ubuntu/Debian — install Node 24 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs

# Verify
node -v   # should print v24.x.x
npm -v
```

### 3. Install Golem

```bash
npm install -g golem-agent
golem install-daemon
```

`install-daemon` writes a user-level systemd unit at `~/.config/systemd/user/golem.service` and starts it. The daemon serves the platform API on `127.0.0.1:3847` and the web UI on `127.0.0.1:3015` — both loopback only, never exposed.

### 4. Enable lingering (so the daemon survives logout)

```bash
loginctl enable-linger $USER
```

Without this, systemd kills your user services when you SSH out. `install-daemon` reminds you about this if it's missing — but the one-liner above gets it done.

### 5. Configure via SSH tunnel

From your **laptop**, in a separate terminal:

```bash
ssh -L 3015:localhost:3015 you@your-vps
# (port 3015 already taken on your laptop? use any free port:
#  ssh -L 3030:localhost:3015 you@your-vps  → open http://localhost:3030)
```

Then open <http://localhost:3015> in your browser. The 5-step onboarding wizard collects:

1. **OpenRouter API key** ([get one](https://openrouter.ai/keys))
2. **Model tiers** — pick three OpenRouter model IDs for low/medium/high tiers
3. **Telegram bot token** — get one from [@BotFather](https://t.me/BotFather); the wizard validates it via `getMe` before advancing
4. **Owner Telegram ID** — leave blank, it'll be auto-detected when you DM the bot
5. **First agent persona**

After the wizard, the daemon restarts and you can message your bot.

### 6. Verify

```bash
golem status     # should show pid + uptime
golem doctor     # should be all green
```

---

## Local development

```bash
git clone https://github.com/AvivK5498/Golem.git
cd Golem && npm install
cp .env.example .env             # add your OPENROUTER_API_KEY
npm start                        # runs platform + Next.js dev UI on :3015
```

The dev `npm start` uses `concurrently` to run both the platform daemon and the Next.js dev server. Use this when you want hot reload on the UI side.

```bash
bun test                         # unit tests
npm run typecheck                # tsc
npm run test:agent "your prompt" # end-to-end agent test (real LLM, no Telegram)
```

To build the publishable bundle:

```bash
npm run build                    # tsc + Next.js standalone build
npm pack                         # creates golem-agent-x.y.z.tgz (no publish)
npm publish                      # actually publish (prepublishOnly runs typecheck + tests + build)
```

---

## Updating

```bash
npm install -g golem-agent@latest
systemctl --user restart golem      # Linux
# or
launchctl kickstart -k gui/$(id -u)/com.golem.agent   # macOS
```

`golem update` will eventually do both steps automatically — currently a stub.

## Uninstalling

```bash
golem uninstall-daemon              # stops the daemon, removes the systemd unit
npm uninstall -g golem-agent        # removes the package
# Your data directory stays put. Remove manually if you want a clean slate:
rm -rf ~/.local/share/golem         # Linux
rm -rf "~/Library/Application Support/golem"   # macOS
```

## Backing up

The data directory **is** the install. Tar it.

```bash
golem stop
tar czf golem-backup-$(date +%F).tgz -C ~/.local/share golem
golem start          # or: systemctl --user start golem
```

Move that tarball to another machine, install Golem there, untar over the data directory, and you've moved your entire install — agents, conversation history, working memory, scheduled tasks, all of it.

## Requirements

- **OS:** Linux x86_64 or arm64 (Ubuntu 22.04+, Debian 12+, Fedora 40+), or macOS. Windows isn't supported.
- **Node:** 20 or newer.
- **An OpenRouter API key** ([get one](https://openrouter.ai/keys)).
- **A Telegram bot token** ([@BotFather](https://t.me/BotFather)).

Optional: Groq API key (free Whisper tier), ElevenLabs (TTS), a Claude Code login (delegated coding).

## Environment variables

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | LLM access (set by the wizard or in `.env`) |
| `GOLEM_DATA_DIR` | Override the data directory |
| `GOLEM_SKILLS_DIR` | Override the skills directory |
| `GROQ_API_KEY` | Voice transcription |
| `ELEVENLABS_API_KEY` | Voice replies |

The wizard writes secrets to `<data-dir>/.env`. `golem start` and `golem doctor` both load that file at startup.
