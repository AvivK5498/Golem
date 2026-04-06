"use client";

import { useFetch } from "@/lib/use-api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Activity, Search, ChevronDown, ChevronRight, PanelRight } from "lucide-react";
import { Fragment, useState, useMemo } from "react";
import type { FeedEntry, FeedCounts } from "@/lib/types";

type StatusFilter = "all" | "delivered" | "suppressed" | "error";
type SourceFilter = "all" | "direct" | "cron" | "heartbeat";

const STATUS_STYLE: Record<string, string> = {
  delivered: "bg-[var(--status-success-bg)] text-[var(--status-success)]",
  suppressed: "bg-accent text-muted-foreground",
  error: "bg-[var(--status-error-bg)] text-[var(--status-error)]",
};

const SOURCE_STYLE: Record<string, string> = {
  direct: "bg-[var(--status-info-bg)] text-[var(--status-info)]",
  cron: "bg-[var(--chart-4)]/10 text-[var(--chart-4)]",
  heartbeat: "bg-[var(--status-warning-bg)] text-[var(--status-warning)]",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTokens(tokIn: number | null, tokOut: number | null): string {
  if (!tokIn && !tokOut) return "—";
  const inK = tokIn ? `${(tokIn / 1000).toFixed(1)}k` : "—";
  const outK = tokOut ? `${(tokOut / 1000).toFixed(1)}k` : "—";
  return `${inK}/${outK}`;
}

function formatLatency(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncateText(text: string | null, max = 80): string {
  if (!text) return "—";
  const clean = text.replace(/\n/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

interface PlatformAgent {
  id: string;
  name: string;
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-border/30">
          <td className="px-2 py-2"><Skeleton className="h-3 w-3" /></td>
          <td className="px-2 py-2"><Skeleton className="h-4 w-12" /></td>
          <td className="px-2 py-2"><Skeleton className="h-4 w-14" /></td>
          <td className="px-2 py-2"><Skeleton className="h-4 w-40" /></td>
          <td className="px-2 py-2"><Skeleton className="h-4 w-36" /></td>
          <td className="px-2 py-2"><Skeleton className="h-4 w-16" /></td>
          <td className="px-2 py-2"><Skeleton className="h-4 w-16" /></td>
          <td className="px-2 py-2"><Skeleton className="h-4 w-16 ml-auto" /></td>
          <td className="px-2 py-2"><Skeleton className="h-4 w-12 ml-auto" /></td>
        </tr>
      ))}
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-border/30">
      <span className="text-muted-foreground text-xs shrink-0">{label}</span>
      <span className="text-xs text-foreground text-right break-all">{value}</span>
    </div>
  );
}

