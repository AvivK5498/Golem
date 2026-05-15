# Golem CLI reference

The `golem` command is a thin ops wrapper. All content management — agents, schedules, settings — lives in the web UI or Telegram. The CLI exists to run, stop, inspect, and diagnose the daemon.

```
golem [command] [args]
```

Running `golem` with no arguments is equivalent to `golem start`.

## Commands

### `golem start`

Start the platform in the foreground. Refuses to launch a second instance if a live PID file is present.

Used by systemd / launchd via `install-daemon`. You normally don't call it directly — `systemctl --user start golem` or the launchd plist runs it under the hood.

When run interactively (e.g. SSH'd in, foreground for debugging), it prints the first-run banner including a copy-paste SSH tunnel command derived from `$SSH_CONNECTION`.

### `golem stop`

Send `SIGTERM` to the running daemon, wait up to 10 seconds for graceful shutdown, then `SIGKILL` if it didn't comply.

Does the right thing whether the daemon was started by `golem start` or by systemd/launchd. For systemd you can also use `systemctl --user stop golem`.

### `golem status`

Report whether the daemon is running and where its data lives.

```
data dir: /home/you/.local/share/golem  (default)
status:   running (pid 12345, up 2h 17m)
```

Resolution source (`env` / `cwd` / `default`) shows which branch of the data-dir lookup won:
- `env` — `GOLEM_DATA_DIR` was set
- `cwd` — there's a `./data/` directory in your current working dir (dev workflow)
- `default` — OS-native default (`~/.local/share/golem` on Linux, `~/Library/Application Support/golem` on macOS)

Exit code `0` if running, `3` if not (LSB convention).

### `golem logs [-n N] [-f]`

Tail the daemon's logs. Detection order:

1. Linux with a systemd user unit named `golem` → `journalctl --user -u golem -f`
2. macOS with `com.golem.agent.plist` installed → `tail -F ~/Library/Logs/com.golem.agent.log`
3. Fallback → `tail -F` on the most recent `*.log` under the data dir's `logs/` folder

Flags:
- `-f`, `--follow` — follow (default)
- `--no-follow` — print recent lines and exit
- `-n N`, `--lines N` — show N most recent lines (default 100)

### `golem doctor`

Run health checks. Each check is OK / WARN / FAIL.

- **Node version** — must be ≥ 20
- **Data dir writable** — does the data dir exist and is it writable?
- **Disk space** — warn under 1 GiB free, fail under 100 MiB
- **OpenRouter key** — `OPENROUTER_API_KEY` set, and accepted by `/api/v1/key`
- **Telegram tokens** — for each agent in `agents.db`, validates the bot token via Telegram `getMe` (resolves `${VAR}` refs from the data-dir `.env`)
- **Daemon running** — PID file present, process alive
- **Logs dir** — exists and readable

Exit code `0` if everything is OK or WARN; `1` if any FAIL.

Notably absent: ffmpeg is **not** checked. Voice transcription sends OGG/Opus directly to Whisper — no transcoding needed.

### `golem version`

Print the installed package version.

### `golem update`

(Stub.) Will eventually run `npm install -g golem-agent@latest && systemctl --user restart golem`. For now, run those commands manually.

### `golem install-daemon [--force] [--dry-run]`

Write a user-level systemd unit (Linux) or launchd plist (macOS) and start the daemon.

- Linux: `~/.config/systemd/user/golem.service`, then `systemctl --user daemon-reload && enable --now golem.service`. Reminds you to `loginctl enable-linger $USER` if it's not on.
- macOS: `~/Library/LaunchAgents/com.golem.agent.plist`, then `launchctl bootstrap` + `kickstart`. Refuses to overwrite an existing repo-local plist (the dev install pattern) without `--force` and prints the exact migration steps.

Flags:
- `--dry-run` (`-n`) — print what would be written, don't touch anything
- `--force` (`-f`) — overwrite an existing unit/plist even if it differs

### `golem uninstall-daemon [--dry-run]`

Stop the daemon, remove the systemd unit or launchd plist, reload the supervisor. Leaves your data directory alone — to remove that, do it manually.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `GOLEM_DATA_DIR` | OS-native (`~/.local/share/golem` on Linux, `~/Library/Application Support/golem` on macOS) | Override where the daemon stores everything. `golem status` shows the resolved path. |
| `GOLEM_SKILLS_DIR` | `./skills` (relative to cwd) | Override where skills are loaded from. |

The CLI loads `.env` from **both** cwd and the data directory, in that order — so the wizard-written `.env` (in the data dir) is picked up by `golem doctor` when you run it from your shell, and your repo-root `.env` works for `npm start` in a dev clone.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure |
| 3 | `golem status` only — daemon not running (LSB convention) |
| 64 | Unknown subcommand (`EX_USAGE`) |
| 75 | (Internal) `golem start` requesting restart after wizard finishes |
