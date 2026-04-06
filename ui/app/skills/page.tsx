"use client";

import { useFetch } from "@/lib/use-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";

interface SkillInfo {
  name: string;
  description: string;
  eligible: boolean;
  requires?: { env?: string[]; bins?: string[] };
  usedBy?: string[];
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
  const { data, loading } = useFetch<{ skills: SkillInfo[] }>("/api/available-skills");
  const skills = data?.skills ?? [];

  const eligibleCount = skills.filter((s) => s.eligible).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills"
        description={skills.length > 0 ? `${eligibleCount} of ${skills.length} skills available` : undefined}
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
          description="Skills are loaded from the skills/ directory. Add SKILL.md files to extend your agents."
        />
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {skills.map((skill) => (
            <Card key={skill.name} className={!skill.eligible ? "opacity-60" : undefined}>
              <CardContent className="p-4">
                {/* Header */}
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

                {/* Description */}
                <p className="text-xs text-muted-foreground line-clamp-3 mb-3">
                  {skill.description}
                </p>

                {/* Missing requirements */}
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

                {/* Used by */}
                {skill.usedBy && skill.usedBy.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">Used by:</span>
                    {skill.usedBy.map((agentId) => (
                      <Badge key={agentId} variant="secondary" className="text-[11px] font-mono">
                        {agentId}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
