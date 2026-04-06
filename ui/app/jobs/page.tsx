"use client";

import { useFetch } from "@/lib/use-api";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import {
  ExternalLink,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  MoreHorizontal,
  Eye,
  RotateCcw,
  Inbox,
} from "lucide-react";
import { useState, useMemo } from "react";
import type { Job, ParsedJobInput, ParsedJobResult } from "@/lib/types";

/* ---------- Status config ---------- */

type JobStatus = Job["status"];

const STATUS_CONFIG: Record<JobStatus, { label: string; className: string; icon: React.ReactNode }> = {
  queued: {
    label: "Queued",
    className: "bg-muted text-muted-foreground",
    icon: <Clock size={10} />,
  },
  running: {
    label: "Running",
    className: "bg-[var(--status-info-bg)] text-[var(--status-info)]",
    icon: <Loader2 size={10} className="animate-spin" />,
  },
  completed: {
    label: "Completed",
    className: "bg-[var(--status-success-bg)] text-[var(--status-success)]",
    icon: <CheckCircle2 size={10} />,
  },
  failed: {
    label: "Failed",
    className: "bg-[var(--status-error-bg)] text-[var(--status-error)]",
    icon: <XCircle size={10} />,
  },
};

/* ---------- Parsers ---------- */

function parseInput(raw: string): ParsedJobInput {
  try { return JSON.parse(raw); } catch { return {}; }
}

function parseResult(raw?: string | null): ParsedJobResult | null {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/* ---------- Formatters ---------- */

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatAbsolute(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function extractTitle(input: ParsedJobInput, type: string): string {
  if (input.label) return input.label;
  if (input._github) return `#${input._github.issueNumber}: ${input._github.issueTitle}`;
  if (input.task) {
    const first = input.task.split("\n")[0].slice(0, 80);
    return first || type;
  }
  return type;
}

function extractLink(input: ParsedJobInput, result: ParsedJobResult | null): { url: string; label: string } | null {
  if (result?.output) {
    const prMatch = result.output.match(/(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/);
    if (prMatch) return { url: prMatch[1], label: "PR" };
  }
  const resultUrl = result?.result || result?.statusResponse?.output?.result;
  if (resultUrl && typeof resultUrl === "string" && resultUrl.startsWith("http")) {
    return { url: resultUrl, label: "result" };
  }
  return null;
}

function getDuration(job: Job, result: ParsedJobResult | null): string {
  if (result?.durationMs) return formatDuration(result.durationMs);
  if (job.started_at && job.completed_at) return formatDuration(job.completed_at - job.started_at);
  if (job.started_at) return formatDuration(Date.now() - job.started_at);
  return "-";
}

/* ---------- Filter types ---------- */

type StatusFilter = "all" | JobStatus;

/* ---------- Loading skeleton ---------- */

function TableSkeleton() {
  return (
    <div className="space-y-0">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
          <Skeleton className="h-2 w-2 rounded-full" />
          <Skeleton className="h-3 w-[280px]" />
          <Skeleton className="h-3 w-[60px] ml-auto" />
          <Skeleton className="h-5 w-[72px] rounded-full" />
          <Skeleton className="h-3 w-[40px]" />
          <Skeleton className="h-3 w-[48px]" />
        </div>
      ))}
    </div>
  );
}

/* ---------- Detail sheet content ---------- */

