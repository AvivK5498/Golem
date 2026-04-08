export interface Job {
  id: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  input: string;
  result?: string;
  error?: string | null;
  target_jid: string;
  created_at: number;
  started_at?: number | null;
  completed_at?: number | null;
  attempt: number;
  max_attempts: number;
  timeout_ms: number;
  platform: string;
}

export interface ParsedJobInput {
  // coding jobs
  task?: string;
  agent?: string;
  cwd?: string;
  _github?: {
    repo: string;
    issueNumber: number;
    issueTitle: string;
    issueUrl: string;
    branch: string;
  };
  // http-poll jobs
  label?: string;
  submitBody?: { input?: { prompt?: string; duration?: number } };
}

export interface ParsedJobResult {
  // coding jobs
  output?: string;
  agent?: string;
  durationMs?: number;
  // http-poll jobs
  result?: string;
  jobId?: string;
  statusResponse?: {
    delayTime?: number;
    executionTime?: number;
    workerId?: string;
    output?: { cost?: number; result?: string };
  };
}

export interface AgentConfig {
  description: string;
  instructions?: string;
  model?: string;
  tools: string[];
  skills?: string[];
  maxSteps?: number;
}

export interface HealthInfo {
  startedAt: number;
  uptime: number;
  uptimeHuman: string;
  memory: { rss: number; heap: number; heapTotal: number };
}

export interface LogEndpoint {
  id: string;
  label: string;
  dates: string[];
  hasLive: boolean;
  pinned: boolean;
}

export interface LogFile {
  name: string;
  size: number;
  modifiedAt: number;
  live: boolean;
  lines: number;
}

export interface LogContent {
  content: string;
  totalLines: number;
  file: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number;
}

export interface SkillInfo {
  name: string;
  description: string;
  eligible: boolean;
}


export interface FeedEntry {
  id: number;
  timestamp: number;
  source: string;
  source_name: string | null;
  input: string;
  output: string | null;
  sub_agent: string | null;
  status: string;
  tokens_in: number | null;
  tokens_out: number | null;
  latency_ms: number | null;
  platform: string | null;
  agent_id: string | null;
}

export interface FeedCounts {
  total: number;
  delivered: number;
  suppressed: number;
  error: number;
}

export interface FeedTokens {
  totalIn: number;
  totalOut: number;
  count: number;
}

export interface PlatformAgent {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  connected: boolean;
  model: string;
  toolCount: number;
  cronCount: number;
  warnings?: string[];
}

export interface CronJob {
  id: number;
  name: string;
  description: string;
  cron_expr: string;
  task_kind: string;
  target_jid: string | null;
  platform: string | null;
  paused: number;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  agent_id: string | null;
}
