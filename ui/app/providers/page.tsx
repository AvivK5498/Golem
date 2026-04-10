"use client";

import { useFetch } from "@/lib/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { Plug, CheckCircle2, AlertTriangle, Copy, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface CodexModelEntry {
  id: string;
  name: string;
  contextLength: number;
  provider: "codex";
}

interface CodexQuotaWindow {
  windowMinutes: number;
  usedPercent: number;
  resetAfterSeconds: number;
  resetAt: number;
}

interface CodexQuota {
  planType: string | null;
  activeLimit: string | null;
  creditsUnlimited: boolean;
  creditsHasCredits: boolean;
  capturedAt: number;
  primary: CodexQuotaWindow | null;
  secondary: CodexQuotaWindow | null;
}

interface ProviderEntry {
  id: string;
  name: string;
  configured: boolean;
  authType: "api_key" | "oauth";
  status: string;
  note: string;
  source?: string | null;
  sourcePath?: string | null;
  expiresIn?: string | null;
  accountId?: string | null;
  plan?: string | null;
  email?: string | null;
  models?: CodexModelEntry[];
  quota?: CodexQuota | null;
}

const CODEX_LOGIN_CMD = "npx tsx src/codex-auth.ts";

/**
 * Format a duration in seconds as "5h 12m" / "3d 4h" / "8m" / "just now".
 * Used for quota reset countdowns.
 */
function formatResetCountdown(seconds: number): string {
  if (seconds <= 0) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

/** Render a single quota window as a labelled horizontal usage bar. */
function QuotaBar({ label, window }: { label: string; window: CodexQuotaWindow }) {
  const pct = Math.min(100, Math.max(0, window.usedPercent));
  // Color scale: green up to 60%, amber 60-85%, red beyond
  const barColor = pct >= 85
    ? "bg-[var(--destructive)]"
    : pct >= 60
      ? "bg-amber-500"
      : "bg-[var(--brand)]";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground">
        Resets in <span className="font-mono">{formatResetCountdown(window.resetAfterSeconds)}</span>
      </div>
    </div>
  );
}

export default function ProvidersPage() {
  const { data, loading, refetch } = useFetch<{ providers: ProviderEntry[] }>("/api/providers");
  const providers = data?.providers ?? [];
  const [copying, setCopying] = useState(false);

  // Refresh quota meters every 30s while the page is open. The /api/providers
  // response includes live reset countdowns recomputed server-side from the
  // capturedAt timestamp, so the bars stay accurate without per-second polling.
  useEffect(() => {
    const interval = setInterval(() => refetch(), 30_000);
    return () => clearInterval(interval);
  }, [refetch]);

  const copyLoginCmd = async () => {
    try {
      await navigator.clipboard.writeText(CODEX_LOGIN_CMD);
      setCopying(true);
      toast.success("Login command copied");
      setTimeout(() => setCopying(false), 1500);
    } catch {
      toast.error("Failed to copy");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Providers"
        description="Configure LLM providers and view subscription status."
      />

      {loading && !data ? (
        <div className="grid gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="border-b">
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4">
          {providers.map((p) => (
            <Card key={p.id}>
              <CardHeader className="border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    {p.configured ? (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <CheckCircle2 size={12} className="text-[var(--brand-text)]" />
                        Configured
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] gap-1 border-[var(--status-warning)] text-[var(--status-warning)]">
                        <AlertTriangle size={12} />
                        Not configured
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">
                      {p.authType === "oauth" ? "OAuth" : "API key"}
                    </Badge>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => refetch()} title="Re-check status">
                    <RefreshCw size={14} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-4">
                <p className="text-sm text-muted-foreground">{p.note}</p>

                {/* Codex-specific status block */}
                {p.id === "codex" && p.configured && (
                  <div className="rounded-md bg-muted/40 border border-border/60 p-3 space-y-1.5 text-[12px]">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Account</span>
                      <span className="font-mono">{p.email ?? p.accountId ?? "(unknown)"}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Plan</span>
                      <span className="font-mono">{p.plan ?? "(unknown)"}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Source</span>
                      <span className="font-mono">{p.source === "codex-cli" ? "Codex CLI (read-only)" : "Golem (managed)"}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Token expires in</span>
                      <span className="font-mono">{p.expiresIn ?? "(unknown)"}</span>
                    </div>
                    {p.sourcePath && (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Path</span>
                        <span className="font-mono text-[10px] text-foreground/70 truncate" title={p.sourcePath}>{p.sourcePath}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Codex live quota meters */}
                {p.id === "codex" && p.configured && p.quota && (p.quota.primary || p.quota.secondary) && (
                  <div className="rounded-md bg-muted/40 border border-border/60 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Quota</div>
                      <div className="text-[9px] text-muted-foreground">
                        Last updated <span className="font-mono">{formatResetCountdown(Math.floor((Date.now() - p.quota.capturedAt) / 1000))}</span> ago
                      </div>
                    </div>
                    {p.quota.primary && (
                      <QuotaBar
                        label={`Primary (${Math.round(p.quota.primary.windowMinutes / 60)}h window)`}
                        window={p.quota.primary}
                      />
                    )}
                    {p.quota.secondary && (
                      <QuotaBar
                        label={`Secondary (${Math.round(p.quota.secondary.windowMinutes / 1440)}d window)`}
                        window={p.quota.secondary}
                      />
                    )}
                  </div>
                )}

                {/* Codex login instructions when not configured */}
                {p.id === "codex" && !p.configured && (
                  <div className="rounded-md bg-muted/40 border border-border/60 p-3 space-y-2">
                    <p className="text-sm">Sign in via the CLI to use ChatGPT subscription models:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 font-mono text-[12px] bg-background border border-border/60 rounded px-2 py-1.5">
                        {CODEX_LOGIN_CMD}
                      </code>
                      <Button size="sm" variant="outline" onClick={copyLoginCmd}>
                        <Copy size={14} className="mr-1" /> {copying ? "Copied" : "Copy"}
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Run that in your terminal — a browser window will open for ChatGPT sign-in. After completing the OAuth flow, click the refresh icon above to re-check status.
                    </p>
                  </div>
                )}

                {/* OpenRouter missing API key */}
                {p.id === "openrouter" && !p.configured && (
                  <div className="rounded-md bg-muted/40 border border-border/60 p-3 text-sm">
                    Set <code className="font-mono">OPENROUTER_API_KEY</code> in your environment and restart the platform.
                  </div>
                )}

                {/* Available models for Codex */}
                {p.id === "codex" && p.models && p.models.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Available models</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {p.models.map((m) => (
                        <div key={m.id} className="flex items-center gap-2 text-[12px]">
                          <code className="font-mono text-foreground">{m.id}</code>
                          <span className="text-muted-foreground">— {m.name}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Pick any of these as a model override on an agent, or set them as a global tier in <a href="/settings" className="underline hover:text-foreground">Settings</a>.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && providers.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <Plug size={32} className="mx-auto mb-3 opacity-50" />
            No providers found.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
