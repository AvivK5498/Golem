/**
 * Pure renderers for systemd unit and launchd plist contents.
 *
 * Split out so the rendering is unit-testable without invoking systemctl /
 * launchctl. The write + activate logic lives in linux.ts / macos.ts.
 */

export interface UnitContext {
  /** Absolute path to the `golem` executable that the unit should launch. */
  golemBinary: string;
  /** Absolute path to the user's home directory (paths inside the unit must be absolute). */
  homeDir: string;
  /** Absolute path to the data directory the daemon should treat as its working dir. */
  dataDir: string;
}

/**
 * systemd user unit. Lives at ~/.config/systemd/user/golem.service.
 *
 * Type=simple because we want systemd to track our PID directly (the start
 * subcommand stays in the foreground). Restart=on-failure (not 'always') so
 * an intentional `golem stop` doesn't loop forever. WantedBy=default.target
 * means it auto-starts at user login (and after lingering is enabled, at boot).
 */
export function renderSystemdUnit(ctx: UnitContext): string {
  return [
    "[Unit]",
    "Description=Golem multi-agent platform",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${ctx.golemBinary} start`,
    `WorkingDirectory=${ctx.dataDir}`,
    `Environment=GOLEM_DATA_DIR=${ctx.dataDir}`,
    "Environment=NODE_ENV=production",
    "Restart=on-failure",
    "RestartSec=5",
    "StandardOutput=journal",
    "StandardError=journal",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/**
 * launchd plist. Lives at ~/Library/LaunchAgents/com.golem.agent.plist.
 *
 * KeepAlive=true matches the existing repo's convention so the daemon is
 * always running while the user is logged in. WorkingDirectory must be an
 * absolute path — launchd doesn't expand ~.
 */
export function renderLaunchdPlist(ctx: UnitContext): string {
  const logDir = `${ctx.homeDir}/Library/Logs`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.golem.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>${ctx.golemBinary}</string>
        <string>start</string>
    </array>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${ctx.dataDir}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>GOLEM_DATA_DIR</key>
        <string>${ctx.dataDir}</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${logDir}/com.golem.agent.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/com.golem.agent.error.log</string>
</dict>
</plist>
`;
}

/**
 * Inspect an existing plist's <ProgramArguments> to detect whether it points
 * at the new installed binary or at the old repo-local `bin/golem.js`. The
 * regex is intentionally loose — we just want to recognize "uses an absolute
 * path under a checkout that isn't the global install."
 */
export function inferPlistOrigin(
  plistContent: string,
  expectedBinary: string,
): "matches" | "repo-local" | "unknown" {
  const args = plistContent.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
  if (!args) return "unknown";
  if (args[1].includes(expectedBinary)) return "matches";
  if (/<string>[^<]*\/bin\/golem\.js<\/string>/.test(args[1])) return "repo-local";
  return "unknown";
}
