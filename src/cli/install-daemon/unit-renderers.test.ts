import { describe, expect, test } from "bun:test";

import { inferPlistOrigin, renderLaunchdPlist, renderSystemdUnit } from "./unit-renderers.js";

const CTX = {
  golemBinary: "/Users/aviv/.bun/install/global/node_modules/golem-agent/bin/golem.js",
  homeDir: "/Users/aviv",
  dataDir: "/Users/aviv/.local/share/golem",
};

describe("renderSystemdUnit", () => {
  test("references the supplied binary and data dir", () => {
    const out = renderSystemdUnit(CTX);
    expect(out).toContain(`ExecStart=${CTX.golemBinary} start`);
    expect(out).toContain(`WorkingDirectory=${CTX.dataDir}`);
    expect(out).toContain(`Environment=GOLEM_DATA_DIR=${CTX.dataDir}`);
  });
  test("uses Restart=on-failure (not always) so `golem stop` works", () => {
    expect(renderSystemdUnit(CTX)).toContain("Restart=on-failure");
  });
  test("installs as a default.target dep so it starts at user login", () => {
    expect(renderSystemdUnit(CTX)).toContain("WantedBy=default.target");
  });
});

describe("renderLaunchdPlist", () => {
  test("uses absolute paths everywhere — launchd doesn't expand ~", () => {
    const out = renderLaunchdPlist(CTX);
    expect(out).toContain(`<string>${CTX.golemBinary}</string>`);
    expect(out).toContain(`<string>${CTX.dataDir}</string>`);
    expect(out).not.toContain("~/Library");
  });
  test("includes KeepAlive and RunAtLoad", () => {
    const out = renderLaunchdPlist(CTX);
    expect(out).toContain("<key>KeepAlive</key>\n    <true/>");
    expect(out).toContain("<key>RunAtLoad</key>\n    <true/>");
  });
  test("logs go to ~/Library/Logs", () => {
    const out = renderLaunchdPlist(CTX);
    expect(out).toContain(`<string>${CTX.homeDir}/Library/Logs/com.golem.agent.log</string>`);
  });
});

describe("inferPlistOrigin", () => {
  test("recognizes a plist that matches the new binary path", () => {
    expect(inferPlistOrigin(renderLaunchdPlist(CTX), CTX.golemBinary)).toBe("matches");
  });
  test("recognizes the old repo-local plist (bin/golem.js)", () => {
    const oldPlist = `<plist><dict>
      <key>ProgramArguments</key>
      <array>
        <string>/usr/bin/env</string>
        <string>node</string>
        <string>/Users/aviv/src/agents/Personal_Agent/bin/golem.js</string>
      </array>
    </dict></plist>`;
    expect(inferPlistOrigin(oldPlist, CTX.golemBinary)).toBe("repo-local");
  });
  test("returns unknown for arbitrary other plists", () => {
    expect(inferPlistOrigin("<plist></plist>", CTX.golemBinary)).toBe("unknown");
  });
});
