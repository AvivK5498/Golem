import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { _resetPathCacheForTests } from "../utils/paths.js";
import { detectSshSession, renderBanner } from "./first-run-banner.js";

let savedEnv: Record<string, string | undefined>;
const KEYS = ["SSH_CONNECTION", "USER", "LOGNAME", "GOLEM_DATA_DIR"];

beforeEach(() => {
  savedEnv = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env.GOLEM_DATA_DIR = "/tmp/golem-banner-test";
  _resetPathCacheForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetPathCacheForTests();
});

describe("detectSshSession", () => {
  test("returns null when SSH_CONNECTION is unset", () => {
    expect(detectSshSession({})).toBeNull();
  });

  test("parses standard IPv4 SSH_CONNECTION", () => {
    expect(
      detectSshSession({ SSH_CONNECTION: "10.0.0.5 41234 192.168.1.10 22", USER: "aviv" }),
    ).toEqual({ user: "aviv", host: "192.168.1.10" });
  });

  test("wraps IPv6 server addresses in brackets", () => {
    expect(
      detectSshSession({
        SSH_CONNECTION: "fe80::1 41234 2001:db8::1 22",
        USER: "aviv",
      }),
    ).toEqual({ user: "aviv", host: "[2001:db8::1]" });
  });

  test("falls back to LOGNAME when USER is unset", () => {
    expect(
      detectSshSession({ SSH_CONNECTION: "10.0.0.5 41234 1.2.3.4 22", LOGNAME: "root" }),
    ).toEqual({ user: "root", host: "1.2.3.4" });
  });

  test("returns null on malformed SSH_CONNECTION", () => {
    expect(detectSshSession({ SSH_CONNECTION: "incomplete", USER: "aviv" })).toBeNull();
  });

  test("returns null when no user can be determined", () => {
    expect(detectSshSession({ SSH_CONNECTION: "1 2 3 4" })).toBeNull();
  });
});

describe("renderBanner", () => {
  test("onboarding + no SSH points at localhost", () => {
    const out = renderBanner({ hasApiKey: false, ssh: null });
    expect(out).toContain("Not yet configured");
    expect(out).toContain("http://localhost:3015");
    expect(out).not.toContain("ssh -L");
  });

  test("onboarding + SSH renders a copy-paste tunnel command", () => {
    const out = renderBanner({
      hasApiKey: false,
      ssh: { user: "aviv", host: "203.0.113.7" },
    });
    expect(out).toContain("ssh -L 3015:localhost:3015 aviv@203.0.113.7");
    expect(out).toContain("http://localhost:3015");
  });

  test("configured + SSH still shows the tunnel command for re-access", () => {
    const out = renderBanner({
      hasApiKey: true,
      ssh: { user: "root", host: "[2001:db8::1]" },
    });
    expect(out).toContain("ssh -L 3015:localhost:3015 root@[2001:db8::1]");
    expect(out).not.toContain("Not yet configured");
  });

  test("configured + no SSH is a one-liner", () => {
    const out = renderBanner({ hasApiKey: true, ssh: null });
    expect(out).toContain("Running.");
    expect(out).toContain("http://localhost:3015");
    expect(out).not.toContain("ssh -L");
  });

  test("always shows the resolved data dir", () => {
    const out = renderBanner({ hasApiKey: true, ssh: null });
    expect(out).toContain("/tmp/golem-banner-test");
    expect(out).toContain("GOLEM_DATA_DIR env var");
  });
});
