/**
 * First-run / startup banner.
 *
 * On every start prints the resolved data directory. When the platform is not
 * yet onboarded (no OPENROUTER_API_KEY), prints the path to localhost:3015 and,
 * if the user is in an SSH session, the copy-paste-ready ssh tunnel command.
 *
 * This is the highest-leverage UX copy in the project — the moment between
 * "I ran the install" and "I can see the UI". Keep it terse, scannable, and
 * accurate; treat changes here like changes to a public API.
 */
import { describeDataDirResolution } from "../utils/paths.js";

interface SshSession {
  user: string;
  host: string;
}

const UI_PORT = 3015;

/**
 * Parse $SSH_CONNECTION = "<client_ip> <client_port> <server_ip> <server_port>"
 * into the address the user should target in `ssh user@host`. IPv6 addresses
 * are wrapped in brackets for shell-safety. Returns null when not in an SSH
 * session or the env var is malformed.
 */
export function detectSshSession(env: NodeJS.ProcessEnv = process.env): SshSession | null {
  const conn = env.SSH_CONNECTION?.trim();
  if (!conn) return null;
  const parts = conn.split(/\s+/);
  if (parts.length < 4) return null;
  const serverIp = parts[2];
  if (!serverIp) return null;
  const user = env.USER || env.LOGNAME;
  if (!user) return null;
  const host = serverIp.includes(":") ? `[${serverIp}]` : serverIp;
  return { user, host };
}

interface BannerOptions {
  hasApiKey: boolean;
  ssh: SshSession | null;
}

export function renderBanner(opts: BannerOptions): string {
  const dataDir = describeDataDirResolution();
  const sourceLabel = {
    env: "GOLEM_DATA_DIR env var",
    cwd: "./data/ in current directory",
    default: "OS default",
  }[dataDir.source];

  const lines: string[] = [];
  lines.push("");
  lines.push("  ╔══════════════════════════════════════════════════════════════╗");
  lines.push("  ║                          Golem                               ║");
  lines.push("  ╚══════════════════════════════════════════════════════════════╝");
  lines.push("");
  lines.push(`  Data:   ${dataDir.path}`);
  lines.push(`          (${sourceLabel})`);
  lines.push("");

  if (!opts.hasApiKey) {
    lines.push("  Not yet configured — let's get you set up.");
    lines.push("");
    if (opts.ssh) {
      lines.push("  You're SSH'd in. To configure Golem, open an SSH tunnel from");
      lines.push("  your laptop in a separate terminal:");
      lines.push("");
      lines.push(`      ssh -L ${UI_PORT}:localhost:${UI_PORT} ${opts.ssh.user}@${opts.ssh.host}`);
      lines.push("");
      lines.push(`  Then open  http://localhost:${UI_PORT}  in your laptop's browser.`);
    } else {
      lines.push(`  Open  http://localhost:${UI_PORT}  to configure your platform.`);
    }
    lines.push("");
  } else {
    if (opts.ssh) {
      lines.push("  Running. To access the UI from your laptop:");
      lines.push("");
      lines.push(`      ssh -L ${UI_PORT}:localhost:${UI_PORT} ${opts.ssh.user}@${opts.ssh.host}`);
      lines.push(`      open http://localhost:${UI_PORT}`);
    } else {
      lines.push(`  Running. UI at http://localhost:${UI_PORT}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function printFirstRunBanner(opts: BannerOptions): void {
  process.stdout.write(renderBanner(opts) + "\n");
}
