import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { applySchemaOverrides, SCHEMA_OVERRIDES } from "./mcp-client.js";

// Regression guard for the draft-2020-12 fix: Firecrawl's MCP tools ship a JSON
// Schema (draft 2020-12) that Mastra's validator can't resolve, so we swap in a
// clean Zod schema by MUTATING the Tool instance in place. These tests pin that
// behavior — if the mutation stops taking effect, or an override silently fails
// to match a renamed tool, the bug returns invisibly in prod.

const fakeTool = () => ({ inputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema" } });

describe("applySchemaOverrides", () => {
  test("mutates the matching tool instance in place (same reference)", () => {
    const scrape = fakeTool();
    const tools = { firecrawl_firecrawl_scrape: scrape };
    const override = z.object({ url: z.string() });

    const applied = applySchemaOverrides(tools, { firecrawl_firecrawl_scrape: override });

    expect(applied).toEqual(["firecrawl_firecrawl_scrape"]);
    // Same object identity — proves we mutated, not replaced (the load-bearing bit).
    expect(tools.firecrawl_firecrawl_scrape).toBe(scrape);
    expect(scrape.inputSchema).toBe(override);
  });

  test("warns when the server is loaded but the tool id is missing (rename)", () => {
    const warnings: string[] = [];
    const tools = { firecrawl_some_other_tool: fakeTool() };

    const applied = applySchemaOverrides(
      tools,
      { firecrawl_firecrawl_scrape: z.object({ url: z.string() }) },
      (m) => warnings.push(m),
    );

    expect(applied).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("firecrawl_firecrawl_scrape");
  });

  test("stays silent when the override's server isn't loaded at all", () => {
    const warnings: string[] = [];
    const tools = { "brave-search_brave_web_search": fakeTool() };

    applySchemaOverrides(
      tools,
      { firecrawl_firecrawl_scrape: z.object({ url: z.string() }) },
      (m) => warnings.push(m),
    );

    expect(warnings).toEqual([]);
  });

  test("the real SCHEMA_OVERRIDES are valid Zod schemas keyed by serverName_toolName", () => {
    for (const [id, schema] of Object.entries(SCHEMA_OVERRIDES)) {
      expect(id).toContain("_");
      expect(typeof (schema as z.ZodTypeAny).parse).toBe("function");
    }
    // The two ids the platform actually relies on today.
    expect(Object.keys(SCHEMA_OVERRIDES)).toContain("firecrawl_firecrawl_scrape");
    expect(SCHEMA_OVERRIDES.firecrawl_firecrawl_scrape.parse({ url: "https://x.com" })).toEqual({ url: "https://x.com" });
  });
});
