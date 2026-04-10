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

/**
 * Curated list of user-facing optional tools shown in onboarding and the
 * agent creation wizard. Always-available tools (cron, send_media, task_write,
 * task_check, switch_model) are NOT included here — they're always enabled
 * and listed separately in the agent edit page under "Always available tools".
 */
export const BUILTIN_TOOLS: ToolDefinition[] = [
  {
    id: "workspace_read",
    label: "Read files",
    description: "Read and search files in the project directory",
    detail: "Lets the agent open, read, and search files anywhere in the Golem project directory. Most skills that consume context (documentation, examples, source code) need this.",
    default: true,
  },
  {
    id: "workspace_write",
    label: "Edit files",
    description: "Create, modify, and delete files in the project directory",
    detail: "Lets the agent create, modify, and delete files anywhere in the Golem project directory.\n\nRequired by the bundled skill-creator skill, which writes new SKILL.md files. Without this, skill-creator and similar skills will silently fail.",
    default: true,
    security: "high",
  },
  {
    id: "run_command",
    label: "Run commands",
    description: "Execute shell commands on the host",
    detail: "Allows the agent to run CLI binaries on your machine.\n\nThe binary allowlist is the real security boundary. Read-only tools (grep, cat, ls, wc, sort, head, tail, echo, date, pwd, which) are always available. Anything else must be explicitly approved in Settings \u2192 Command Security.\n\nBe selective about what you enable. Once you allow a scripting binary like python, node, or bash, those scripts can access any file the agent's process can — the agent's actions are bounded only by what those binaries themselves are capable of.\n\nA path-allowlist layer also blocks sensitive paths (.ssh, .env, .aws, credentials) when they're passed as command arguments — but it can't see paths used inside scripts, so don't rely on it for security.",
    security: "high",
  },
  {
    id: "code_agent",
    label: "Code agent",
    description: "Delegate coding tasks to Claude Code",
    detail: "Spawns a Claude Code session as a subprocess to write, fix, or refactor code. Use this for complex coding work that needs file editing, debugging, or running tests.\n\nArtifacts are saved to data/workspaces/{agent-id}/. Note that Claude Code itself has full filesystem access by design.\n\nRequires Claude Code CLI: npm install -g @anthropic-ai/claude-code && claude login",
    security: "high",
  },
  {
    id: "store_secret",
    label: "Store secrets",
    description: "Save API keys and tokens to .env",
    detail: "Writes a key/value pair to the .env file at the project root.\n\n\u26a0 Not secure: when you ask the agent to store a secret in conversation, the value is sent to your LLM provider in plaintext as part of the prompt. Use this only for keys you're comfortable sharing with your LLM provider, or set them manually by editing .env.",
    security: "high",
  },
  {
    id: "config_update",
    label: "Config management",
    description: "Read and update platform configuration",
    detail: "Read and modify agent settings, model tiers, and platform configuration at runtime.",
    security: "high",
  },
  {
    id: "schedule_job",
    label: "Background jobs",
    description: "Submit long-running async jobs",
    detail: "Lets the agent dispatch long-running tasks to a background queue instead of blocking the conversation. Useful for API calls that take time to complete and need polling until ready — common examples include video generation, image generation, and any third-party job that returns a job ID you have to check on later.\n\nThe conversation continues immediately after dispatch. When the job completes (or fails), the agent is notified and can deliver the result to you.\n\nSkills that need this tool will tell the agent exactly what to dispatch.",
  },
];