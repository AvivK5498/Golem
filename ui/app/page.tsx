"use client";

import { useFetch } from "@/lib/use-api";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import { timeAgo, compactNumber, todayMidnight, fullDateTime } from "@/lib/format";
import { AnimatedNumber } from "@/components/motion-primitives/animated-number";
import { AnimatedGroup } from "@/components/motion-primitives/animated-group";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  Clock,
  Heart,
  MessageSquare,
  Coins,
  AlertTriangle,
  Wifi,
  WifiOff,
  Webhook,
} from "lucide-react";
import type { FeedEntry, FeedCounts, FeedTokens, PlatformAgent } from "@/lib/types";

const since = todayMidnight();

// ── Source icon mapping ────────────────────────────────
const SOURCE_ICON: Record<string, typeof Activity> = {
  direct: MessageSquare,
  cron: Clock,
  heartbeat: Heart,
  webhook: Webhook,
};

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

// ── Metric Card ────────────────────────────────────────
function MetricCard({
  label,
  value,
  icon: Icon,
  loading,
  accent,
}: {
  label: string;
  value: number;
  icon: typeof Activity;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className={`text-[28px] font-semibold tracking-tight font-mono ${accent ? "text-[var(--brand-text)]" : "text-foreground"}`}>
                <AnimatedNumber value={value} springOptions={{ bounce: 0, duration: 800 }} />
              </div>
            )}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Icon size={20} className="text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Agent Status Card ──────────────────────────────────
function AgentCard({ agent }: { agent: PlatformAgent }) {
  const connected = agent.connected && agent.enabled;
  return (
    <Link href={`/agents/${agent.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer group">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--brand-muted)] text-[var(--brand-text)] text-sm font-bold shrink-0">
                {agent.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground group-hover:text-[var(--brand-text)] transition-colors">
                  {agent.name}
                </p>
                <p className="text-xs text-muted-foreground line-clamp-1">
                  {agent.description}
                </p>
              </div>
            </div>
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${connected ? "bg-[var(--status-success)] status-dot-pulse" : agent.warnings?.length ? "bg-[var(--status-warning)]" : "bg-[var(--text-tertiary)]"}`} />
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
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono text-[11px]">{agent.model.split("/").pop()}</span>
            <span className="font-mono tabular-nums">{agent.toolCount} tools</span>
            <span className="font-mono tabular-nums">{agent.cronCount} crons</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ── Compact Activity Row ───────────────────────────────
function ActivityRow({ entry }: { entry: FeedEntry }) {
  const SourceIcon = SOURCE_ICON[entry.source] || Activity;
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
          <SourceIcon size={11} />
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

// ── Skeleton Loaders ───────────────────────────────────
function MetricSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-16" />
          </div>
          <Skeleton className="h-10 w-10 rounded-lg" />
        </div>
      </CardContent>
    </Card>
  );
}

function AgentCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-2.5 mb-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-12" />
        </div>
      </CardContent>
    </Card>
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

// ── Home Page ──────────────────────────────────────────
export default function HomePage() {
  const { data: feedData, loading: feedLoading } = useFetch<{
    entries: FeedEntry[];
    counts: FeedCounts;
    tokens: FeedTokens;
  }>(`/api/feed?agent_id=all&limit=10&since=${since}`, POLL_INTERVAL_MS);

  const { data: agentData, loading: agentsLoading } = useFetch<{
    agents: PlatformAgent[];
  }>("/api/platform/agents", POLL_INTERVAL_MS);

  const counts = feedData?.counts ?? { total: 0, delivered: 0, suppressed: 0, error: 0 };
  const tokens = feedData?.tokens ?? { totalIn: 0, totalOut: 0, count: 0 };
  const entries = feedData?.entries ?? [];
  const agents = agentData?.agents ?? [];
  const connectedCount = agents.filter((a) => a.connected && a.enabled).length;

  const loading = feedLoading && !feedData;
  const agentsLoadingFirst = agentsLoading && !agentData;

  return (
    <div className="space-y-8">
      {/* Page title */}
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Home</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform overview for today</p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-4">
        {loading ? (
          <>
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </>
        ) : (
          <>
            <MetricCard label="Messages today" value={counts.total} icon={MessageSquare} loading={false} />
            <MetricCard label="Tokens today" value={tokens.totalIn + tokens.totalOut} icon={Coins} loading={false} />
            <MetricCard label="Errors today" value={counts.error} icon={AlertTriangle} loading={false} accent={counts.error > 0} />
            <MetricCard label="Agents online" value={connectedCount} icon={Bot} loading={false} accent />
          </>
        )}
      </div>

      {/* Agent cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Agents</h2>
          <Link href="/agents" className="text-[13px] font-medium text-[var(--brand-text)] hover:underline inline-flex items-center gap-1">
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
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Recent Activity</h2>
          <Link href="/feed" className="text-[13px] font-medium text-[var(--brand-text)] hover:underline inline-flex items-center gap-1">
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
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => <ActivityRowSkeleton key={i} />)
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState
                        icon={Activity}
                        title="No activity today"
                        description="Agent messages, cron runs, and heartbeats will appear here."
                      />
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
