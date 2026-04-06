export type HookName = "message_received" | "before_agent" | "after_tool_call" | "agent_end";

export interface HookContext {
  [key: string]: unknown;
}

export type HookResult = void | {
  skip?: boolean;
  modifiedText?: string;
  modifiedResult?: string;
};

export type HookHandler = (ctx: HookContext) => Promise<HookResult>;
