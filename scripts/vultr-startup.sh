#!/bin/bash
# Golem — Vultr first-boot startup script.
#
# Optional: paste this into your Vultr account's Startup Scripts page
# (Account → Startup Scripts → Add), then select it when provisioning a new
# instance. Vultr will run it once on first boot, leaving Golem installed and
# the daemon running before you've even SSH'd in.
#
# Works the same on any cloud that supports cloud-init user-data — just
# paste it into the "user data" field at provision time.
#
# What it does on a fresh Ubuntu 22.04/24.04 box, as root:
#   1. Install Node 24 (via nodesource)
#   2. Install golem-agent globally from npm
#   3. Run `golem install-daemon` — writes systemd unit, starts the daemon
#   4. Enable lingering so the daemon survives logout (default on a VPS)
#   5. Write a banner to /etc/motd telling the SSH'ing user what to do next
#
# Idempotent — re-running on an already-installed box is safe.

set -euo pipefail

log() { printf '[golem-bootstrap] %s\n' "$*"; }

# --- 1. Node 24 ---
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v24.* ]]; then
  log "installing Node 24..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
else
  log "Node 24 already present: $(node -v)"
fi

# --- 2. golem-agent ---
log "installing golem-agent from npm..."
npm install -g golem-agent@latest

# --- 3. install-daemon ---
log "installing systemd unit..."
golem install-daemon

# --- 4. linger ---
log "enabling lingering for root..."
loginctl enable-linger root || true

# --- 5. motd banner ---
IP=$(hostname -I | awk '{print $1}')
cat > /etc/motd <<EOF

  ╔══════════════════════════════════════════════════════════════╗
  ║                  Golem is installed and running              ║
  ╚══════════════════════════════════════════════════════════════╝

  To open the web UI, run this from your laptop:

      ssh -L 3015:localhost:3015 root@$IP

  Then open http://localhost:3015 in your browser and walk the wizard.

  Manage the daemon:
      golem status      — check it's running
      golem logs -f     — tail the logs
      golem doctor      — run health checks
      systemctl --user status golem

EOF

log "done. Next: ssh -L 3015:localhost:3015 root@$IP"
