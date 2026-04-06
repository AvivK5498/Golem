"use client";

import { useFetch } from "@/lib/use-api";
import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import type { CronJob } from "@/lib/types";
import { CronBuilder } from "@/components/cron-builder";
import { AutoTextarea } from "@/components/auto-textarea";
import { toast } from "sonner";

export default function EditCronPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data } = useFetch<{ cron: CronJob }>(`/api/crons/${id}`);
  const cron = data?.cron;

  const [name, setName] = useState("");
  const [cronExpr, setCronExpr] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cron) return;
    setName(cron.name || "");
    setCronExpr(cron.cron_expr || "");
    setMessage(cron.description || "");
  }, [cron]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/crons/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || null,
          description: message.trim(),
          task_kind: "agent_turn",
          cron_expr: cronExpr.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Cron saved");
      router.push("/crons");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    try {
      await fetch(`/api/crons/${id}`, { method: "DELETE" });
      toast.success("Cron deleted");
      router.push("/crons");
    } catch { /* ignore */ }
  }

  const inputClass =
    "w-full bg-card/60 border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-muted-foreground transition-colors";

  if (!cron) return <p className="p-8 text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="flex-1 overflow-y-auto">
      <form onSubmit={handleSave} className="py-6 px-6 space-y-6">
        <PageHeader
          title={cron.name || `Cron #${cron.id}`}
          breadcrumbs={[{ label: "Crons", href: "/crons" }, { label: cron.name || `#${cron.id}` }]}
        />

        <Card>
          <CardHeader>
            <CardTitle>Cron Job</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" className={inputClass} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Schedule</label>
              <CronBuilder value={cronExpr} onChange={setCronExpr} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Agent Prompt</label>
              <AutoTextarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What should the agent do on each run?" minRows={3} maxHeight={400} className="font-mono" />
            </div>
          </CardContent>

          {error && (
            <CardContent>
              <div className="text-xs text-destructive bg-[var(--status-error-bg)] rounded-md px-3 py-2">{error}</div>
            </CardContent>
          )}

          <CardFooter className="justify-between">
            <AlertDialog>
              <AlertDialogTrigger
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
              >
                <Trash2 size={12} /> Delete
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete cron job?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete &quot;{cron.name || `#${cron.id}`}&quot;. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={handleDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <div className="flex items-center gap-3">
              <Link href="/crons" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-xs")}>
                Cancel
              </Link>
              <Button type="submit" size="sm" disabled={saving || !message.trim() || !cronExpr.trim()} className="text-xs">
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
