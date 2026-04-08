"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useFetch } from "@/lib/use-api";

interface SetupStatus {
  configured: boolean;
  hasApiKey: boolean;
  agentCount: number;
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isFullScreen =
    pathname.startsWith("/onboarding") ||
    pathname === "/agents/new" ||
    pathname.startsWith("/restarting");
  const { data: setup } = useFetch<SetupStatus>("/api/setup/status", 0);

  useEffect(() => {
    if (setup && !setup.configured && !pathname.startsWith("/onboarding")) {
      router.replace("/onboarding");
    }
  }, [setup, pathname, router]);

  if (isFullScreen) {
    return <TooltipProvider delay={100}>{children}</TooltipProvider>;
  }

  return (
    <TooltipProvider delay={100}>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar />
        <main className="flex-1 overflow-auto px-6 py-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