function JobDetail({ job }: { job: Job }) {
  const input = parseInput(job.input);
  const result = parseResult(job.result);
  const link = extractLink(input, result);
  const cfg = STATUS_CONFIG[job.status];

  return (
    <div className="space-y-6 px-4 pb-6 overflow-y-auto">
      {/* Status + type */}
      <div className="flex items-center gap-2">
        <Badge className={`border-0 ${cfg.className}`}>
          <span className="flex items-center gap-1">{cfg.icon} {cfg.label}</span>
        </Badge>
        <Badge variant="outline" className="text-[10px]">{job.type}</Badge>
        {job.platform && (
          <Badge variant="outline" className="text-[10px]">{job.platform}</Badge>
        )}
      </div>

      {/* GitHub context */}
      {input._github && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">GitHub</p>
          <div className="text-xs space-y-0.5">
            <p>
              <span className="text-muted-foreground">Repo: </span>
              <a
                href={`https://github.com/${input._github.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:underline"
              >
                {input._github.repo}
              </a>
            </p>
            <p>
              <span className="text-muted-foreground">Branch: </span>
              <span>{input._github.branch}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Issue: </span>
              <a
                href={input._github.issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground hover:underline"
              >
                #{input._github.issueNumber} — {input._github.issueTitle}
              </a>
            </p>
          </div>
        </div>
      )}

      {/* Input / prompt */}
      {(input.task || input.submitBody?.input?.prompt) && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Input</p>
          <pre className="text-[11px] text-muted-foreground bg-background rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
            {input.task || input.submitBody?.input?.prompt}
          </pre>
        </div>
      )}

      {/* Error */}
      {job.error && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-destructive uppercase tracking-wider">Error</p>
          <pre className="text-[11px] text-destructive bg-[var(--status-error-bg)] rounded p-2 overflow-x-auto max-h-48 whitespace-pre-wrap">
            {job.error}
          </pre>
        </div>
      )}

      {/* Result output */}
      {result?.output && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Output</p>
          <pre className="text-[10px] text-muted-foreground bg-background rounded p-2 overflow-x-auto max-h-64 whitespace-pre-wrap">
            {result.output}
          </pre>
        </div>
      )}

      {/* Result link */}
      {link && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Link</p>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-foreground hover:underline break-all flex items-center gap-1"
          >
            <ExternalLink size={10} />
            {link.url}
          </a>
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-1">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Metadata</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">ID</span>
          <span className="font-mono text-[10px]">{job.id}</span>

          <span className="text-muted-foreground">Created</span>
          <span>{formatAbsolute(job.created_at)}</span>

          {job.started_at && (
            <>
              <span className="text-muted-foreground">Started</span>
              <span>{formatAbsolute(job.started_at)}</span>
            </>
          )}
          {job.completed_at && (
            <>
              <span className="text-muted-foreground">Completed</span>
              <span>{formatAbsolute(job.completed_at)}</span>
            </>
          )}

          <span className="text-muted-foreground">Duration</span>
          <span>{getDuration(job, result)}</span>

          <span className="text-muted-foreground">Attempt</span>
          <span>{job.attempt} / {job.max_attempts}</span>

          <span className="text-muted-foreground">Timeout</span>
          <span>{formatDuration(job.timeout_ms)}</span>

          {input.agent && (
            <>
              <span className="text-muted-foreground">Agent</span>
              <span>{input.agent}</span>
            </>
          )}

          {result?.durationMs && (
            <>
              <span className="text-muted-foreground">Agent duration</span>
              <span>{formatDuration(result.durationMs)}</span>
            </>
          )}

          {result?.statusResponse?.executionTime && (
            <>
              <span className="text-muted-foreground">Execution</span>
              <span>{formatDuration(result.statusResponse.executionTime)}</span>
            </>
          )}
          {result?.statusResponse?.delayTime && (
            <>
              <span className="text-muted-foreground">Queue wait</span>
              <span>{formatDuration(result.statusResponse.delayTime)}</span>
            </>
          )}
          {result?.statusResponse?.output?.cost != null && (
            <>
              <span className="text-muted-foreground">Cost</span>
              <span>${result.statusResponse.output.cost.toFixed(2)}</span>
            </>
          )}
          {result?.statusResponse?.workerId && (
            <>
              <span className="text-muted-foreground">Worker</span>
              <span className="font-mono text-[10px]">{result.statusResponse.workerId}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

export default function JobsPage() {
  const { data, loading } = useFetch<{
    jobs: Job[];
    counts: { queued: number; running: number };
  }>("/api/jobs", 3000);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  /* ---------- Counts for tabs ---------- */
  const statusCounts = useMemo(() => {
    const jobs = data?.jobs ?? [];
    return {
      all: jobs.length,
      running: jobs.filter((j) => j.status === "running").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
    };
  }, [data?.jobs]);

  const filteredJobs = useMemo(() => {
    if (!data?.jobs) return [];
    let jobs = data.jobs;
    if (statusFilter !== "all") {
      jobs = jobs.filter((j) => j.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      jobs = jobs.filter((j) => {
        const input = parseInput(j.input);
        const title = extractTitle(input, j.type).toLowerCase();
        return (
          title.includes(q) ||
          j.type.toLowerCase().includes(q) ||
          j.id.toLowerCase().includes(q) ||
          (input._github?.repo.toLowerCase().includes(q) ?? false)
        );
      });
    }
    return jobs;
  }, [data?.jobs, statusFilter, search]);

  return (
    <TooltipProvider>
      <div className="p-6">
        <PageHeader title="Jobs" description="Background job execution history" />

        {/* Filter bar */}
        <div className="flex items-center gap-3 mb-4">
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <TabsList className="h-9">
              <TabsTrigger value="all">All <span className="ml-1.5 text-muted-foreground">{statusCounts.all}</span></TabsTrigger>
              <TabsTrigger value="running">Running <span className="ml-1.5 text-muted-foreground">{statusCounts.running}</span></TabsTrigger>
              <TabsTrigger value="completed">Completed <span className="ml-1.5 text-muted-foreground">{statusCounts.completed}</span></TabsTrigger>
              <TabsTrigger value="failed">Failed <span className="ml-1.5 text-muted-foreground">{statusCounts.failed}</span></TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search jobs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-56 rounded-md border border-border bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Loading */}
        {loading && !data && <TableSkeleton />}

        {/* Empty state */}
        {data && filteredJobs.length === 0 && (
          <EmptyState
            icon={Inbox}
            title={search || statusFilter !== "all" ? "No matching jobs" : "No jobs yet"}
            description={
              search || statusFilter !== "all"
                ? "Try adjusting your filters or search query."
                : "Jobs will appear here when background tasks are executed."
            }
            action={
              (search || statusFilter !== "all")
                ? {
                    label: "Clear filters",
                    onClick: () => {
                      setSearch("");
                      setStatusFilter("all");
                    },
                  }
                : undefined
            }
          />
        )}

        {/* Table */}
        {data && filteredJobs.length > 0 && (
          <div className="rounded-xl border border-border/60 bg-card/70 overflow-hidden">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                <tr className="text-[10px] text-muted-foreground border-b border-border bg-muted/30">
                  <th className="text-left px-3 py-2 font-medium">Task</th>
                  <th className="text-left px-2 py-2 font-medium w-20">Type</th>
                  <th className="text-left px-2 py-2 font-medium w-24">Status</th>
                  <th className="text-right px-2 py-2 font-medium w-16">Time</th>
                  <th className="text-right px-2 py-2 font-medium w-20">When</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => {
                  const input = parseInput(job.input);
                  const result = parseResult(job.result);
                  const title = extractTitle(input, job.type);
                  const link = extractLink(input, result);
                  const dur = getDuration(job, result);
                  const cfg = STATUS_CONFIG[job.status];

                  return (
                    <tr
                      key={job.id}
                      onClick={() => setSelectedJob(job)}
                      className={cn(
                        "border-b border-border/30 text-xs cursor-pointer transition-colors hover:bg-accent/40",
                        job.status === "failed" && "bg-[var(--status-error-bg)] hover:bg-[var(--status-error-bg)]"
                      )}
                    >
                      {/* Task with status dot */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <span className={cn("h-2 w-2 shrink-0 rounded-full",
                            job.status === "completed" && "bg-[var(--status-success)]",
                            job.status === "failed" && "bg-[var(--status-error)]",
                            job.status === "running" && "bg-[var(--status-warning)] animate-pulse",
                            job.status === "queued" && "bg-muted-foreground"
                          )} />
                          <span className="truncate text-sm text-foreground max-w-[400px]">{title}</span>
                          {input._github && (
                            <Badge variant="outline" className="text-[9px] text-muted-foreground border-border shrink-0">
                              {input._github.repo.split("/")[1]}
                            </Badge>
                          )}
                          {link && (
                            <a
                              href={link.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                            >
                              <ExternalLink size={10} />
                            </a>
                          )}
                        </div>
                      </td>

                      {/* Type */}
                      <td className="px-2 py-2.5 text-muted-foreground">{job.type}</td>

                      {/* Status badge */}
                      <td className="px-2 py-2.5">
                        <Badge className={`border-0 text-[10px] ${cfg.className}`}>
                          <span className="flex items-center gap-1">{cfg.icon} {cfg.label}</span>
                        </Badge>
                      </td>

                      {/* Duration */}
                      <td className="px-2 py-2.5 text-right font-mono text-[12px] tabular-nums text-muted-foreground">{dur}</td>

                      {/* When */}
                      <td className="px-2 py-2.5 text-right">
                        <Tooltip>
                          <TooltipTrigger render={<span className="font-mono text-[12px] tabular-nums text-muted-foreground cursor-default" />}>
                            {timeAgo(job.created_at)}
                          </TooltipTrigger>
                          <TooltipContent>
                            {formatAbsolute(job.created_at)}
                          </TooltipContent>
                        </Tooltip>
                      </td>

                      {/* Actions */}
                      <td className="px-2 py-2.5 text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                                onClick={(e) => e.stopPropagation()}
                              />
                            }
                          >
                            <MoreHorizontal size={14} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" sideOffset={4}>
                            <DropdownMenuItem onClick={() => setSelectedJob(job)}>
                              <Eye size={14} />
                              View Details
                            </DropdownMenuItem>
                            {job.status === "failed" && (
                              <DropdownMenuItem
                                onClick={() => {
                                  fetch(`/api/jobs/${job.id}/retry`, { method: "POST" });
                                }}
                              >
                                <RotateCcw size={14} />
                                Retry
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail sheet */}
      <Sheet open={!!selectedJob} onOpenChange={(open) => { if (!open) setSelectedJob(null); }}>
        <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {selectedJob ? extractTitle(parseInput(selectedJob.input), selectedJob.type) : "Job Details"}
            </SheetTitle>
            <SheetDescription>
              {selectedJob?.id ? `ID: ${selectedJob.id.slice(0, 12)}...` : ""}
            </SheetDescription>
          </SheetHeader>
          {selectedJob && <JobDetail job={selectedJob} />}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
