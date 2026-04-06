/**
 * Handoff tools — create and append to shared handoff files for multi-agent tasks.
 *
 * handoff_create: Main agent creates a handoff file before delegating to sub-agents.
 * handoff_append: Sub-agents write their results into the handoff file.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  createHandoff,
  appendToHandoff,
  readHandoff,
} from "../handoff.js";

// ---------------------------------------------------------------------------
// handoff_create — main agent creates a shared workspace file
// ---------------------------------------------------------------------------

export const handoffCreateTool = createTool({
  id: "handoff_create",
  description:
    "Create a handoff file for a complex task that needs multiple sub-agents or phases. " +
    "Use this before delegating to sub-agents when the task involves research, multi-step analysis, " +
    "or any work where multiple agents need to contribute to a shared result. " +
    "Returns the file path — pass it to each sub-agent in your delegation prompt. " +
    "After all sub-agents finish, read the file with handoff_read to synthesize the final answer.",
  inputSchema: z.object({
    topic: z.string().describe("Short description of the task (e.g., 'Personal AI agents research')"),
    sections: z
      .array(z.string())
      .optional()
      .describe("Named sections for the file (default: ['findings']). Use multiple sections for multi-phase work, e.g., ['reddit', 'hackernews', 'synthesis']"),
  }),
  execute: async (input, context) => {
    const jid = context?.requestContext?.get("jid" as never) as unknown as string | undefined;
    if (!jid) {
      return "No thread context — cannot create handoff file.";
    }

    const result = createHandoff({
      topic: input.topic,
      jid,
      sections: input.sections,
    });

    // Store the active handoff path on requestContext so sub-agents can see it
    if (context?.requestContext?.set) {
      context.requestContext.set("__activeHandoff" as never, result.filePath as never);
    }

    return `Handoff file created: ${result.filePath}\n\nPass this path to sub-agents in your delegation prompt. Tell them to use handoff_append to write their results to this file.`;
  },
});

// ---------------------------------------------------------------------------
// handoff_append — sub-agents write results to the handoff file
// ---------------------------------------------------------------------------

export const handoffAppendTool = createTool({
  id: "handoff_append",
  description:
    "Append your results to a handoff file. Use this when the delegating agent gave you a handoff file path. " +
    "Write your complete findings — this is the deliverable, not your response text. " +
    "After calling this, respond with a short confirmation only.",
  inputSchema: z.object({
    file_path: z.string().describe("Path to the handoff file (provided by the delegating agent)"),
    section: z.string().default("findings").describe("Section name to append to (e.g., 'reddit', 'hackernews', 'findings')"),
    content: z.string().describe("Your findings in markdown format. Include sources, quotes, and data. Be thorough — this is the primary deliverable."),
  }),
  execute: async (input, context) => {
    const agentName = context?.requestContext?.get("agentName" as never) as unknown as string | undefined;

    const result = appendToHandoff({
      filePath: input.file_path,
      section: input.section || "findings",
      content: input.content,
      agent: agentName || undefined,
    });

    if (!result.success) {
      return `Failed to append to handoff: ${result.error}`;
    }

    return "Results written to handoff file. Respond with a short confirmation to the delegating agent.";
  },
});

// ---------------------------------------------------------------------------
// handoff_read — main agent reads the completed handoff file
// ---------------------------------------------------------------------------

export const handoffReadTool = createTool({
  id: "handoff_read",
  description:
    "Read the contents of a handoff file. Use this after all sub-agents have finished writing to the file. " +
    "Synthesize the contents into a final response for the user.",
  inputSchema: z.object({
    file_path: z.string().describe("Path to the handoff file"),
  }),
  execute: async (input) => {
    const result = readHandoff(input.file_path);
    if ("error" in result) {
      return `Failed to read handoff: ${result.error}`;
    }
    return result.content;
  },
});
