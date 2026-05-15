/**
 * Golem CLI entry point — dispatches subcommands.
 *
 * Subcommand surface (v1):
 *   start             Start the platform in the foreground (default)
 *   stop              Stop the running daemon
 *   status            Report whether the daemon is running
 *   logs [-n N] [-f]  Tail daemon logs (journald / launchd log / data/logs/*)
 *   version           Print the package version
 *   update            (Stub) Pull the latest published version — see bd vx9
 *   doctor            Health checks — extended by bd 49x
 *   install-daemon    Install systemd unit / launchd plist — bd 3mm/8if (TBD)
 *   uninstall-daemon  Reverse install-daemon — bd 3mm/8if (TBD)
 *
 * Running with no subcommand is equivalent to `start`.
 */
import "dotenv/config";

type Subcommand = (args: string[]) => Promise<number>;

const COMMANDS: Record<string, () => Promise<{ run: Subcommand }>> = {
  start: () => import("./cli/start.js"),
  stop: () => import("./cli/stop.js"),
  status: () => import("./cli/status.js"),
  logs: () => import("./cli/logs.js"),
  version: () => import("./cli/version.js"),
  update: () => import("./cli/update.js"),
  doctor: () => import("./cli/doctor.js"),
};

const ALIASES: Record<string, string> = {
  "-v": "version",
  "--version": "version",
};

const HELP = `golem — multi-agent platform

Usage:
  golem [command] [args]

Commands:
  start             Start the platform (default if no command given)
  stop              Stop the running daemon
  status            Report whether the daemon is running
  logs [-n N] [-f]  Tail the daemon logs
  version           Print the version
  update            Pull the latest published version (not yet wired)
  doctor            Run health checks
  help, -h, --help  Show this message

Environment:
  GOLEM_DATA_DIR    Override the data directory (default: OS-native).
                    See \`golem status\` for the resolved path.
`;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let cmd = argv[0] ?? "start";
  let args = argv.slice(1);

  if (cmd in ALIASES) cmd = ALIASES[cmd];
  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    console.log(HELP);
    return 0;
  }
  // If the first token is a flag and isn't a known alias, treat everything as
  // arguments to `start`.
  if (cmd.startsWith("-") && !(cmd in COMMANDS)) {
    args = argv;
    cmd = "start";
  }

  const loader = COMMANDS[cmd];
  if (!loader) {
    console.error(`Unknown command: ${cmd}\n`);
    console.error(HELP);
    return 64; // EX_USAGE
  }

  const mod = await loader();
  return mod.run(args);
}

main().then(
  (code) => {
    process.exit(code);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
