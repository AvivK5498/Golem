"use client";

import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFetch } from "@/lib/use-api";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import type { HealthInfo } from "@/lib/types";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullScreen = pathname.startsWith("/onboarding") || pathname === "/agents/new";
  const { data: health } = useFetch<HealthInfo>("/api/health", POLL_INTERVAL_MS);

  if (isFullScreen) {
    return <TooltipProvider delay={100}>{children}</TooltipProvider>;
  }

  return (
    <TooltipProvider delay={100}>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar health={health} />
        <main className="flex-1 overflow-auto px-6 py-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
