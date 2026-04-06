"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  Clock,
  Heart,
  LayoutDashboard,
  Moon,
  RotateCw,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { APP_NAME } from "@/lib/constants";
import type { HealthInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/crons", label: "Crons", icon: Clock },
  { href: "/feed", label: "Feed", icon: Activity },
  { href: "/skills", label: "Skills", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppSidebar({ health }: { health?: HealthInfo | null }) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [restarting, setRestarting] = useState(false);

  async function handleRestart() {
    if (restarting) return;
    setRestarting(true);
    try {
      await fetch("/api/restart", { method: "POST" });
      const poll = async () => {
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const res = await fetch("/api/health");
            if (res.ok) { window.location.reload(); return; }
          } catch { /* still down */ }
        }
        setRestarting(false);
      };
      setTimeout(() => void poll(), 3000);
    } catch { setRestarting(false); }
  }

  return (
    <aside className="flex h-screen w-[220px] shrink-0 flex-col border-r border-border/50 bg-card">
      {/* Brand */}
      <div className="px-5 py-5">
        <span className="text-[15px] font-semibold text-foreground tracking-tight">
          {APP_NAME}
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "bg-[var(--brand)]/10 text-[var(--brand-text)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon size={16} strokeWidth={active ? 2 : 1.5} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/50 px-3 py-3 space-y-2">
        {/* Health indicator */}
        {health && (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-success)] status-dot-pulse" />
            <span className="text-xs text-muted-foreground">
              {health.uptimeHuman}
            </span>
            <span className="text-xs text-muted-foreground ml-auto font-mono tabular-nums">
              {health.memory.heap}MB
            </span>
          </div>
        )}

        {/* Actions row */}
        <div className="flex items-center gap-1 px-1">
          <Tooltip>
            <TooltipTrigger
              className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Sun size={14} className="rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
              <Moon size={14} className="absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            </TooltipTrigger>
            <TooltipContent side="top">Toggle theme</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={handleRestart}
            >
              <RotateCw size={14} className={restarting ? "animate-spin text-[var(--status-warning)]" : ""} />
            </TooltipTrigger>
            <TooltipContent side="top">
              {restarting ? "Restarting..." : "Restart platform"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
