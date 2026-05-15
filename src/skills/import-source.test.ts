import { describe, expect, test } from "bun:test";
import { parseSource, isValidSkillKey } from "./import-source.js";

describe("parseSource", () => {
  test("github shorthand: owner/repo", () => {
    expect(parseSource("github:anthropics/skills")).toEqual({
      kind: "github",
      owner: "anthropics",
      repo: "skills",
      skillName: undefined,
    });
  });

  test("github shorthand: owner/repo/skill", () => {
    expect(parseSource("github:anthropics/skills/release")).toEqual({
      kind: "github",
      owner: "anthropics",
      repo: "skills",
      skillName: "release",
    });
  });

  test("github shorthand @ form", () => {
    expect(parseSource("github:anthropics/skills@release")).toEqual({
      kind: "github",
      owner: "anthropics",
      repo: "skills",
      skillName: "release",
    });
  });

  test("github.com URL", () => {
    const r = parseSource("https://github.com/anthropics/skills");
    expect(r?.owner).toBe("anthropics");
    expect(r?.repo).toBe("skills");
    expect(r?.kind).toBe("github");
  });

  test("github.com URL with .git suffix", () => {
    expect(parseSource("https://github.com/anthropics/skills.git")?.repo).toBe("skills");
  });

  test("github.com URL with /tree/<ref> captures ref", () => {
    const r = parseSource("https://github.com/anthropics/skills/tree/main/release");
    expect(r?.ref).toBe("main");
  });

  test("skills.sh URL", () => {
    expect(parseSource("https://skills.sh/anthropics/skills/release")).toEqual({
      kind: "skills_sh",
      owner: "anthropics",
      repo: "skills",
      skillName: "release",
    });
  });

  test("strips `npx skills add` prefix", () => {
    expect(parseSource("npx skills add github:anthropics/skills/release")?.skillName).toBe(
      "release",
    );
  });

  test("folds --skill flag into skillName", () => {
    expect(parseSource("github:anthropics/skills --skill release")?.skillName).toBe("release");
  });

  test("rejects unknown formats", () => {
    expect(parseSource("local:/etc/passwd")).toBeNull();
    expect(parseSource("not a source")).toBeNull();
    expect(parseSource("")).toBeNull();
  });
});

describe("isValidSkillKey", () => {
  test("accepts kebab-case", () => {
    expect(isValidSkillKey("release")).toBe(true);
    expect(isValidSkillKey("my-skill")).toBe(true);
    expect(isValidSkillKey("a1-b2-c3")).toBe(true);
  });

  test("rejects path traversal and separators", () => {
    expect(isValidSkillKey("../etc")).toBe(false);
    expect(isValidSkillKey("foo/bar")).toBe(false);
    expect(isValidSkillKey(".hidden")).toBe(false);
    expect(isValidSkillKey("Foo")).toBe(false);
    expect(isValidSkillKey("foo_bar")).toBe(false);
    expect(isValidSkillKey("-leading")).toBe(false);
    expect(isValidSkillKey("trailing-")).toBe(false);
    expect(isValidSkillKey("")).toBe(false);
    expect(isValidSkillKey("a".repeat(65))).toBe(false);
  });
});