function ExpandedRow({ entry, onOpenSheet }: { entry: FeedEntry; onOpenSheet: (e: FeedEntry) => void }) {
  return (
    <tr className="border-b border-border/30 bg-muted/20">
      <td colSpan={9} className="px-3 py-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border/50 bg-background/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Input</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-foreground/90 max-h-64 overflow-y-auto">
              {entry.input || "—"}
            </pre>
          </div>
          <div className="rounded-lg border border-border/50 bg-background/60 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Output</p>
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-foreground/90 max-h-64 overflow-y-auto">
              {entry.output || "—"}
            </pre>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
          {entry.agent_id && <span><span className="text-muted-foreground/60">Agent:</span> {entry.agent_id}</span>}
          {entry.platform && <span><span className="text-muted-foreground/60">Platform:</span> {entry.platform}</span>}
          {(entry.tokens_in || entry.tokens_out) && (
            <span><span className="text-muted-foreground/60">Tokens:</span> {formatTokens(entry.tokens_in, entry.tokens_out)}</span>
          )}
          {entry.latency_ms && (
            <span><span className="text-muted-foreground/60">Latency:</span> {formatLatency(entry.latency_ms)}</span>
          )}
          {entry.source_name && <span><span className="text-muted-foreground/60">Source:</span> {entry.source_name}</span>}
          <button
            onClick={(e) => { e.stopPropagation(); onOpenSheet(entry); }}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
          >
            <PanelRight className="h-3 w-3" />
            Open in panel
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function FeedPage() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FeedEntry | null>(null);

  const agentParam = agentFilter === "all" ? "" : `&agent_id=${agentFilter}`;
  const { data, loading } = useFetch<{ entries: FeedEntry[]; counts: FeedCounts }>(
    `/api/feed?limit=100&status=${filter}${agentParam}`,
    3000,
  );
  const { data: agentList } = useFetch<{ agents: PlatformAgent[] }>(
    "/api/platform/agents",
  );

  const counts = data?.counts ?? { total: 0, delivered: 0, suppressed: 0, error: 0 };

  const entries = useMemo(() => {
    let result = data?.entries ?? [];
    if (sourceFilter !== "all") {
      result = result.filter((e) => e.source === sourceFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (e) =>
          e.input?.toLowerCase().includes(q) ||
          e.output?.toLowerCase().includes(q) ||
          e.agent_id?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [data?.entries, sourceFilter, searchQuery]);

  const toggleFilter = (status: StatusFilter) => {
    setFilter((prev) => (prev === status ? "all" : status));
  };

  const handleRowClick = (entry: FeedEntry) => {
    setExpandedId((prev) => (prev === entry.id ? null : entry.id));
  };

  return (
    <>
      <PageHeader
        title="Feed"
        description="Recent agent activity"
        actions={
          <>
            <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
              {counts.total} total
            </Badge>
            {counts.delivered > 0 && (
              <button onClick={() => toggleFilter("delivered")}>
                <Badge className={`text-[10px] border-0 cursor-pointer ${filter === "delivered" ? "ring-1 ring-[var(--status-success)]/50" : ""} ${STATUS_STYLE.delivered}`}>
                  {counts.delivered} delivered
                </Badge>
              </button>
            )}
            {counts.suppressed > 0 && (
              <button onClick={() => toggleFilter("suppressed")}>
                <Badge className={`text-[10px] border-0 cursor-pointer ${filter === "suppressed" ? "ring-1 ring-muted-foreground/50" : ""} ${STATUS_STYLE.suppressed}`}>
                  {counts.suppressed} suppressed
                </Badge>
              </button>
            )}
            {counts.error > 0 && (
              <button onClick={() => toggleFilter("error")}>
                <Badge className={`text-[10px] border-0 cursor-pointer ${filter === "error" ? "ring-1 ring-[var(--status-error)]/50" : ""} ${STATUS_STYLE.error}`}>
                  {counts.error} errors
                </Badge>
              </button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mt-3">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9 h-9 text-xs"
                placeholder="Search input, output, agent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="text-xs bg-card border border-border rounded px-2 py-1.5 text-muted-foreground focus:outline-none focus:border-muted-foreground"
            >
              <option value="all">All agents</option>
              {agentList?.agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
              className="text-xs bg-card border border-border rounded px-2 py-1.5 text-muted-foreground focus:outline-none focus:border-muted-foreground"
            >
              <option value="all">All sources</option>
              <option value="direct">Direct</option>
              <option value="cron">Cron</option>
              <option value="heartbeat">Heartbeat</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/60">
              {entries.length} shown
            </Badge>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors underline"
              >
                Clear search
              </button>
            )}
          </div>
        </div>
      </PageHeader>

      <div className="flex-1 overflow-y-auto rounded-xl border border-border/60 bg-card/70 overflow-hidden">
        {loading && !data ? (
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="text-[10px] text-muted-foreground border-b border-border">
                <th className="text-left px-2 py-2 font-normal w-8"></th>
                <th className="text-left px-2 py-2 font-normal w-16">Time</th>
                <th className="text-left px-2 py-2 font-normal w-16">Source</th>
                <th className="text-left px-2 py-2 font-normal">Input</th>
                <th className="text-left px-2 py-2 font-normal">Output</th>
                <th className="text-left px-2 py-2 font-normal w-24">Agent</th>
                <th className="text-left px-2 py-2 font-normal w-16">Status</th>
                <th className="text-right px-2 py-2 font-normal w-20">Tokens</th>
                <th className="text-right px-2 py-2 font-normal w-14">Latency</th>
              </tr>
            </thead>
            <tbody>
              <SkeletonRows />
            </tbody>
          </table>
        ) : data && entries.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No feed entries"
            description={
              searchQuery
                ? `No entries matching "${searchQuery}". Try a different search.`
                : filter !== "all"
                  ? `No ${filter} entries found. Try clearing the filter.`
                  : "No agent activity recorded yet."
            }
            action={
              searchQuery
                ? { label: "Clear search", onClick: () => setSearchQuery("") }
                : filter !== "all"
                  ? { label: "Clear filter", onClick: () => setFilter("all") }
                  : undefined
            }
          />
        ) : entries.length > 0 ? (
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
              <tr className="text-[10px] text-muted-foreground border-b border-border">
                <th className="text-left px-2 py-2 font-normal w-8"></th>
                <th className="text-left px-2 py-2 font-normal w-16">Time</th>
                <th className="text-left px-2 py-2 font-normal w-16">Source</th>
                <th className="text-left px-2 py-2 font-normal">Input</th>
                <th className="text-left px-2 py-2 font-normal">Output</th>
                <th className="text-left px-2 py-2 font-normal w-24">Agent</th>
                <th className="text-left px-2 py-2 font-normal w-16">Status</th>
                <th className="text-right px-2 py-2 font-normal w-20">Tokens</th>
                <th className="text-right px-2 py-2 font-normal w-14">Latency</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Fragment key={entry.id}>
                  <tr
                    onClick={() => handleRowClick(entry)}
                    className={`border-b border-border/30 hover:bg-muted/50 text-xs cursor-pointer transition-colors ${entry.status === "error" ? "bg-[var(--status-error-bg)]" : ""} ${expandedId === entry.id ? "bg-muted/40" : ""}`}
                  >
                    <td className="px-2 py-2 text-muted-foreground">
                      {expandedId === entry.id ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
                      <span title={new Date(entry.timestamp).toLocaleString()}>
                        {timeAgo(entry.timestamp)}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <Badge className={`text-[10px] border-0 ${SOURCE_STYLE[entry.source] || "bg-accent text-foreground"}`}>
                        {entry.source}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-foreground max-w-[200px] truncate">
                      {truncateText(entry.input)}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground max-w-[200px] truncate">
                      {truncateText(entry.output)}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground font-mono text-[11px]">
                      {entry.agent_id || "—"}
                    </td>
                    <td className="px-2 py-2">
                      <Badge className={`text-[10px] border-0 ${STATUS_STYLE[entry.status] || "bg-accent text-foreground"}`}>
                        {entry.status}
                      </Badge>
                    </td>
                    <td className="px-2 py-2 text-right text-muted-foreground tabular-nums font-mono text-[11px]">
                      {formatTokens(entry.tokens_in, entry.tokens_out)}
                    </td>
                    <td className="px-2 py-2 text-right text-muted-foreground tabular-nums font-mono text-[11px]">
                      {formatLatency(entry.latency_ms)}
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <ExpandedRow
                      entry={entry}
                      onOpenSheet={setSelectedEntry}
                    />
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <Sheet open={!!selectedEntry} onOpenChange={(open) => { if (!open) setSelectedEntry(null); }}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          {selectedEntry && (
            <>
              <SheetHeader>
                <SheetTitle>Entry #{selectedEntry.id}</SheetTitle>
                <SheetDescription>
                  {new Date(selectedEntry.timestamp).toLocaleString()} ({timeAgo(selectedEntry.timestamp)})
                </SheetDescription>
              </SheetHeader>
              <div className="px-4 space-y-4">
                <div className="flex gap-2">
                  <Badge className={`text-[10px] border-0 ${STATUS_STYLE[selectedEntry.status] || "bg-accent text-foreground"}`}>
                    {selectedEntry.status}
                  </Badge>
                  <Badge className={`text-[10px] border-0 ${SOURCE_STYLE[selectedEntry.source] || "bg-accent text-foreground"}`}>
                    {selectedEntry.source}
                  </Badge>
                </div>

                <div className="space-y-0">
                  <DetailRow label="Agent" value={selectedEntry.agent_id} />
                  <DetailRow label="Platform" value={selectedEntry.platform} />
                  <DetailRow label="Source Name" value={selectedEntry.source_name} />
                  <DetailRow label="Sub-agent" value={selectedEntry.sub_agent} />
                  <DetailRow label="Tokens In" value={selectedEntry.tokens_in?.toLocaleString()} />
                  <DetailRow label="Tokens Out" value={selectedEntry.tokens_out?.toLocaleString()} />
                  <DetailRow label="Latency" value={formatLatency(selectedEntry.latency_ms)} />
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground">Input</h4>
                  <pre className="text-xs text-foreground bg-muted/50 rounded p-3 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                    {selectedEntry.input || "—"}
                  </pre>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground">Output</h4>
                  <pre className="text-xs text-foreground bg-muted/50 rounded p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                    {selectedEntry.output || "—"}
                  </pre>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
