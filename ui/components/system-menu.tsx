"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { ChevronDown, Github, RotateCw } from "lucide-react";
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
import { GOLEM_THEMES, type GolemTheme } from "@/components/providers";

interface ThemePreset {
  id: GolemTheme;
  label: string;
  swatchBg: string;     // small disc background
  swatchAccent: string; // small disc accent dot
  description: string;
}

const THEME_PRESETS: Record<GolemTheme, ThemePreset> = {
  clay:     { id: "clay",     label: "Clay",     swatchBg: "#FAF7F2", swatchAccent: "#C2410C", description: "Warm cream + terracotta" },
  indigo:   { id: "indigo",   label: "Indigo",   swatchBg: "#FAFAF7", swatchAccent: "#312E81", description: "Soft off-white + deep ink" },
  sage:     { id: "sage",     label: "Sage",     swatchBg: "#F7F8F5", swatchAccent: "#4D7C5C", description: "Cool light + muted forest" },
  espresso: { id: "espresso", label: "Espresso", swatchBg: "#1A1714", swatchAccent: "#E8853A", description: "Warm dark + amber" },
  mono:     { id: "mono",     label: "Mono",     swatchBg: "#FAFAFA", swatchAccent: "#141414", description: "Neutral light, monochrome" },
};

function Swatch({ bg, accent }: { bg: string; accent: string }) {
  return (
    <span
      className="inline-flex items-center justify-center h-4 w-4 rounded-full border border-black/10"
      style={{ background: bg }}
      aria-hidden
    >
      <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
    </span>
  );
}

export function SystemMenu() {
  const { theme, setTheme } = useTheme();
  const { required: restartRequired, clear: clearRestartRequired } = useRestartRequired();
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function doRestart() {
    setConfirmOpen(false);
    clearRestartRequired();
    try {
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
        <DropdownMenuContent align="start" side="bottom" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
              Theme
            </DropdownMenuLabel>
            {GOLEM_THEMES.map((id) => {
              const preset = THEME_PRESETS[id];
              const active = theme === id;
              return (
                <DropdownMenuItem
                  key={id}
                  onClick={() => setTheme(id)}
                  className="gap-2.5"
                >
                  <Swatch bg={preset.swatchBg} accent={preset.swatchAccent} />
                  <span className="flex flex-col gap-0.5 leading-tight">
                    <span className="text-[13px]">{preset.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {preset.description}
                    </span>
                  </span>
                  {active && (
                    <span className="ml-auto text-[10px] text-muted-foreground">✓</span>
                  )}
                </DropdownMenuItem>
              );
            })}
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
