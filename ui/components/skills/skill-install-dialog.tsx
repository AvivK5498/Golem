"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  AlertTriangle,
  Star,
  Clock,
  CheckCircle2,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PreviewResult {
  owner: string;
  repo: string;
  stars: number;
  forks: number;
  lastCommitISO: string | null;
  lastCommitAgeDays: number | null;
  defaultBranch: string;
  description: string | null;
  topics: string[];
  requestedSkill: string | null;
  skillMeta: { key: string; name: string; description: string | null; path: string } | null;
  sourceLocator: string;
}

interface ScanResult {
  critical: string[];
  warnings: string[];
  scannedFiles: number;
}

interface InstallResponse {
  ok: boolean;
  key: string;
  source: string;
  scan: ScanResult;
  attachedAgents: string[];
}

interface AgentOption {
  id: string;
  name: string;
}

interface SkillInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agents: AgentOption[];
  onInstalled?: (key: string) => void | Promise<void>;
}

export function SkillInstallDialog({
  open,
  onOpenChange,
  agents,
  onInstalled,
}: SkillInstallDialogProps) {
  const [source, setSource] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [attachTo, setAttachTo] = useState<Set<string>>(new Set());
  const [installResult, setInstallResult] = useState<InstallResponse | null>(null);

  // Reset state when dialog opens/closes.
  useEffect(() => {
    if (!open) {
      setSource("");
      setPreview(null);
      setPreviewError(null);
      setImportError(null);
      setAttachTo(new Set());
      setInstallResult(null);
    }
  }, [open]);

  const handlePreview = useCallback(async () => {
    const raw = source.trim();
    if (!raw) return;
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);
    try {
      const res = await fetch("/api/skills/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: raw }),
      });
      const data = (await res.json()) as PreviewResult & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error || `preview failed (${res.status})`);
      setPreview(data);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }, [source]);

  const handleInstall = useCallback(async () => {
    setImporting(true);
    setImportError(null);
    try {
      const body: Record<string, unknown> = { source };
      if (attachTo.size > 0) body.attachToAgents = Array.from(attachTo);
      const res = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as InstallResponse & { error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "install failed");
      setInstallResult(data);
      if (onInstalled) await onInstalled(data.key);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Install failed");
    } finally {
      setImporting(false);
    }
  }, [source, attachTo, onInstalled]);

  const toggleAttach = (id: string) => {
    setAttachTo((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const stale =
    preview?.lastCommitAgeDays != null && preview.lastCommitAgeDays > 365
      ? "red"
      : preview?.lastCommitAgeDays != null && preview.lastCommitAgeDays > 180
        ? "yellow"
        : null;
  const lowStars = preview != null && preview.stars < 10;

  // Post-install success screen.
  if (installResult) {
    const { scan } = installResult;
    const hasCritical = scan.critical.length > 0;
    const hasWarnings = scan.warnings.length > 0;
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[92vw] max-w-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-[var(--status-success,#16a34a)]" />
              Installed {installResult.key}
            </DialogTitle>
            <DialogDescription>
              Source: <code className="font-mono text-xs">{installResult.source}</code>
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            {installResult.attachedAgents.length > 0 && (
              <div className="text-xs text-muted-foreground">
                Attached to:{" "}
                {installResult.attachedAgents.map((a) => (
                  <Badge key={a} variant="secondary" className="text-[11px] font-mono mr-1">
                    {a}
                  </Badge>
                ))}
              </div>
            )}

            <div className="text-xs text-muted-foreground">
              Security scan: scanned {scan.scannedFiles} file{scan.scannedFiles === 1 ? "" : "s"} —{" "}
              {hasCritical || hasWarnings
                ? `${scan.critical.length} critical, ${scan.warnings.length} warnings`
                : "no issues found"}
            </div>

            {hasCritical && (
              <div className="border border-destructive/40 rounded-md p-2.5 bg-destructive/5 flex flex-col gap-1">
                <div className="text-xs font-medium text-destructive flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5" />
                  Critical findings — review before using
                </div>
                <ul className="text-[11px] font-mono text-destructive/90 list-disc pl-5">
                  {scan.critical.map((c, i) => (
                    <li key={i}>{c.replace(/^\[CRITICAL\]\s*/, "")}</li>
                  ))}
                </ul>
              </div>
            )}
            {hasWarnings && (
              <div className="border border-amber-500/40 rounded-md p-2.5 bg-amber-500/5 flex flex-col gap-1">
                <div className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <AlertTriangle className="size-3.5" />
                  Warnings
                </div>
                <ul className="text-[11px] font-mono text-amber-700 dark:text-amber-300 list-disc pl-5">
                  {scan.warnings.map((w, i) => (
                    <li key={i}>{w.replace(/^\[WARNING\]\s*/, "")}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <DialogFooter>
            <DialogClose render={<Button>Done</Button>} />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Install skill</DialogTitle>
          <DialogDescription>
            Paste a skills.sh URL, a github.com URL, or a{" "}
            <code className="font-mono text-[11px]">github:owner/repo[/skill]</code> shortcode.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex gap-2">
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="https://skills.sh/anthropics/skills/release"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePreview();
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreview}
              disabled={!source.trim() || previewing}
            >
              {previewing ? <Loader2 className="size-3.5 animate-spin" /> : "Preview"}
            </Button>
          </div>

          {previewError && (
            <div className="text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              {previewError}
            </div>
          )}

          {preview && (
            <div className="border border-border rounded-md p-3 flex flex-col gap-2 bg-muted/30">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">
                  {preview.skillMeta?.name ?? preview.requestedSkill ?? `${preview.owner}/${preview.repo}`}
                </span>
                {preview.requestedSkill && (
                  <Badge variant="secondary" className="text-[10px] font-mono">
                    {preview.requestedSkill}
                  </Badge>
                )}
              </div>
              {(preview.skillMeta?.description ?? (preview.requestedSkill ? null : preview.description)) && (
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {preview.skillMeta?.description ?? preview.description}
                </p>
              )}
              {preview.requestedSkill && !preview.skillMeta && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                  Couldn&apos;t find <code className="font-mono">{preview.requestedSkill}</code>{" "}
                  in this repo&apos;s file tree — install will still attempt a recursive search.
                </p>
              )}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="text-muted-foreground/70">
                  from <code className="font-mono">{preview.owner}/{preview.repo}</code>
                </span>
                <span className="flex items-center gap-1">
                  <Star className="size-3" />
                  {preview.stars.toLocaleString()}
                </span>
                {preview.lastCommitAgeDays != null && (
                  <span
                    className={cn(
                      "flex items-center gap-1",
                      stale === "red" && "text-red-500",
                      stale === "yellow" && "text-amber-500",
                    )}
                  >
                    <Clock className="size-3" />
                    {preview.lastCommitAgeDays}d ago
                  </span>
                )}
              </div>
              {(stale || lowStars) && (
                <div className="flex flex-col gap-1 mt-1">
                  {lowStars && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                      <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                      Few stars — limited community adoption.
                    </div>
                  )}
                  {stale === "red" && (
                    <div className="text-[11px] text-red-500 flex items-start gap-1.5">
                      <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                      Stale — last commit over a year ago. May be unmaintained.
                    </div>
                  )}
                  {stale === "yellow" && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                      <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                      Last commit over 6 months ago.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {preview && agents.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] text-muted-foreground">
                Attach to agents (optional)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {agents.map((a) => {
                  const selected = attachTo.has(a.id);
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => toggleAttach(a.id)}
                      className={cn(
                        "text-[11px] px-2 py-1 rounded-md border transition-colors",
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:border-muted-foreground",
                      )}
                    >
                      {a.name || a.id}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {importError && (
            <div className="text-xs text-destructive flex items-start gap-1.5">
              <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
              {importError}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button onClick={handleInstall} disabled={!source.trim() || importing}>
            {importing ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
