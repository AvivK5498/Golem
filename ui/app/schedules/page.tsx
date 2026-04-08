"use client";

import { useFetch } from "@/lib/use-api";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  Activity,
  Clock,
  Edit,
  MoreHorizontal,
  Pause,
  Play,
  PlusCircle,
  Timer,
  Trash2,
  Zap,
} from "lucide-react";
import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type { CronJob } from "@/lib/types";
import { describeCron } from "@/components/cron-builder";

const KIND_STYLE: Record<string, string> = {
  reminder: "bg-[var(--status-info-bg)] text-[var(--status-info)]",
  agent_turn: "bg-[var(--chart-4)]/10 text-[var(--chart-4)]",
  command: "bg-[var(--status-warning-bg)] text-[var(--status-warning)]",
};

function relativeTime(ts: number | null, direction: "past" | "future"): string {
  if (!ts) return "\u2014";
  const diff = direction === "past" ? Date.now() - ts : ts - Date.now();
  if (diff < 0) return direction === "past" ? "just now" : "< 1m";
  if (diff < 60_000) return direction === "past" ? "just now" : "< 1m";
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return direction === "past" ? `${m}m ago` : `in ${m}m`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return direction === "past" ? `${h}h ago` : `in ${h}h`;
  }
  const d = Math.floor(diff / 86_400_000);
  return direction === "past" ? `${d}d ago` : `in ${d}d`;
}

/**
 * Format the next-run column with three states:
 * - imminent (within next minute, including up to 1m past): "< 1m"
 * - late (more than 1m past schedule): "5m late", "2h late" — warning style
 * - upcoming: "in 5m", "in 23h" — normal
 */
function nextRunDisplay(ts: number | null): { text: string; late: boolean } {
  if (!ts) return { text: "\u2014", late: false };
  const diff = ts - Date.now();
  // Within 1 minute either side of now → imminent
  if (Math.abs(diff) < 60_000) return { text: "< 1m", late: false };
  // Past schedule by more than 1 minute → late
  if (diff < 0) {
    const lateMs = -diff;
    if (lateMs < 3_600_000) return { text: `${Math.floor(lateMs / 60_000)}m late`, late: true };
    if (lateMs < 86_400_000) return { text: `${Math.floor(lateMs / 3_600_000)}h late`, late: true };
    return { text: `${Math.floor(lateMs / 86_400_000)}d late`, late: true };
  }
  // Future
  if (diff < 3_600_000) return { text: `in ${Math.floor(diff / 60_000)}m`, late: false };
  if (diff < 86_400_000) return { text: `in ${Math.floor(diff / 3_600_000)}h`, late: false };
  return { text: `in ${Math.floor(diff / 86_400_000)}d`, late: false };
}

function formatSchedule(cron: CronJob): string {
  return describeCron(cron.cron_expr);
}

function displayName(task: CronJob): string {
  if (task.name) return task.name;
  if (task.description.length > 60) return task.description.slice(0, 60) + "...";
  return task.description;
}

