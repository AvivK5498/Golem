// Parse a skill install source string into a normalized descriptor.
//
// Accepted forms (v1):
//   github:owner/repo
//   github:owner/repo/skillName
//   github:owner/repo@skillName        (CLI-style filter)
//   https://github.com/owner/repo
//   https://github.com/owner/repo/tree/<ref>/<path>...
//   https://skills.sh/owner/repo
//   https://skills.sh/owner/repo/skillName
//   `npx skills add ...` / `skills add ...` prefixes are stripped.
//   `--skill <name>` flag is folded into skillName.

export interface ParsedSource {
  kind: "github" | "skills_sh";
  owner: string;
  repo: string;
  skillName?: string;
  ref?: string;
}

export function parseSource(raw: string): ParsedSource | null {
  let trimmed = raw.trim().replace(/^(?:npx\s+)?skills\s+add\s+/i, "");
  const flagMatch = trimmed.match(/\s+--skill[=\s]+([^\s]+)/);
  let flagSkill: string | undefined;
  if (flagMatch) {
    flagSkill = flagMatch[1];
    trimmed = trimmed.replace(flagMatch[0], "").trim();
  }

  const skillsSh = trimmed.match(
    /^https?:\/\/skills\.sh\/([^/?#\s]+)\/([^/?#\s]+)(?:\/([^/?#\s]+))?/,
  );
  if (skillsSh) {
    return {
      kind: "skills_sh",
      owner: skillsSh[1],
      repo: skillsSh[2],
      skillName: skillsSh[3] ?? flagSkill,
    };
  }

  const gh = trimmed.match(
    /^https?:\/\/github\.com\/([^/?#\s]+)\/([^/?#\s]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/?#\s]+))?(?:\/.*)?$/,
  );
  if (gh) {
    return {
      kind: "github",
      owner: gh[1],
      repo: gh[2],
      skillName: flagSkill,
      ref: gh[3],
    };
  }

  const shorthandAt = trimmed.match(/^github:([^/?#\s]+)\/([^/@?#\s]+)@([^/?#\s]+)$/);
  if (shorthandAt) {
    return {
      kind: "github",
      owner: shorthandAt[1],
      repo: shorthandAt[2],
      skillName: shorthandAt[3],
    };
  }

  const shorthand = trimmed.match(/^github:([^/?#\s]+)\/([^/?#\s]+?)(?:\/([^/?#\s]+))?$/);
  if (shorthand) {
    return {
      kind: "github",
      owner: shorthand[1],
      repo: shorthand[2],
      skillName: shorthand[3] ?? flagSkill,
    };
  }

  return null;
}

// Strict kebab-case key. Used as a directory name under the skills root,
// so it must not contain path separators or hidden-dir prefixes.
const SKILL_KEY_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function isValidSkillKey(s: string): boolean {
  if (!s || s.length > 64) return false;
  return SKILL_KEY_RE.test(s);
}
