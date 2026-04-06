export const APP_NAME = "Golem";

export const NAV_ITEMS = [
  { href: "/", label: "Home", icon: "LayoutDashboard" },
  { href: "/agents", label: "Agents", icon: "Bot" },
  { href: "/crons", label: "Crons", icon: "Clock" },
  { href: "/feed", label: "Feed", icon: "Activity" },
  { href: "/skills", label: "Skills", icon: "Sparkles" },
  { href: "/settings", label: "Settings", icon: "Settings" },
] as const;

export const SOURCE_ICONS = {
  direct: "MessageSquare",
  cron: "Clock",
  heartbeat: "Heart",
  webhook: "Webhook",
} as const;

export const POLL_INTERVAL_MS = 30_000;
