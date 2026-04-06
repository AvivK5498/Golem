export { HookRegistry } from "./registry.js";
export type { HookName, HookContext, HookHandler, HookResult } from "./types.js";

import { HookRegistry } from "./registry.js";

export const hookRegistry = new HookRegistry();
