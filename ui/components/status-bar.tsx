"use client";

import Link from "next/link";
import { useFetch } from "@/lib/use-api";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import { todayMidnight } from "@/lib/format";
import type { FeedEntry, FeedCounts, FeedTokens, PlatformAgent } from "@/lib/types";
import { AlertTriangle, Circle } from "lucide-react";

const since = todayMidnight();

interface HealthStatus {
  startedAt?: number;
  uptime?: number;
  uptimeHuman?: string;
}

/**
 * Persistent bottom status bar — present on every routed page. Anchors the
 * app the way Cabinet's bottom bar does. Surfaces:
 *   - Platform connection (online / offline)
 *   - Fleet state (N of M agents online, with an error indicator when
 *     today's feed has >0 errored entries)
 *   - Aggregate tokens-today (subtle)
 *
 * The error indicator is the *shell-level* error signal called out in the
 * grilling decision: invisible at zero, accent-colored when not.
 */
export function StatusBar() {
  const { data: health, error: healthErr } = useFetch<HealthStatus>(
    "/api/health",
    POLL_INTERVAL_MS,
  );
  const { data: agentData } = useFetch<{ agents: PlatformAgent[] }>(
    "/api/platform/agents",
    POLL_INTERVAL_MS,
  );
  const { data: feedData } = useFetch<{
    entries: FeedEntry[];
    counts: FeedCounts;
    tokens: FeedTokens;
  }>(`/api/feed?agent_id=all&limit=1&since=${since}`, POLL_INTERVAL_MS);

  const online = !healthErr && health?.uptime != null;
  const agents = agentData?.agents ?? [];
  const connectedCount = agents.filter((a) => a.connected && a.enabled).length;
  const errorCount = feedData?.counts.error ?? 0;
  const tokens = (feedData?.tokens.totalIn ?? 0) + (feedData?.tokens.totalOut ?? 0);

  return (
    <div className="flex items-center gap-4 border-t border-border/50 bg-card/40 px-4 py-1.5 text-[11px] text-muted-foreground">
      {/* Platform status */}
      <span className="inline-flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            online
              ? "bg-[var(--status-success)] status-dot-pulse"
              : "bg-[var(--status-error)]"
          }`}
        />
        {online ? "Online" : "Offline"}
      </span>

      <span className="text-[var(--text-tertiary)]">·</span>

      {/* Fleet */}
      <span className="tabular-nums">
        {connectedCount} of {agents.length} agents
      </span>

      {/* Error indicator — invisible at 0, accent-colored when > 0.
          Links to filtered Feed view. */}
      {errorCount > 0 && (
        <>
          <span className="text-[var(--text-tertiary)]">·</span>
          <Link
            href="/feed?status=error"
            className="inline-flex items-center gap-1 text-[var(--status-error)] hover:underline animate-pulse-soft"
          >
            <AlertTriangle size={11} />
            {errorCount} error{errorCount === 1 ? "" : "s"} today
          </Link>
        </>
      )}

      {tokens > 0 && (
        <>
          <span className="text-[var(--text-tertiary)] ml-auto">·</span>
          <span className="tabular-nums">
            {tokens.toLocaleString()} tokens today
          </span>
        </>
      )}

      {tokens === 0 && <span className="ml-auto" />}
    </div>
  );
}
