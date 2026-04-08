"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import {
  ChevronDown,
  Github,
  Monitor,
  Moon,
  RotateCw,
  Sun,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useRestartRequired } from "@/lib/use-restart-required";
import { cn } from "@/lib/utils";

/**
 * System menu — dropdown next to the "golem" wordmark.
 * Houses theme toggle, restart, and other personal/system actions.
 *
 * Pulses with brand color when a restart is required (state-driven from
 * useRestartRequired).
 */
export function SystemMenu() {
  const { theme, setTheme } = useTheme();
  const { required: restartRequired, clear: clearRestartRequired } = useRestartRequired();
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function doRestart() {
    setConfirmOpen(false);
    clearRestartRequired();
    try {
      // Fire the restart and immediately navigate to the restarting screen.
      // The restarting page polls /api/health and redirects home when ready.
      await fetch("/api/restart", { method: "POST" }).catch(() => {
        /* ignore — platform may already be tearing down */
      });
    } finally {
      window.location.href = "/restarting";
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="System menu"
          className={cn(
            "flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors relative",
            restartRequired && "text-[var(--brand-text)] animate-pulse-soft"
          )}
        >
          <ChevronDown size={14} />
          {restartRequired && (
            <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-[var(--brand)] ring-2 ring-card status-dot-pulse" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="bottom" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
              Theme
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun size={14} />
              Light
              {theme === "light" && <span className="ml-auto text-[10px] text-muted-foreground">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon size={14} />
              Dark
              {theme === "dark" && <span className="ml-auto text-[10px] text-muted-foreground">✓</span>}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor size={14} />
              System
              {theme === "system" && <span className="ml-auto text-[10px] text-muted-foreground">✓</span>}
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
              Platform
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => setConfirmOpen(true)}
              className={cn(restartRequired && "text-[var(--brand-text)]")}
            >
              <RotateCw size={14} />
              Restart platform
              {restartRequired && (
                <span className="ml-auto text-[10px] text-[var(--brand-text)]">required</span>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                window.open("https://github.com/AvivK5498/Golem", "_blank", "noopener,noreferrer")
              }
            >
              <Github size={14} />
              GitHub
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart platform?</AlertDialogTitle>
            <AlertDialogDescription>
              The Golem platform will shut down and restart. Active connections will be
              briefly interrupted. The page will reload automatically when it&rsquo;s back up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doRestart}>Restart</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
