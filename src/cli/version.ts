import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function readPackageVersion(): string {
  // Walk up from src/cli/ to find package.json. Works in both dev (src/cli/version.ts)
  // and installed (dist/cli/version.js inside node_modules/golem-agent/).
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf-8")) as { name?: string; version?: string };
      if (pkg.name && (pkg.name === "golem-agent" || pkg.name.endsWith("/golem-agent"))) {
        return pkg.version ?? "0.0.0";
      }
    }
    dir = path.dirname(dir);
  }
  return "unknown";
}

export async function run(_args: string[]): Promise<number> {
  console.log(readPackageVersion());
  return 0;
}
