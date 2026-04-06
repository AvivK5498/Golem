/**
 * Shared tool metadata — single source of truth for onboarding and agent creation wizard.
 */

export interface ToolDefinition {
  id: string;
  label: string;
  description: string;
  detail: string;
  default?: boolean;
  security?: "high";
}

export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    id: "cron",
    label: "Cron scheduling",
    description: "Create and manage scheduled tasks",
    detail: "Schedule recurring tasks using cron expressions. The agent can create, pause, resume, and delete scheduled jobs.",
    default: true,
  },
  {
    id: "send_media",
    label: "Send media",
    description: "Send images, audio, video, documents",
    detail: "Send files to contacts via Telegram. Supports images, videos, audio, and documents.",
    default: true,
  },
  {
    id: "run_command",
    label: "Run commands",
    description: "Execute shell commands on the host",
    detail: "Allows the agent to run CLI commands on your machine. Only binaries you explicitly allow can be executed. Commands are sandboxed to allowed filesystem paths. Destructive operations require your approval.\n\nConfigure allowed binaries in Settings \u2192 Command Security after setup.",
    security: "high",
  },
  {
    id: "code_agent",
    label: "Code agent",
    description: "Delegate coding tasks to Claude Code",
    detail: "Spawns a Claude Code session to write, fix, or refactor code. The agent delegates coding work and returns results.\n\nRequires Claude Code CLI: npm install -g @anthropic-ai/claude-code && claude login",
  },
  {
    id: "config_update",
    label: "Config management",
    description: "Read and update platform configuration",
    detail: "Read and modify agent settings, model tiers, and platform configuration at runtime.",
  },
  {
    id: "store_secret",
    label: "Store secrets",
    description: "Save API keys and tokens to .env",
    detail: "Securely store API keys and tokens. Values are written to the .env file and loaded as environment variables.",
    security: "high",
  },
  {
    id: "schedule_job",
    label: "Background jobs",
    description: "Submit async jobs (HTTP polling, video gen)",
    detail: "Queue long-running tasks that execute in the background. Supports HTTP polling, video generation, and custom job types.",
  },
  {
    id: "task_write",
    label: "Task tracking",
    description: "Create and update task progress",
    detail: "Create checklists for multi-step work. The agent updates task status as it progresses, giving you real-time visibility.",
    default: true,
  },
];