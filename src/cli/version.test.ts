import { describe, expect, test } from "bun:test";

import { readPackageVersion } from "./version.js";

describe("readPackageVersion", () => {
  test("returns a non-empty version string", () => {
    const v = readPackageVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});
