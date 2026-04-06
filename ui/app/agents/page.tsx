"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-api";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import Link from "next/link";
import {
  Plus,
  Wrench,
  Clock,
  MoreVertical,
  Pencil,
  Trash2,
  Search,
  Bot,
  Wifi,
  WifiOff,
  AlertTriangle,
} from "lucide-react";
import type { PlatformAgent } from "@/lib/types";

function AgentCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
        <Skeleton className="h-3.5 w-full mt-3" />
        <Skeleton className="h-3.5 w-2/3 mt-1.5" />
        <div className="mt-4 flex items-center gap-4">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function AgentsPage() {
  const [search, setSearch] = useState("");
  const { data, loading, refetch } = useFetch<{ agents: PlatformAgent[] }>(
    "/api/platform/agents",
    5000,
  );

  const agents = data?.agents || [];
  const filtered = search
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(search.toLowerCase()) ||
          a.description?.toLowerCase().includes(search.toLowerCase()) ||
          a.model.toLowerCase().includes(search.toLowerCase()),
      )
    : agents;

  async function toggleEnabled(id: string, enabled: boolean) {
    await fetch(`/api/platform/agents/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    refetch();
  }

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  async function handleDelete(id: string) {
    const res = await fetch(`/api/platform/agents/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`Agent "${id}" deleted. Restart to apply.`);
      refetch();
    } else {
      toast.error("Failed to delete agent");
    }
    setDeleteTarget(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description={agents.length > 0 ? `${agents.length} agents configured` : undefined}
        actions={
          <Link href="/agents/new" className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}>
            <Plus data-icon="inline-start" />
            New Agent
          </Link>
        }
      >
        {agents.length > 0 && (
          <div className="relative max-w-sm mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        )}
      </PageHeader>

      {loading && !data ? (
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
          {filtered.map((agent) => {
            const connected = agent.connected && agent.enabled;
            return (
              <Link key={agent.id} href={`/agents/${agent.id}`} className="block">
                <Card className="group transition-all hover:shadow-md hover:-translate-y-0.5 cursor-pointer h-full">
                  <CardContent className="p-4">
                    {/* Header: avatar + name + controls */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--brand-muted)] text-[var(--brand-text)] text-sm font-bold shrink-0">
                          {agent.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground truncate group-hover:text-[var(--brand-text)] transition-colors">
                              {agent.name}
                            </span>
                            <Tooltip>
                              <TooltipTrigger className="flex items-center gap-1 shrink-0">
                                <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[var(--status-success)] status-dot-pulse" : agent.warnings?.length ? "bg-[var(--status-warning)]" : "bg-[var(--text-tertiary)]"}`} />
                                {connected ? (
                                  <Wifi size={11} className="text-[var(--status-success)]" />
                                ) : agent.warnings?.length ? (
                                  <AlertTriangle size={11} className="text-[var(--status-warning)]" />
                                ) : (
                                  <WifiOff size={11} className="text-[var(--text-tertiary)]" />
                                )}
                              </TooltipTrigger>
                              <TooltipContent>{connected ? "Connected" : agent.warnings?.[0] || "Disconnected"}</TooltipContent>
                            </Tooltip>
                          </div>
                          <Badge variant="secondary" className="font-mono text-[11px] mt-0.5">
                            {agent.model.split("/").pop()}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch
                          size="sm"
                          checked={agent.enabled}
                          onCheckedChange={() => toggleEnabled(agent.id, agent.enabled)}
                          onClick={(e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <button
                                className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                                onClick={(e: React.MouseEvent) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                              />
                            }
                          >
                            <MoreVertical className="size-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
                            <DropdownMenuItem onClick={(e: React.MouseEvent) => { e.stopPropagation(); window.location.href = `/agents/${agent.id}`; }}>
                              <Pencil /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={(e: React.MouseEvent) => { e.stopPropagation(); setDeleteTarget(agent.id); }}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {/* Description */}
                    {agent.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                        {agent.description.trim()}
                      </p>
                    )}
                    {!agent.description && <div className="mb-4" />}

                    {/* Stats */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5 font-mono tabular-nums">
                        <Wrench className="size-3.5" />
                        {agent.toolCount} tools
                      </span>
                      <span className="flex items-center gap-1.5 font-mono tabular-nums">
                        <Clock className="size-3.5" />
                        {agent.cronCount} crons
                      </span>
                    </div>

                  </CardContent>
                </Card>
              </Link>
            );
          })}

          {/* Create new agent card */}
          <Link href="/agents/new" className="block">
            <button className="flex h-full min-h-[200px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 text-muted-foreground transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-muted)] hover:text-[var(--brand-text)]">
              <Plus className="mb-3 h-6 w-6" />
              <span className="text-[13px] font-medium">Create a new agent</span>
              <span className="mt-1 text-xs">
                Configure persona, tools, and skills
              </span>
            </button>
          </Link>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent &quot;{deleteTarget}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the agent directory and all its configuration files.
              The platform will need a restart to fully disconnect the agent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete Agent
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
