export interface SkillMetadata {
  name: string;
  description: string;
  requires?: {
    env?: string[];
    bins?: string[];
  };
  metadata?: {
    extended?: {
      version?: string;
      author?: string;
      tags?: string[];
      category?: string;
      requires?: {
        env?: string[];
        bins?: string[];
      };
    };
    [key: string]: unknown;
  };
}

export interface SkillEntry {
  name: string;
  description: string;
  dir: string; // absolute path to skill directory
  filePath: string; // absolute path to SKILL.md
  eligible: boolean; // whether requirements are met
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
}
