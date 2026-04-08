"use client";

/**
 * Full-screen restarting page.
 *
 * Polls /api/health while the platform is restarting. Once the new platform
 * comes up (detected by a fresh `startedAt` newer than the time we navigated here),
 * redirects to the home page in the same tab.
 *
 * Falls back to a manual reload button after a timeout in case the restart hangs.
 */
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import type { HealthInfo } from "@/lib/types";

const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 90_000;

export default function RestartingPage() {
  const [phase, setPhase] = useState<"shutting-down" | "starting" | "ready" | "timeout">("shutting-down");
  const navigatedAt = useRef(Date.now());
  const previousStartedAt = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        const elapsed = Date.now() - navigatedAt.current;
        if (elapsed > MAX_WAIT_MS) {
          setPhase("timeout");
          return;
        }

        try {
          const res = await fetch("/api/health", { cache: "no-store" });
          if (res.ok) {
            const data: HealthInfo = await res.json();

            // First successful health check after navigation: capture startedAt
            if (previousStartedAt.current === null) {
              previousStartedAt.current = data.startedAt;
              setPhase("shutting-down");
            } else if (data.startedAt > previousStartedAt.current) {
              // Platform has restarted — startedAt is newer
              setPhase("ready");
              setTimeout(() => {
                window.location.href = "/";
              }, 600);
              return;
            }
          } else {
            // 5xx or similar — platform is shutting down
            setPhase("starting");
          }
        } catch {
          // Network error — platform is down (shutting down or starting)
          setPhase("starting");
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, []);

  const message = {
    "shutting-down": "Shutting down platform...",
    starting: "Starting platform...",
    ready: "Ready — redirecting...",
    timeout: "Restart is taking longer than expected.",
  }[phase];

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 max-w-md text-center px-6">
        <div className="relative">
          <div className="h-16 w-16 rounded-full bg-[var(--brand)]/10 flex items-center justify-center">
            <RotateCw
              size={28}
              className={
                phase === "ready" || phase === "timeout"
                  ? "text-[var(--brand-text)]"
                  : "text-[var(--brand-text)] animate-spin"
              }
              style={{ animationDuration: "1.4s" }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h1
            className="text-[28px] font-normal tracking-[-0.01em] text-foreground/90"
            style={{ fontFamily: "var(--font-jost), system-ui, sans-serif" }}
          >
            Restarting golem
          </h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>

        {phase === "timeout" && (
          <button
            type="button"
            onClick={() => (window.location.href = "/")}
            className="mt-2 rounded-md bg-[var(--brand)]/10 px-4 py-2 text-sm font-medium text-[var(--brand-text)] hover:bg-[var(--brand)]/20 transition-colors"
          >
            Reload anyway
          </button>
        )}
      </div>
    </div>
  );
}
