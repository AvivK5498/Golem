# Golem FAQ

## Why SSH tunnels instead of a public web UI with a password?

Exposing a self-hosted admin panel to the internet — even with auth — is one of the most reliable ways to get owned. Locking the UI to `127.0.0.1` removes that whole class of vulnerability. The trade-off is one extra `ssh -L` flag, which we think is worth it. OpenClaw and similar tools land on the same answer.

If you want public access, the recommended approach is **Tailscale Serve** — put the VPS on your tailnet and Tailscale handles the secure remote access without exposing anything to the public internet.

## Can I run it without the daemon, just for testing?

Yes. `git clone` + `npm install` + `npm start` runs both the platform and the dev UI without installing anything system-wide. The daemon is only needed when you want Golem to run unattended.

## Does it need ffmpeg?

No. Voice transcription sends the OGG/Opus blob straight to the Whisper API — no transcoding needed.

## What about Docker?

Not officially supported in v1. Per-agent filesystem mounts (Obsidian vaults at `/mnt/<name>`) get awkward in Docker because every new mount needs a compose-file edit and a container restart. The npm install path is the supported route.

## How do I back up my install?

Stop the daemon, tar the data directory, copy it somewhere safe. The data directory **is** the install — everything else is reproducible from `npm install`.

```bash
golem stop
tar czf golem-backup-$(date +%F).tgz -C ~/.local/share golem
```

To restore on a new machine: install Golem, untar over the data directory, start the daemon.

## How do I uninstall?

```bash
golem uninstall-daemon              # removes systemd unit / launchd plist, stops daemon
npm uninstall -g golem-agent        # removes the package
rm -rf ~/.local/share/golem         # removes your data (optional)
```

## Which models does it use?

You pick three OpenRouter model IDs during onboarding — one each for the **low**, **medium**, and **high** tiers. Agents reference a tier (e.g. "use the high tier for hard reasoning") or can override with a specific model ID. Cheap thinking on small queries, expensive thinking when it matters.

The model registry is global; tier definitions live in your data dir and can be edited any time via the UI.

## Why doesn't `golem update` work yet?

Because Golem isn't published to npm yet, there's nothing to update *to*. Run `npm install -g golem-agent@latest` manually for now. The subcommand will be wired up once the package is on the registry.

## What happens if I run `npm i -g golem-agent` on a box where it's already installed?

It's idempotent. The new version replaces the old. After installing, restart the daemon:

```bash
systemctl --user restart golem      # Linux
launchctl kickstart -k gui/$(id -u)/com.golem.agent   # macOS
```

Your data directory, agents, conversation history — all of it stays. Schema migrations run automatically on first start.

## Can I run multiple Golem instances on one machine?

Yes, with separate `GOLEM_DATA_DIR` env vars. Each instance gets its own data dir, port, and bot tokens. You'd need separate systemd units though — `golem install-daemon` doesn't currently support a `--label` flag for parallel installs (file a feature request if you need this).

## On a VPS, does the UI run all the time?

Yes — `golem start` spawns the Next.js standalone server as a child process. Both the platform (`:3847`) and the UI (`:3015`) listen on `127.0.0.1`, so neither is reachable without a tunnel/tailnet. RAM cost is about 100-200 MB for the UI process; if you want to reclaim it on a tight box, see `src/cli/ui-server.ts` for the spawn logic (file an issue if a `--no-ui` flag would help you).

## The first-run banner mentions an SSH tunnel command. Where does that come from?

When you SSH into a box, `$SSH_CONNECTION` is set to `<client-ip> <client-port> <server-ip> <server-port>`. The banner parses that to print a copy-paste-ready `ssh -L 3015:localhost:3015 user@server-ip` command. If you're running the daemon under systemd (no SSH context), the banner falls back to "open http://localhost:3015" — you'll see the tunnel-aware version in `journalctl` only if the daemon was started from an SSH session.

## How do I see what the agent is actually thinking?

The web UI has a per-agent **Traces** view showing every LLM call: prompt, response, tool invocations, token counts, latency. Backed by Phoenix (OpenTelemetry) — point any OTel-compatible viewer at the daemon to see the same data in your own tooling.

## Where do I report bugs / get help?

[github.com/AvivK5498/Golem/issues](https://github.com/AvivK5498/Golem/issues). Include the output of `golem doctor` and `golem version`.
