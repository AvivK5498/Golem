import { randomUUID } from "node:crypto";

export interface PromptTraceMessage {
  role: string;
  content: string;
}

export interface PromptTraceMemory {
  thread?: string;
  resource?: string;
  readOnly?: boolean;
  observationalMemory?: boolean;
}

export interface PromptTraceRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "started" | "completed" | "failed";
  platform?: string;
  jid?: string;
  chatType?: string;
  promptMode?: string;
  model?: string;
  instructions: string;
  messages: PromptTraceMessage[];
  contextMessages: PromptTraceMessage[];
  tools: string[];
  memory?: PromptTraceMemory;
  durationMs?: number;
  finishReason?: string;
  toolCalls?: number;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  error?: string;
  resultPreview?: string;
}

interface StartPromptTraceParams {
  platform?: string;
  jid?: string;
  chatType?: string;
  promptMode?: string;
  model?: string;
  instructions: string;
  messages: PromptTraceMessage[];
  contextMessages?: PromptTraceMessage[];
  tools: string[];
  memory?: PromptTraceMemory;
}

interface CompletePromptTraceParams {
  id: string;
  durationMs?: number;
  finishReason?: string;
  toolCalls?: number;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  resultPreview?: string;
}

interface FailPromptTraceParams {
  id: string;
  durationMs?: number;
  error: string;
}

const MAX_TRACES = 200;
const _MAX_TEXT_CHARS = 24_000;
const traces: PromptTraceRecord[] = [];

function trimText(value: string): string {
  return value;
}

function trimMessages(messages: PromptTraceMessage[] | undefined): PromptTraceMessage[] {
  if (!messages || messages.length === 0) return [];
  return messages.map((msg) => ({
    role: msg.role,
    content: trimText(msg.content || ""),
  }));
}

export function startPromptTrace(params: StartPromptTraceParams): string {
  const now = new Date().toISOString();
  const record: PromptTraceRecord = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "started",
    platform: params.platform,
    jid: params.jid,
    chatType: params.chatType,
    promptMode: params.promptMode,
    model: params.model,
    instructions: trimText(params.instructions || ""),
    messages: trimMessages(params.messages),
    contextMessages: trimMessages(params.contextMessages),
    tools: [...params.tools],
    memory: params.memory,
  };
  traces.unshift(record);
  if (traces.length > MAX_TRACES) {
    traces.length = MAX_TRACES;
  }
  return record.id;
}

export function completePromptTrace(params: CompletePromptTraceParams): void {
  const record = traces.find((item) => item.id === params.id);
  if (!record) return;
  record.status = "completed";
  record.updatedAt = new Date().toISOString();
  if (typeof params.durationMs === "number") record.durationMs = params.durationMs;
  if (params.finishReason) record.finishReason = params.finishReason;
  if (typeof params.toolCalls === "number") record.toolCalls = params.toolCalls;
  if (params.usage) record.usage = params.usage;
  if (params.resultPreview) record.resultPreview = trimText(params.resultPreview);
}

export function failPromptTrace(params: FailPromptTraceParams): void {
  const record = traces.find((item) => item.id === params.id);
  if (!record) return;
  record.status = "failed";
  record.updatedAt = new Date().toISOString();
  if (typeof params.durationMs === "number") record.durationMs = params.durationMs;
  record.error = trimText(params.error);
}

export function listPromptTraces(limit = 30): PromptTraceRecord[] {
  return traces.slice(0, Math.max(1, Math.min(200, limit)));
}

export function getPromptTraceById(id: string): PromptTraceRecord | undefined {
  return traces.find((item) => item.id === id);
}
