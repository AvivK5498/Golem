import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  _resetPathCacheForTests,
  dataPath,
  describeDataDirResolution,
  getDataDir,
  getSkillsDir,
} from "./paths.js";

// Each test gets a fresh tmpdir and a clean env snapshot. paths.ts memoizes
// getDataDir() per-process, so we also reset its cache.
const ENV_KEYS = ["GOLEM_DATA_DIR", "XDG_DATA_HOME", "HOME", "APPDATA"];

let savedEnv: Record<string, string | undefined>;
let tmpRoot: string;
let originalCwd: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  // realpath: on macOS, mkdtemp returns /var/... but path.resolve canonicalizes
  // to /private/var/..., which breaks toBe(...) comparisons.
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "golem-paths-")));
  originalCwd = process.cwd();
  process.chdir(tmpRoot);
  for (const k of ENV_KEYS) delete process.env[k];
  _resetPathCacheForTests();
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetPathCacheForTests();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("getDataDir resolution", () => {
  test("GOLEM_DATA_DIR overrides everything", () => {
    const explicit = path.join(tmpRoot, "explicit");
    process.env.GOLEM_DATA_DIR = explicit;
    // even if ./data/ exists in cwd, env var wins
    fs.mkdirSync(path.join(tmpRoot, "data"));

    expect(getDataDir()).toBe(explicit);
    expect(describeDataDirResolution().source).toBe("env");
    expect(fs.existsSync(explicit)).toBe(true);
  });

  test("falls back to ./data/ in cwd when it exists (dev workflow preserved)", () => {
    const cwdData = path.join(tmpRoot, "data");
    fs.mkdirSync(cwdData);

    expect(getDataDir()).toBe(cwdData);
    expect(describeDataDirResolution().source).toBe("cwd");
  });

  test("falls back to OS-default when neither env nor ./data/ is present", () => {
    process.env.HOME = tmpRoot;
    delete process.env.XDG_DATA_HOME;

    const dir = getDataDir();
    expect(describeDataDirResolution().source).toBe("default");
    if (process.platform === "darwin") {
      expect(dir).toBe(path.join(tmpRoot, "Library", "Application Support", "golem"));
    } else if (process.platform === "win32") {
      // win32 uses APPDATA; without it, falls back under HOME
      expect(dir.endsWith(path.join("golem"))).toBe(true);
    } else {
      expect(dir).toBe(path.join(tmpRoot, ".local", "share", "golem"));
    }
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("Linux honors XDG_DATA_HOME when set", () => {
    if (process.platform === "darwin" || process.platform === "win32") return;
    process.env.HOME = tmpRoot;
    const xdg = path.join(tmpRoot, "custom-xdg");
    process.env.XDG_DATA_HOME = xdg;

    expect(getDataDir()).toBe(path.join(xdg, "golem"));
  });

  test("creates the data directory if missing", () => {
    const target = path.join(tmpRoot, "new", "nested", "dir");
    process.env.GOLEM_DATA_DIR = target;

    getDataDir();

    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  test("chmod 0700 on the data dir (best effort)", () => {
    if (process.platform === "win32") return; // chmod is meaningless on Windows
    const target = path.join(tmpRoot, "secured");
    process.env.GOLEM_DATA_DIR = target;

    getDataDir();

    const mode = fs.statSync(target).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  test("memoizes — repeated calls return the same path", () => {
    process.env.GOLEM_DATA_DIR = path.join(tmpRoot, "first");
    const a = getDataDir();
    process.env.GOLEM_DATA_DIR = path.join(tmpRoot, "second"); // changing env after first call has no effect
    const b = getDataDir();

    expect(a).toBe(b);
  });

  test("ignores a ./data/ file that isn't a directory", () => {
    fs.writeFileSync(path.join(tmpRoot, "data"), "not a dir");
    process.env.HOME = tmpRoot;

    expect(describeDataDirResolution().source).toBe("default");
  });
});

describe("dataPath", () => {
  test("joins relative to data dir", () => {
    const root = path.join(tmpRoot, "d");
    process.env.GOLEM_DATA_DIR = root;

    expect(dataPath("agents.db")).toBe(path.join(root, "agents.db"));
    expect(dataPath("logs/agent.log")).toBe(path.join(root, "logs", "agent.log"));
  });
});

describe("getSkillsDir", () => {
  test("defaults to cwd/skills, honors GOLEM_SKILLS_DIR override", () => {
    expect(getSkillsDir()).toBe(path.resolve("skills"));

    _resetPathCacheForTests();
    process.env.GOLEM_SKILLS_DIR = path.join(tmpRoot, "my-skills");
    expect(getSkillsDir()).toBe(path.join(tmpRoot, "my-skills"));
  });
});