interface PlatformAgent {
  id: string;
  name: string;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <div className="rounded-xl border border-border/60 bg-card/70 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-3 border-b border-border/30"
          >
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-8 rounded-full" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20 ml-auto" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-6" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SchedulesPage() {
  const [agentFilter, setAgentFilter] = useState("all");
  const agentParam = agentFilter === "all" ? "" : `?agent_id=${agentFilter}`;
  const { data, loading, refetch } = useFetch<{ crons: CronJob[] }>(
    `/api/crons${agentParam}`,
    5000,
  );
  const { data: agentList } = useFetch<{ agents: PlatformAgent[] }>(
    "/api/platform/agents",
  );
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null);

  const togglePause = useCallback(
    async (task: CronJob) => {
      setBusy((prev) => new Set(prev).add(task.id));
      try {
        await fetch(`/api/crons/${task.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paused: !task.paused }),
        });
        refetch();
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    },
    [refetch],
  );

  const runNow = useCallback(
    async (task: CronJob) => {
      setBusy((prev) => new Set(prev).add(task.id));
      try {
        await fetch(`/api/crons/${task.id}/run`, { method: "POST" });
        refetch();
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
      }
    },
    [refetch],
  );

  const deleteCron = useCallback(
    async (id: number) => {
      setBusy((prev) => new Set(prev).add(id));
      try {
        await fetch(`/api/crons/${id}`, { method: "DELETE" });
        setDeleteTarget(null);
        refetch();
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refetch],
  );

  const tasks = data?.crons ?? [];
  const activeCount = tasks.filter((t) => !t.paused).length;
  const pausedCount = tasks.filter((t) => t.paused).length;

  const nextRunLabel = useMemo(() => {
    const activeTasks = tasks.filter((t) => !t.paused && t.next_run_at);
    if (activeTasks.length === 0) return "\u2014";
    const nearest = activeTasks.reduce((min, t) =>
      t.next_run_at! < min.next_run_at! ? t : min,
    );
    return nextRunDisplay(nearest.next_run_at).text;
  }, [tasks]);

  const lastActivityLabel = useMemo(() => {
    const withLastRun = tasks.filter((t) => t.last_run_at);
    if (withLastRun.length === 0) return "\u2014";
    const mostRecent = withLastRun.reduce((max, t) =>
      t.last_run_at! > max.last_run_at! ? t : max,
    );
    return relativeTime(mostRecent.last_run_at, "past");
  }, [tasks]);

  return (
    <div className="p-6">
      <PageHeader
        title="Schedules"
        description="One-time and recurring scheduled actions"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="text-xs bg-card border border-border rounded-md px-2 py-1.5 text-muted-foreground focus:outline-none focus:border-muted-foreground"
            >
              <option value="all">All agents</option>
              {agentList?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {data && (
              <Badge
                variant="outline"
                className="text-[10px] text-muted-foreground border-border"
              >
                {tasks.length} total
              </Badge>
            )}
            <Link href="/schedules/new" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
              <PlusCircle className="h-4 w-4" />
              New Schedule
            </Link>
          </div>
        }
      />

      {loading && !data && <LoadingSkeleton />}

      {data && tasks.length === 0 && (
        <EmptyState
          icon={Clock}
          title="No schedules"
          description="Schedule recurring or one-time actions for your agents"
          action={{ label: "Create your first schedule", href: "/schedules/new" }}
        />
      )}

      {data && tasks.length > 0 && (
        <div className="space-y-4">
          {/* Summary stat cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="rounded-xl border border-border/60 bg-card/70" size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs">Active Schedules</CardDescription>
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <CardTitle className="text-2xl">{activeCount}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="rounded-xl border border-border/60 bg-card/70" size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs">Next Run</CardDescription>
                  <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <CardTitle className="text-2xl">{nextRunLabel}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="rounded-xl border border-border/60 bg-card/70" size="sm">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs">Last Activity</CardDescription>
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <CardTitle className="text-2xl">{lastActivityLabel}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border/60 bg-card/70 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-[11px] text-muted-foreground border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium w-20">Agent</th>
                  <th className="text-left px-4 py-2 font-medium w-36">
                    Schedule
                  </th>
                  <th className="text-left px-4 py-2 font-medium w-20">
                    Status
                  </th>
                  <th className="text-left px-4 py-2 font-medium w-24">
                    Next Run
                  </th>
                  <th className="text-left px-4 py-2 font-medium w-24">
                    Last Run
                  </th>
                  <th className="text-left px-4 py-2 font-medium w-20">
                    Outcome
                  </th>
                  <th className="w-10 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const isPaused = !!task.paused;
                  const isBusy = busy.has(task.id);

                  return (
                    <tr
                      key={task.id}
                      className="border-b border-border/30 hover:bg-accent/40 text-xs"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/schedules/${task.id}`}
                          className={`hover:underline underline-offset-2 ${isPaused ? "text-muted-foreground" : "text-foreground"}`}
                        >
                          {displayName(task)}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono text-[11px]">
                        {task.agent_id || "\u2014"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono text-[11px]">
                        {formatSchedule(task)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Switch
                            size="sm"
                            checked={!isPaused}
                            disabled={isBusy}
                            onCheckedChange={() => togglePause(task)}
                          />
                          <span
                            className={`text-[10px] ${
                              isPaused
                                ? "text-muted-foreground"
                                : "text-[var(--status-success)]"
                            }`}
                          >
                            {isPaused ? "off" : "on"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {isPaused ? (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        ) : (() => {
                          const { text, late } = nextRunDisplay(task.next_run_at);
                          return (
                            <span className={late ? "text-[var(--status-warning)]" : "text-muted-foreground"}>
                              {text}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                        {relativeTime(task.last_run_at, "past")}
                      </td>
                      <td className="px-4 py-2.5">
                        {task.last_run_at ? (
                          <Badge className="text-[10px] border-0 bg-[var(--status-success-bg)] text-[var(--status-success)]">
                            success
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">{"\u2014"}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            disabled={isBusy}
                            className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-30"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="bottom">
                            <DropdownMenuItem
                              onClick={() =>
                                (window.location.href = `/schedules/${task.id}`)
                              }
                            >
                              <Edit className="h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => runNow(task)}>
                              <Play className="h-4 w-4" />
                              Run Now
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => togglePause(task)}>
                              {isPaused ? (
                                <>
                                  <Play className="h-4 w-4" />
                                  Resume
                                </>
                              ) : (
                                <>
                                  <Pause className="h-4 w-4" />
                                  Pause
                                </>
                              )}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeleteTarget(task)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;
              {deleteTarget ? displayName(deleteTarget) : ""}
              &rdquo;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleteTarget && deleteCron(deleteTarget.id)}
              disabled={deleteTarget ? busy.has(deleteTarget.id) : false}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
