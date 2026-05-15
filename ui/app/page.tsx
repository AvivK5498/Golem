"use client";

import { useMemo } from "react";
import { useFetch } from "@/lib/use-api";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import { timeAgo, todayMidnight, fullDateTime, compactNumber } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  Clock,
  Coins,
  AlertTriangle,
  Wifi,
  WifiOff,
  CalendarClock,
} from "lucide-react";
import type { FeedEntry, FeedCounts, FeedTokens, PlatformAgent, CronJob } from "@/lib/types";

const since = todayMidnight();

interface AgentSignals {
  lastActivityTs: number | null;
  conversationsToday: number;
  tokensToday: number;
  nextRunAt: number | null;
  nextRunLabel: string | null;
}

function deriveSignals(
  agentId: string,
  feed: FeedEntry[],
  crons: CronJob[],
): AgentSignals {
  const entries = feed.filter((e) => e.agent_id === agentId);
  const lastActivityTs = entries.length > 0
    ? Math.max(...entries.map((e) => e.timestamp))
    : null;
  const tokensToday = entries.reduce(
    (sum, e) => sum + (e.tokens_in ?? 0) + (e.tokens_out ?? 0),
    0,
  );
  // Conversations = distinct direct-source entries
  const conversationsToday = entries.filter((e) => e.source === "direct").length;

  const upcomingCrons = crons
    .filter((c) => c.agent_id === agentId && !c.paused && c.next_run_at != null)
    .sort((a, b) => (a.next_run_at! - b.next_run_at!));
  const nextCron = upcomingCrons[0] ?? null;

  return {
    lastActivityTs,
    conversationsToday,
    tokensToday,
    nextRunAt: nextCron?.next_run_at ?? null,
    nextRunLabel: nextCron?.name ?? null,
  };
}

function AgentCard({
  agent,
  signals,
}: {
  agent: PlatformAgent;
  signals: AgentSignals;
}) {
  const connected = agent.connected && agent.enabled;

  return (
    <Link href={`/agents/${agent.id}`}>
      <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer group h-full">
        <CardContent className="p-5 flex flex-col gap-3 h-full">
          {/* Header — avatar + name + status */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--brand-muted)] text-[var(--brand-text)] text-sm font-bold shrink-0">
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground group-hover:text-[var(--brand-text)] transition-colors truncate">
                  {agent.name}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {agent.description}
                </p>
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1 shrink-0">
                <span
                  className={`h-2 w-2 rounded-full ${
                    connected
                      ? "bg-[var(--status-success)] status-dot-pulse"
                      : agent.warnings?.length
                        ? "bg-[var(--status-warning)]"
                        : "bg-[var(--text-tertiary)]"
                  }`}
                />
                {connected ? (
                  <Wifi size={12} className="text-[var(--status-success)]" />
                ) : agent.warnings?.length ? (
                  <AlertTriangle size={12} className="text-[var(--status-warning)]" />
                ) : (
                  <WifiOff size={12} className="text-[var(--text-tertiary)]" />
                )}
              </TooltipTrigger>
              <TooltipContent>
                {connected ? "Connected" : agent.warnings?.[0] || "Disconnected"}
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Signals row */}
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground mt-auto">
            {/* Last activity */}
            <div className="flex items-center gap-1.5">
              <Activity size={11} className="shrink-0 text-[var(--text-tertiary)]" />
              {signals.lastActivityTs != null ? (
                <Tooltip>
                  <TooltipTrigger className="text-left">
                    <span>
                      {signals.conversationsToday > 0
                        ? `${signals.conversationsToday} conversation${signals.conversationsToday === 1 ? "" : "s"} today`
                        : `last ran ${timeAgo(signals.lastActivityTs)}`}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Last activity {fullDateTime(signals.lastActivityTs)}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-[var(--text-tertiary)]">no activity today</span>
              )}
            </div>

            {/* Next scheduled */}
            <div className="flex items-center gap-1.5">
              <CalendarClock size={11} className="shrink-0 text-[var(--text-tertiary)]" />
              {signals.nextRunAt != null ? (
                <Tooltip>
                  <TooltipTrigger className="text-left truncate">
                    <span className="truncate">
                      {signals.nextRunLabel ?? "next run"}{" "}
                      <span className="text-[var(--text-tertiary)]">
                        · {timeAgo(signals.nextRunAt)}
                      </span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{fullDateTime(signals.nextRunAt)}</TooltipContent>
                </Tooltip>
              ) : (
                <span className="text-[var(--text-tertiary)]">nothing scheduled</span>
              )}
            </div>

            {/* Today's spend */}
            <div className="flex items-center gap-1.5">
              <Coins size={11} className="shrink-0 text-[var(--text-tertiary)]" />
              {signals.tokensToday > 0 ? (
                <span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {compactNumber(signals.tokensToday)}
                  </span>{" "}
                  tokens today
                </span>
              ) : (
                <span className="text-[var(--text-tertiary)]">no spend today</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function AgentCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 flex flex-col gap-3">
        <div className="flex items-start gap-2.5">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      </CardContent>
    </Card>
  );
}

const SOURCE_COLOR: Record<string, string> = {
  direct: "text-[var(--status-info)] bg-[var(--status-info-bg)]",
  cron: "text-[var(--chart-4)] bg-[var(--chart-4)]/10",
  heartbeat: "text-[var(--status-warning)] bg-[var(--status-warning-bg)]",
  webhook: "text-[var(--brand-text)] bg-[var(--brand-muted)]",
};
const STATUS_DOT: Record<string, string> = {
  delivered: "bg-[var(--status-success)]",
  suppressed: "bg-[var(--text-tertiary)]",
  error: "bg-[var(--status-error)]",
};

