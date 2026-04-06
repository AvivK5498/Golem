import fs from "node:fs";
import path from "node:path";

export interface ScanResult {
  critical: string[];
  warnings: string[];
  scannedFiles: number;
}

const SCANNABLE_EXTENSIONS = new Set([".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx", ".py"]);

const CRITICAL_RULES: Array<{ pattern: RegExp; message: string; context?: RegExp }> = [
  { pattern: /\b(exec|execSync|spawn|spawnSync|fork)\s*\(/, message: "Shell command execution detected", context: /child_process|require\s*\(\s*['"]child_process/ },
  { pattern: /\beval\s*\(/, message: "eval() usage detected" },
  { pattern: /new\s+Function\s*\(/, message: "new Function() constructor detected" },
  { pattern: /stratum\+tcp|coinhive|cryptonight|monero/i, message: "Possible crypto-mining pattern" },
  { pattern: /process\.env/, message: "Environment variable access with network activity", context: /fetch\(|http\.request|axios|got\(|node-fetch/ },
];

const WARNING_RULES: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /new\s+WebSocket\s*\(/, message: "WebSocket connection detected" },
  { pattern: /\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){10,}/i, message: "Obfuscated hex code detected" },
];

export function scanSkillDirectory(skillDir: string): ScanResult {
  const critical: string[] = [];
  const warnings: string[] = [];
  let scannedFiles = 0;

  function scanDir(dir: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
        scanDir(fullPath);
      } else if (entry.isFile() && SCANNABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        scannedFiles++;
        const content = fs.readFileSync(fullPath, "utf-8");
        const relativePath = path.relative(skillDir, fullPath);

        for (const rule of CRITICAL_RULES) {
          if (rule.pattern.test(content)) {
            if (rule.context && !rule.context.test(content)) continue;
            critical.push(`[CRITICAL] ${relativePath}: ${rule.message}`);
          }
        }

        for (const rule of WARNING_RULES) {
          if (rule.pattern.test(content)) {
            warnings.push(`[WARNING] ${relativePath}: ${rule.message}`);
          }
        }
      }
    }
  }

  scanDir(skillDir);
  return { critical, warnings, scannedFiles };
}
