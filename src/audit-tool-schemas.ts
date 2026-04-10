#!/usr/bin/env npx tsx
/**
 * Tool schema audit:
 *  1. Walk every tool in `allTools`
 *  2. Convert its Zod inputSchema to JSON Schema using THE SAME function
 *     Mastra uses internally before shipping to OpenRouter
 *  3. Report which fields lack a description (the model can't see it without one)
 *  4. Optionally pretty-print one full schema so we can verify the wire format
 *
 * Usage:
 *   npx tsx src/audit-tool-schemas.ts                  → audit all tools
 *   npx tsx src/audit-tool-schemas.ts --dump send_media → also pretty-print one tool's schema
 */
import "dotenv/config";
import { zodToJsonSchema } from "@mastra/core/utils/zod-to-json";
import { allTools } from "./agent/tools/index.js";

const args = process.argv.slice(2);
let dumpName: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dump" && args[i + 1]) {
    dumpName = args[++i];
  }
}

interface FieldStatus {
  name: string;
  type: string;
  required: boolean;
  hasDescription: boolean;
  description?: string;
}

interface ToolAudit {
  name: string;
  toolDescriptionLen: number;
  totalFields: number;
  describedFields: number;
  fields: FieldStatus[];
}

function describePropertyType(prop: unknown): string {
  if (!prop || typeof prop !== "object") return "unknown";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = prop as any;
  if (p.enum) return `enum(${p.enum.join("|")})`;
  if (p.type === "array") return `array<${p.items?.type || "?"}>`;
  if (p.type === "object") return "object";
  return p.type || "?";
}

function auditTool(name: string, tool: unknown): ToolAudit | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = tool as any;
  const inputSchema = t?.inputSchema;
  const description: string = t?.description || "";

  if (!inputSchema) {
    return {
      name,
      toolDescriptionLen: description.length,
      totalFields: 0,
      describedFields: 0,
      fields: [],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jsonSchema: any;
  try {
    jsonSchema = zodToJsonSchema(inputSchema);
  } catch (err) {
    console.warn(`  [${name}] zodToJsonSchema threw:`, err instanceof Error ? err.message : err);
    return null;
  }

  const properties = jsonSchema?.properties || {};
  const required: string[] = jsonSchema?.required || [];

  const fields: FieldStatus[] = [];
  for (const [fieldName, prop] of Object.entries(properties)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = prop as any;
    fields.push({
      name: fieldName,
      type: describePropertyType(p),
      required: required.includes(fieldName),
      hasDescription: typeof p?.description === "string" && p.description.length > 0,
      description: p?.description,
    });
  }

  return {
    name,
    toolDescriptionLen: description.length,
    totalFields: fields.length,
    describedFields: fields.filter(f => f.hasDescription).length,
    fields,
  };
}

// ── Run the audit ────────────────────────────────────────────
const audits: ToolAudit[] = [];
for (const [name, tool] of Object.entries(allTools)) {
  const audit = auditTool(name, tool);
  if (audit) audits.push(audit);
}

// ── Dump one tool's full schema if requested ─────────────────
if (dumpName) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tool = (allTools as any)[dumpName];
  if (!tool) {
    console.error(`Tool "${dumpName}" not found. Available: ${Object.keys(allTools).join(", ")}`);
    process.exit(1);
  }
  console.log(`\n══════ FULL JSON Schema for "${dumpName}" (Mastra wire format) ══════`);
  const jsonSchema = zodToJsonSchema(tool.inputSchema);
  console.log(JSON.stringify(jsonSchema, null, 2));
  console.log("══════════════════════════════════════════════════════════════════\n");
}

// ── Summary table ────────────────────────────────────────────
console.log(`\n═══ Tool .describe() audit (${audits.length} tools) ═══\n`);
console.log("Tool                  Fields  Described  Missing  Coverage");
console.log("-".repeat(64));

let totalFields = 0;
let totalDescribed = 0;
const offenders: ToolAudit[] = [];
for (const a of audits.sort((x, y) => x.name.localeCompare(y.name))) {
  totalFields += a.totalFields;
  totalDescribed += a.describedFields;
  const missing = a.totalFields - a.describedFields;
  const coverage = a.totalFields === 0 ? "n/a   " : `${Math.round(100 * a.describedFields / a.totalFields)}%`.padStart(6);
  const flag = missing > 0 ? " ⚠" : "";
  console.log(
    a.name.padEnd(22),
    String(a.totalFields).padStart(6),
    String(a.describedFields).padStart(10),
    String(missing).padStart(8),
    coverage,
    flag,
  );
  if (missing > 0) offenders.push(a);
}
console.log("-".repeat(64));
const overallCoverage = totalFields === 0 ? 0 : Math.round(100 * totalDescribed / totalFields);
console.log(`TOTAL                  ${String(totalFields).padStart(6)} ${String(totalDescribed).padStart(10)} ${String(totalFields - totalDescribed).padStart(8)} ${String(overallCoverage + "%").padStart(6)}\n`);

// ── Detailed offender list ───────────────────────────────────
if (offenders.length > 0) {
  console.log("═══ Tools with missing descriptions ═══\n");
  for (const a of offenders) {
    console.log(`▶ ${a.name}  (${a.describedFields}/${a.totalFields})`);
    for (const f of a.fields) {
      const mark = f.hasDescription ? "✓" : "✗";
      const req = f.required ? " (required)" : "";
      const desc = f.hasDescription ? `: "${(f.description ?? "").slice(0, 60)}${(f.description ?? "").length > 60 ? "…" : ""}"` : "";
      console.log(`  ${mark} ${f.name}: ${f.type}${req}${desc}`);
    }
    console.log();
  }
}

process.exit(0);
