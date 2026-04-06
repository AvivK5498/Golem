// Re-export everything from tools/ for backward compatibility
export { allTools, alwaysAvailableTools } from "./tools/index.js";
export { toolError, type ToolErrorResult } from "./tools/error-tagging.js";
export type { ToolRequestContext } from "./tools/types.js";
