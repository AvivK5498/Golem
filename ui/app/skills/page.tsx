"use client";

import { useState } from "react";
import { useFetch } from "@/lib/use-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { SkillInstallDialog } from "@/components/skills/skill-install-dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

interface SkillLock {
  source: string;
  sourceType: "github" | "skills_sh";
  ref: string | null;
  installedAt: string;
}

interface SkillInfo {
  name: string;
  description: string;
  eligible: boolean;
  requires?: { env?: string[]; bins?: string[] };
  usedBy?: string[];
  lock?: SkillLock | null;
}

interface PlatformAgent {
  id: string;
  name: string;
}

function SkillCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-24" />
      </CardContent>
    </Card>
  );
}

export default function SkillsPage() {
  const { data, loading, refetch } = useFetch<{ skills: SkillInfo[] }>("/api/available-skills");
  const { data: agentList } = useFetch<{ agents: PlatformAgent[] }>("/api/platform/agents");
  const skills = data?.skills ?? [];
  const agents = agentList?.agents ?? [];

  const [installOpen, setInstallOpen] = useState(false);
  const [uninstalling, setUninstalling] = useState<string | null>(null);

  const eligibleCount = skills.filter((s) => s.eligible).length;

  const handleUninstall = async (key: string) => {
    setUninstalling(key);
    try {
      const res = await fetch(`/api/skills/${key}`, { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error || `uninstall failed (${res.status})`);
      toast.success(`Uninstalled ${key}`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Uninstall failed");
    } finally {
      setUninstalling(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills"
        description={skills.length > 0 ? `${eligibleCount} of ${skills.length} skills available` : undefined}
        actions={
          <Button onClick={() => setInstallOpen(true)} size="sm">
            <Plus className="size-3.5 mr-1" />
            Install skill
          </Button>
        }
      />

      {loading && !data ? (
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkillCardSkeleton key={i} />
          ))}
        </div>
      ) : skills.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No skills installed"
          description="Install a skill from skills.sh or a GitHub repo to extend your agents."
          action={{ label: "Install skill", onClick: () => setInstallOpen(true) }}
        />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {skills.map((skill) => (
            <Card key={skill.name} className={!skill.eligible ? "opacity-60" : undefined}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-semibold text-foreground">{skill.name}</h3>
                  {skill.eligible ? (
                    <Badge className="bg-[var(--status-success-bg)] text-[var(--status-success)] border-0 text-[11px] gap-1">
                      <CheckCircle2 size={11} />
                      Ready
                    </Badge>
                  ) : (
                    <Badge className="bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-0 text-[11px] gap-1">
                      <AlertTriangle size={11} />
                      Missing
                    </Badge>
                  )}
                </div>

                <p className="text-xs text-muted-foreground line-clamp-3 mb-3">
                  {skill.description}
                </p>

                {!skill.eligible && skill.requires && (
                  <div className="text-xs text-muted-foreground space-y-0.5 mb-3">
                    {skill.requires.env?.map((v) => (
                      <div key={v} className="font-mono text-[11px]">
                        <span className="text-[var(--status-warning)]">!</span> {v}
                      </div>
                    ))}
                    {skill.requires.bins?.map((b) => (
                      <div key={b} className="font-mono text-[11px]">
                        <span className="text-[var(--status-warning)]">!</span> {b}
                      </div>
                    ))}
                  </div>
                )}

                {skill.usedBy && skill.usedBy.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap mb-3">
                    <span className="text-xs text-muted-foreground">Used by:</span>
                    {skill.usedBy.map((agentId) => (
                      <Badge key={agentId} variant="secondary" className="text-[11px] font-mono">
                        {agentId}
                      </Badge>
                    ))}
                  </div>
                )}

                {skill.lock && (
                  <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t border-border">
                    <a
                      href={
                        skill.lock.source.startsWith("github:")
                          ? `https://github.com/${skill.lock.source.replace(/^github:/, "").split("/").slice(0, 2).join("/")}`
                          : "#"
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-muted-foreground hover:text-foreground font-mono inline-flex items-center gap-1 truncate"
                      title={skill.lock.source}
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      <span className="truncate">{skill.lock.source.replace(/^github:/, "")}</span>
                    </a>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive transition-colors p-1 -m-1 shrink-0"
                            title="Uninstall"
                            disabled={uninstalling === skill.name}
                          >
                            {uninstalling === skill.name ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Uninstall {skill.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This deletes the skill directory from disk. Agents that reference it
                            will still list it in their config until you remove it manually.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel render={<Button variant="ghost">Cancel</Button>} />
                          <AlertDialogAction
                            render={
                              <Button
                                variant="destructive"
                                onClick={() => handleUninstall(skill.name)}
                              >
                                Uninstall
                              </Button>
                            }
                          />
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SkillInstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        agents={agents}
        onInstalled={() => refetch()}
      />
    </div>
  );
}
