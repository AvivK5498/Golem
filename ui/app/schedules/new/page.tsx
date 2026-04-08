"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CronBuilder } from "@/components/cron-builder";
import { AutoTextarea } from "@/components/auto-textarea";
import { useFetch } from "@/lib/use-api";
import { toast } from "sonner";

interface PlatformAgent {
  id: string;
  name: string;
}

function describeCronExpr(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return `Custom: ${expr}`;
  const [min, hour, , , dow] = parts;
  if (min.startsWith("*/") && hour === "*") return `Runs every ${min.slice(2)} minutes`;
  if (min === "0" && hour.startsWith("*/")) return `Runs every ${hour.slice(2)} hours`;
  if (min === "0" && hour !== "*" && dow === "1-5") return `Runs weekdays at ${hour}:00 UTC`;
  if (min === "0" && hour !== "*" && dow === "*") return `Runs daily at ${hour}:00 UTC`;
  return `Custom schedule: ${expr}`;
}

export default function NewCronPage() {
  return (
    <Suspense>
      <NewCronPageInner />
    </Suspense>
  );
}

function NewCronPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [message, setMessage] = useState("");
  const [agentId, setAgentId] = useState(searchParams.get("agent_id") || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: agentList } = useFetch<{ agents: PlatformAgent[] }>("/api/platform/agents");

  const canSubmit = message.trim() && cronExpr.trim() && !submitting;

  const selectedAgentName =
    agentList?.agents.find((a) => a.id === agentId)?.name ?? agentId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/crons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          description: message.trim(),
          cron_expr: cronExpr.trim(),
          task_kind: "agent_turn",
          agent_id: agentId,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      toast.success("Schedule created");
      router.push("/schedules");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create schedule";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full bg-card/60 border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-muted-foreground transition-colors";

  return (
    <div className="flex-1 overflow-y-auto">
      <form onSubmit={handleSubmit} className="py-6 px-6 space-y-6">
        <PageHeader
          title="New Schedule"
          breadcrumbs={[{ label: "Schedules", href: "/schedules" }, { label: "New Schedule" }]}
        />

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. email-triage, daily-digest"
                className={inputClass}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Agent</label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className={inputClass}
              >
                {agentList?.agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Schedule</label>
              <CronBuilder value={cronExpr} onChange={setCronExpr} />
              <p className="text-[11px] text-muted-foreground/70">
                Choose when this task should run. All schedules are in UTC.
              </p>
            </div>

            {cronExpr && (
              <div className="rounded-lg border border-[var(--status-success)]/20 bg-[var(--status-success-bg)] p-4">
                <div className="text-sm font-medium text-[var(--status-success)]">Schedule preview</div>
                <div className="mt-1 text-sm text-foreground">{describeCronExpr(cronExpr)}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Cron expression: <code className="font-mono">{cronExpr}</code>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Agent Prompt <span className="text-destructive">*</span>
              </label>
              <AutoTextarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Example: Review unread support emails from the last 6 hours. Summarize urgent items, draft replies for approval, and archive low-priority messages."
                minRows={5}
                maxHeight={400}
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground/70">
                This prompt is sent to the selected agent on every run. Be explicit about expected output and side effects.
              </p>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground/80">Tips for effective schedule prompts:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Define the objective clearly</li>
                  <li>Specify the time scope (e.g., &quot;from the last 6 hours&quot;)</li>
                  <li>Describe expected output format</li>
                  <li>Mention any side effects (sending emails, creating files)</li>
                </ul>
              </div>
            </div>
          </CardContent>

          {/* Review / Summary */}
          {(message.trim() || cronExpr.trim()) && (
            <CardContent>
              <Card size="sm" className="bg-muted/30 ring-0">
                <CardHeader className="pb-0">
                  <CardTitle className="text-xs text-muted-foreground font-normal">Review</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex gap-2">
                    <span className="text-muted-foreground w-16 shrink-0">Agent</span>
                    <span className="text-foreground">{selectedAgentName}</span>
                  </div>
                  {cronExpr.trim() && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-16 shrink-0">Schedule</span>
                      <span className="text-foreground font-mono">{cronExpr}</span>
                    </div>
                  )}
                  {message.trim() && (
                    <div className="flex gap-2">
                      <span className="text-muted-foreground w-16 shrink-0">Prompt</span>
                      <span className="text-foreground line-clamp-3">{message.trim()}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            </CardContent>
          )}

          {error && (
            <CardContent>
              <div className="text-xs text-destructive bg-[var(--status-error-bg)] rounded-md px-3 py-2">
                {error}
              </div>
            </CardContent>
          )}

          <CardFooter className="flex-col gap-4 border-t border-border/60 bg-muted/10 pt-4">
            {cronExpr && agentId && (
              <div className="w-full text-sm text-muted-foreground">
                Runs as <span className="text-foreground font-medium">{selectedAgentName}</span> · Schedule: <span className="font-mono text-foreground">{cronExpr}</span>
              </div>
            )}
            <div className="flex w-full items-center justify-between">
              <p className="text-xs text-muted-foreground">Schedules run automatically on the selected schedule.</p>
              <div className="flex gap-3">
                <Link href="/schedules" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-xs")}>Cancel</Link>
                <Button type="submit" size="sm" disabled={!canSubmit} className="text-xs">
                  {submitting ? "Creating..." : "Create Schedule"}
                </Button>
              </div>
            </div>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