function ActivityRow({ entry }: { entry: FeedEntry }) {
  const sourceColor = SOURCE_COLOR[entry.source] || "text-muted-foreground bg-muted";
  const dotColor = STATUS_DOT[entry.status] || STATUS_DOT.delivered;
  return (
    <tr className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors text-sm">
      <td className="py-3 px-3">
        <Tooltip>
          <TooltipTrigger className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
            {timeAgo(entry.timestamp)}
          </TooltipTrigger>
          <TooltipContent>{fullDateTime(entry.timestamp)}</TooltipContent>
        </Tooltip>
      </td>
      <td className="py-3 px-3">
        {entry.agent_id && (
          <span className="text-xs font-mono text-muted-foreground">{entry.agent_id}</span>
        )}
      </td>
      <td className="py-3 px-3">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${sourceColor}`}>
          {entry.source}
        </span>
      </td>
      <td className="py-3 px-3 max-w-[300px] truncate text-xs text-foreground">
        {entry.input?.replace(/\n/g, " ").trim() || "—"}
      </td>
      <td className="py-3 px-3">
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          <span className="text-xs text-muted-foreground">{entry.status}</span>
        </span>
      </td>
    </tr>
  );
}

function ActivityRowSkeleton() {
  return (
    <tr className="border-b border-[var(--border-subtle)]">
      <td className="py-3 px-3"><Skeleton className="h-3 w-12" /></td>
      <td className="py-3 px-3"><Skeleton className="h-3 w-16" /></td>
      <td className="py-3 px-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
      <td className="py-3 px-3"><Skeleton className="h-3 w-48" /></td>
      <td className="py-3 px-3"><Skeleton className="h-3 w-16" /></td>
    </tr>
  );
}

export default function HomePage() {
  // Bump the feed limit so we can derive per-agent signals client-side.
  const { data: feedData, loading: feedLoading } = useFetch<{
    entries: FeedEntry[];
    counts: FeedCounts;
    tokens: FeedTokens;
  }>(`/api/feed?agent_id=all&limit=500&since=${since}`, POLL_INTERVAL_MS);

  const { data: agentData, loading: agentsLoading } = useFetch<{
    agents: PlatformAgent[];
  }>("/api/platform/agents", POLL_INTERVAL_MS);

  const { data: cronData } = useFetch<{ crons: CronJob[] }>("/api/crons", POLL_INTERVAL_MS);

  const entries = feedData?.entries ?? [];
  const agents = agentData?.agents ?? [];
  const crons = cronData?.crons ?? [];

  const signalsByAgent = useMemo(() => {
    const map: Record<string, AgentSignals> = {};
    for (const a of agents) {
      map[a.id] = deriveSignals(a.id, entries, crons);
    }
    return map;
  }, [agents, entries, crons]);

  // Top-10 recent activity for the table at the bottom
  const recentEntries = entries.slice(0, 10);

  const feedLoadingFirst = feedLoading && !feedData;
  const agentsLoadingFirst = agentsLoading && !agentData;

  return (
    <div className="space-y-8">
      {/* Page title — display weight, with the count as a numeric anchor */}
      <div>
        <h1 className="text-display">Home</h1>
        {agents.length > 0 ? (
          <p className="mt-2 flex items-baseline gap-2">
            <span className="num-large text-foreground">
              {agents.filter((a) => a.connected && a.enabled).length}
            </span>
            <span className="text-body text-muted-foreground">
              of {agents.length} agents online
            </span>
            <span className="text-kicker text-muted-foreground/80 ml-1">
              · all systems normal
            </span>
          </p>
        ) : (
          <p className="text-body text-muted-foreground mt-2">
            Your fleet is empty
          </p>
        )}
      </div>

      {/* Agent cards — the primary entry point */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-title">Agents</h2>
          <Link
            href="/agents"
            className="text-[13px] font-medium text-[var(--brand-text)] hover:underline inline-flex items-center gap-1"
          >
            View all <ArrowRight size={13} />
          </Link>
        </div>
        {agentsLoadingFirst ? (
          <div className="grid grid-cols-3 gap-4">
            <AgentCardSkeleton />
            <AgentCardSkeleton />
            <AgentCardSkeleton />
          </div>
        ) : agents.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No agents yet"
            description="Create your first AI agent with a custom persona, tools, and Telegram connection."
            action={{ label: "Create agent", href: "/agents/new" }}
          />
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                signals={signalsByAgent[agent.id] ?? {
                  lastActivityTs: null,
                  conversationsToday: 0,
                  tokensToday: 0,
                  nextRunAt: null,
                  nextRunLabel: null,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-title">Recent Activity</h2>
          <Link
            href="/feed"
            className="text-[13px] font-medium text-[var(--brand-text)] hover:underline inline-flex items-center gap-1"
          >
            View all <ArrowRight size={13} />
          </Link>
        </div>
        <Card>
          <div className="overflow-hidden rounded-lg">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Time</th>
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Agent</th>
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Source</th>
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Input</th>
                  <th className="text-left py-2.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {feedLoadingFirst ? (
                  Array.from({ length: 5 }).map((_, i) => <ActivityRowSkeleton key={i} />)
                ) : recentEntries.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState
                        icon={Activity}
                        title="No activity today"
                        description="Agent messages, schedule runs, and heartbeats will appear here."
                      />
                    </td>
                  </tr>
                ) : (
                  recentEntries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
