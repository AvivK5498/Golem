/**
 * `golem update` — pull the latest published version.
 *
 * Stub: full implementation depends on the npm publishing pipeline (bd vx9).
 * Until the package is published as `golem-agent` on npm, there's nothing to
 * update to.
 */
export async function run(_args: string[]): Promise<number> {
  console.log("`golem update` is not yet implemented.");
  console.log("");
  console.log("Once Golem is published to npm, this will run:");
  console.log("  npm install -g golem-agent@latest");
  console.log("  systemctl --user restart golem      # (Linux)");
  console.log("  launchctl kickstart -k gui/$(id -u)/com.golem.agent   # (macOS)");
  console.log("");
  console.log("For now, run those commands manually after `git pull` in your dev checkout.");
  return 0;
}
