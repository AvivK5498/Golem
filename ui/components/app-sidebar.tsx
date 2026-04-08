"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  ChevronDown,
  Clock,
  Github,
  LayoutDashboard,
  Puzzle,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { SystemMenu } from "@/components/system-menu";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };
type NavSection = { id: string; label: string | null; items: NavItem[] };

const SECTIONS: NavSection[] = [
  {
    id: "overview",
    label: null, // top-level, no header
    items: [{ href: "/", label: "Home", icon: LayoutDashboard }],
  },
  {
    id: "build",
    label: "Build",
    items: [
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/skills", label: "Skills", icon: Puzzle },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      { href: "/crons", label: "Crons", icon: Clock },
      { href: "/feed", label: "Feed", icon: Activity },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const toggleSection = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <aside className="flex h-screen w-[220px] shrink-0 flex-col border-r border-border/50 bg-card">
      {/* Brand */}
      <div className="px-5 pt-6 pb-6 flex items-center justify-between">
        <span
          className="text-[32px] leading-none font-normal tracking-[-0.01em] text-foreground/85"
          style={{ fontFamily: "var(--font-jost), system-ui, sans-serif" }}
        >
          golem
        </span>
        <SystemMenu />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-3 overflow-y-auto">
        {SECTIONS.map((section) => {
          const isCollapsed = collapsed[section.id];
          return (
            <div key={section.id} className="space-y-0.5">
              {section.label && (
                <button
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>{section.label}</span>
                  <ChevronDown
                    size={13}
                    className={cn(
                      "transition-transform opacity-70",
                      isCollapsed && "-rotate-90"
                    )}
                  />
                </button>
              )}
              {!isCollapsed &&
                section.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-normal transition-colors",
                        active
                          ? "bg-[var(--brand)]/10 text-[var(--brand-text)] font-medium"
                          : "text-foreground/85 hover:text-foreground hover:bg-accent"
                      )}
                    >
                      <Icon size={18} strokeWidth={active ? 2 : 1.6} />
                      {label}
                    </Link>
                  );
                })}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/50 px-3 py-3">
        <div className="space-y-0.5">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-normal transition-colors",
              isActive("/settings")
                ? "bg-[var(--brand)]/10 text-[var(--brand-text)] font-medium"
                : "text-foreground/85 hover:text-foreground hover:bg-accent"
            )}
          >
            <Settings size={18} strokeWidth={isActive("/settings") ? 2 : 1.6} />
            Settings
          </Link>
          <a
            href="https://github.com/AvivK5498/Golem"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-[14px] font-normal text-foreground/85 hover:text-foreground hover:bg-accent transition-colors"
          >
            <Github size={18} strokeWidth={1.6} />
            GitHub
          </a>
        </div>
      </div>
    </aside>
  );
}
