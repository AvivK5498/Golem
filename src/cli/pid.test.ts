import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { _resetPathCacheForTests } from "../utils/paths.js";
import {
  getRunningDaemon,
  isProcessAlive,
  pidFilePath,
  readPidFile,
  removePidFile,
  writePidFile,
} from "./pid.js";

let tmp: string;
let savedEnv: string | undefined;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "golem-pid-")));
  savedEnv = process.env.GOLEM_DATA_DIR;
  process.env.GOLEM_DATA_DIR = tmp;
  _resetPathCacheForTests();
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.GOLEM_DATA_DIR;
  else process.env.GOLEM_DATA_DIR = savedEnv;
  _resetPathCacheForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("pid file round-trip", () => {
  test("write then read returns the same record", () => {
    writePidFile({ pid: 12345, startedAt: 1700000000000 });
    const r = readPidFile();
    expect(r).toEqual({ pid: 12345, startedAt: 1700000000000 });
  });

  test("read returns null when file does not exist", () => {
    expect(readPidFile()).toBeNull();
  });

  test("read returns null on corrupted contents", () => {
    fs.writeFileSync(pidFilePath(), "not-a-pid\n");
    expect(readPidFile()).toBeNull();
  });

  test("remove is idempotent", () => {
    expect(() => removePidFile()).not.toThrow();
    writePidFile({ pid: 1, startedAt: 0 });
    removePidFile();
    expect(readPidFile()).toBeNull();
    expect(() => removePidFile()).not.toThrow();
  });

  test("pidFilePath lives under the data dir", () => {
    expect(pidFilePath()).toBe(path.join(tmp, "golem.pid"));
  });
});

describe("isProcessAlive", () => {
  test("returns true for our own pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("returns false for a clearly-dead pid", () => {
    // pid 1 is init/launchd; instead use a very large pid that can't exist.
    expect(isProcessAlive(2 ** 22)).toBe(false);
  });
});

describe("getRunningDaemon", () => {
  test("returns the record when the process is alive", () => {
    writePidFile({ pid: process.pid, startedAt: Date.now() });
    const r = getRunningDaemon();
    expect(r?.pid).toBe(process.pid);
  });

  test("removes a stale pid file and returns null", () => {
    writePidFile({ pid: 2 ** 22, startedAt: 0 });
    expect(getRunningDaemon()).toBeNull();
    expect(fs.existsSync(pidFilePath())).toBe(false);
  });

  test("returns null when no pid file exists", () => {
    expect(getRunningDaemon()).toBeNull();
  });
});
