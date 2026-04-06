"use client";

import { useFetch } from "@/lib/use-api";
import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import type { OpenRouterModel } from "@/lib/types";
import { ModelCombobox } from "@/components/model-combobox";
import {
  AlertDialog, AlertDialogTrigger, AlertDialogPortal, AlertDialogOverlay,
  AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";

const inputClass =
  "w-full bg-card/60 border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-muted-foreground transition-colors";
const labelClass = "text-[10px] text-muted-foreground";
const numberInputClass =
  "w-full bg-card/60 border border-border rounded-md px-3 py-2 text-xs text-foreground tabular-nums outline-none focus:border-muted-foreground";

interface PlatformAgent {
  id: string;
  name: string;
}

export default function SettingsPage() {
  const { data: settings, refetch } = useFetch<Record<string, string>>("/api/settings");
  const { data: agentList } = useFetch<{ agents: PlatformAgent[] }>("/api/platform/agents");
  const { data: modelsData } = useFetch<{ models: OpenRouterModel[] }>("/api/models");

  // Local state for batch saves
  const [defaultAgent, setDefaultAgent] = useState("");

  // Tiers
  const [tierLow, setTierLow] = useState("");
  const [tierMed, setTierMed] = useState("");
  const [tierHigh, setTierHigh] = useState("");
  const [nanoModel, setNanoModel] = useState("");

  // Observability
  const [obsEnabled, setObsEnabled] = useState(false);
  const [obsEndpoint, setObsEndpoint] = useState("");
  const [obsProject, setObsProject] = useState("");

  // Webhooks
  const [whEnabled, setWhEnabled] = useState(false);
  const [whToken, setWhToken] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);

  // Whisper
  const [whisperEnabled, setWhisperEnabled] = useState(false);
  const [whisperApiKey, setWhisperApiKey] = useState("");
  const [whisperEndpoint, setWhisperEndpoint] = useState("");
  const [whisperModel, setWhisperModel] = useState("");
  const [whisperTimeout, setWhisperTimeout] = useState("");
  const [showWhisperAdvanced, setShowWhisperAdvanced] = useState(false);

  // Command security
  const [allowedBinaries, setAllowedBinaries] = useState<string[]>([]);
  const [newBinary, setNewBinary] = useState("");
  const [detectedBinaries, setDetectedBinaries] = useState<string[] | null>(null);
  const [detectingBinaries, setDetectingBinaries] = useState(false);

  const [saving, setSaving] = useState("");

  useEffect(() => {
    if (!settings) return;
    setDefaultAgent(settings["global.defaultAgent"] ?? "");

    try {
      const tiers = JSON.parse(settings["global.llm.tiers"] || "{}");
      setTierLow(tiers.low ?? "");
      setTierMed(tiers.med ?? "");
      setTierHigh(tiers.high ?? "");
    } catch { /* ignore */ }
    setNanoModel(settings["global.llm.nanoModel"] ?? "google/gemini-3.1-flash-lite-preview");

    setObsEnabled(settings["global.observability.enabled"] === "true");
    setObsEndpoint(settings["global.observability.endpoint"] ?? "");
    setObsProject(settings["global.observability.projectName"] ?? "");

    setWhEnabled(settings["global.webhooks.enabled"] === "true");
    setWhToken(settings["global.webhooks.token"] ?? "");

    setWhisperEnabled(settings["global.whisper.enabled"] === "true");
    setWhisperApiKey(settings["global.whisper.apiKey"] ?? "");
    setWhisperEndpoint(settings["global.whisper.endpoint"] ?? "");
    setWhisperModel(settings["global.whisper.model"] ?? "");
    setWhisperTimeout(settings["global.whisper.timeoutMs"] ?? "30000");
    try {
      const bins = settings["global.runCommand.allowedBinaries"];
      setAllowedBinaries(bins ? JSON.parse(bins) : []);
    } catch { setAllowedBinaries([]); }
  }, [settings]);

  async function saveSection(section: string, data: Record<string, unknown>) {
    setSaving(section);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        refetch();
        toast.success(`${section} saved`);
      } else {
        toast.error("Failed to save");
      }
    } finally {
      setSaving("");
    }
  }

  const [tab, setTab] = useState<"platform" | "tiers" | "observability" | "webhooks" | "voice" | "security">("platform");

  const NAV_ITEMS: { id: typeof tab; label: string; group: string }[] = [
    { id: "platform", label: "Platform", group: "General" },
    { id: "tiers", label: "Model Tiers", group: "General" },
    { id: "observability", label: "Observability", group: "Integrations" },
    { id: "webhooks", label: "Webhooks", group: "Integrations" },
    { id: "voice", label: "Voice Transcription", group: "Integrations" },
    { id: "security", label: "Command Security", group: "Security" },
  ];

  const groups = [...new Set(NAV_ITEMS.map(i => i.group))];

  if (!settings) return <div className="p-6"><p className="text-sm text-muted-foreground">Loading...</p></div>;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto py-6 px-6">
        <PageHeader
          title="Settings"
          breadcrumbs={[{ label: "Settings" }]}
        />

        <div className="flex gap-6">
          {/* Left nav */}
          <nav className="w-44 shrink-0">
            <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-4">
              {groups.map(group => (
                <div key={group}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-2">
                    {group}
                  </p>
                  <div className="space-y-0.5">
                    {NAV_ITEMS.filter(i => i.group === group).map(item => (
                      <button
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        className={`w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors ${
                          tab === item.id
                            ? "bg-muted text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>

          {/* Right content */}
          <div className="flex-1 min-w-0 space-y-4">

        {/* Platform */}
        {tab === "platform" && (
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle className="text-xs">Platform</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className={labelClass}>Default Agent</label>
              <select value={defaultAgent} onChange={e => setDefaultAgent(e.target.value)} className={inputClass}>
                <option value="">Select...</option>
                {(agentList?.agents || []).map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.id})</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveSection("Platform", {
                "global.defaultAgent": defaultAgent,
              })} disabled={saving === "Platform"}>
                {saving === "Platform" ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        )}

        {/* Model Tiers */}
        {tab === "tiers" && (
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle className="text-xs">Model Tiers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[10px] text-muted-foreground">
              Global model tiers shared by all agents. Per-agent tiers override these.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className={labelClass}>Low</label>
                <ModelCombobox value={tierLow} onChange={setTierLow} models={modelsData?.models} label="" />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>Med</label>
                <ModelCombobox value={tierMed} onChange={setTierMed} models={modelsData?.models} label="" />
              </div>
              <div className="space-y-1.5">
                <label className={labelClass}>High</label>
                <ModelCombobox value={tierHigh} onChange={setTierHigh} models={modelsData?.models} label="" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className={labelClass}>Nano Model (classification, utilities)</label>
              <ModelCombobox value={nanoModel} onChange={setNanoModel} models={modelsData?.models} label="" />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveSection("Model Tiers", {
                "global.llm.tiers": JSON.stringify({ low: tierLow, med: tierMed, high: tierHigh }),
                "global.llm.nanoModel": nanoModel,
              })} disabled={saving === "Model Tiers"}>
                {saving === "Model Tiers" ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        )}

        {/* Observability */}
        {tab === "observability" && (
        <Card size="sm">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs">Observability (Phoenix)</CardTitle>
              <Badge variant="outline" className="text-[9px] border-border">restart required</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={obsEnabled} onChange={e => setObsEnabled(e.target.checked)}
                className="rounded border-border bg-accent" />
              <span className="text-xs">Enable Phoenix tracing</span>
            </label>
            {obsEnabled && (
              <>
                <div className="space-y-1.5">
                  <label className={labelClass}>Endpoint</label>
                  <input value={obsEndpoint} onChange={e => setObsEndpoint(e.target.value)} placeholder="http://localhost:6006/v1/traces" className={inputClass} />
                </div>
                <div className="space-y-1.5">
                  <label className={labelClass}>Project Name</label>
                  <input value={obsProject} onChange={e => setObsProject(e.target.value)} placeholder="golem-agent" className={inputClass} />
                </div>
              </>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveSection("Observability", {
                "global.observability.enabled": obsEnabled,
                "global.observability.endpoint": obsEndpoint,
                "global.observability.projectName": obsProject,
              })} disabled={saving === "Observability"}>
                {saving === "Observability" ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        )}

        {/* Webhooks */}
        {tab === "webhooks" && (
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle className="text-xs">Webhooks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={whEnabled} onChange={e => setWhEnabled(e.target.checked)}
                className="rounded border-border bg-accent" />
              <span className="text-xs">Enable webhook endpoints</span>
            </label>
            {whEnabled && (
              <>
                <div className="space-y-1.5">
                  <label className={labelClass}>Token</label>
                  {whToken ? (
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-xs font-mono text-muted-foreground truncate">{whToken}</code>
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button size="sm" variant="outline" disabled={generatingToken}>{generatingToken ? "Rotating..." : "Rotate"}</Button>} />
                        <AlertDialogPortal>
                          <AlertDialogOverlay />
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Rotate webhook token?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will generate a new token and invalidate the current one. All existing webhook integrations will need to be updated with the new token.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={async () => {
                                setGeneratingToken(true);
                                try {
                                  const res = await fetch("/api/webhooks/generate-token", { method: "POST" });
                                  const data = await res.json();
                                  if (res.ok) {
                                    setWhToken(`\${${data.envVar}}`);
                                    setWhEnabled(true);
                                    setGeneratedToken(data.token);
                                    toast.success("Token rotated");
                                  } else { toast.error(data.error || "Failed to generate token"); }
                                } catch { toast.error("Failed to generate token"); }
                                setGeneratingToken(false);
                              }}>Rotate Token</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialogPortal>
                      </AlertDialog>
                    </div>
                  ) : (
                    <Button size="sm" onClick={async () => {
                      setGeneratingToken(true);
                      try {
                        const res = await fetch("/api/webhooks/generate-token", { method: "POST" });
                        const data = await res.json();
                        if (res.ok) {
                          setWhToken(`\${${data.envVar}}`);
                          setWhEnabled(true);
                          setGeneratedToken(data.token);
                          toast.success("Token generated and saved to .env");
                        } else { toast.error(data.error || "Failed to generate token"); }
                      } catch { toast.error("Failed to generate token"); }
                      setGeneratingToken(false);
                    }} disabled={generatingToken}>
                      {generatingToken ? "Generating..." : "Generate Token"}
                    </Button>
                  )}
                  {generatedToken && (
                    <div className="rounded-lg bg-muted p-3 space-y-2">
                      <p className="text-xs text-muted-foreground">Your webhook token (shown once — copy it now):</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-card border border-border rounded-md px-3 py-2 text-xs font-mono break-all select-all">{generatedToken}</code>
                        <Button size="sm" variant="outline" onClick={() => {
                          navigator.clipboard.writeText(generatedToken);
                          toast.success("Copied to clipboard");
                        }}>Copy</Button>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Saved to <code className="font-mono">.env</code> as <code className="font-mono">GOLEM_WEBHOOK_TOKEN</code></p>
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveSection("Webhooks", {
                "global.webhooks.enabled": whEnabled,
                "global.webhooks.token": whToken,
              })} disabled={saving === "Webhooks"}>
                {saving === "Webhooks" ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        )}

        {/* Voice Transcription */}
        {tab === "voice" && (
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle className="text-xs">Voice Transcription</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={whisperEnabled} onChange={e => setWhisperEnabled(e.target.checked)}
                className="rounded border-border bg-accent" />
              <span className="text-xs">Enable voice transcription</span>
            </label>
            {whisperEnabled && (
              <>
                <div className="space-y-1.5">
                  <label className={labelClass}>API Key</label>
                  <input type="password" value={whisperApiKey} onChange={e => setWhisperApiKey(e.target.value)} placeholder="${GROQ_API_KEY}" className={`${inputClass} font-mono`} />
                  <p className="text-[10px] text-muted-foreground">
                    Groq API key or env var reference. <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-[var(--brand-text)] hover:underline">Get a free key</a>
                  </p>
                </div>
                <button
                  onClick={() => setShowWhisperAdvanced(!showWhisperAdvanced)}
                  className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showWhisperAdvanced ? "Hide advanced" : "Advanced settings"}
                </button>
                {showWhisperAdvanced && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className={labelClass}>Endpoint</label>
                      <input value={whisperEndpoint} onChange={e => setWhisperEndpoint(e.target.value)} placeholder="https://api.groq.com/openai/v1/audio/transcriptions" className={`${inputClass} font-mono`} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className={labelClass}>Model</label>
                        <input value={whisperModel} onChange={e => setWhisperModel(e.target.value)} placeholder="whisper-large-v3-turbo" className={`${inputClass} font-mono`} />
                      </div>
                      <div className="space-y-1.5">
                        <label className={labelClass}>Timeout (ms)</label>
                        <input value={whisperTimeout} onChange={e => setWhisperTimeout(e.target.value)} className={numberInputClass} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveSection("Whisper", {
                "global.whisper.enabled": whisperEnabled,
                "global.whisper.apiKey": whisperApiKey,
                "global.whisper.endpoint": whisperEndpoint,
                "global.whisper.model": whisperModel,
                "global.whisper.timeoutMs": whisperTimeout,
              })} disabled={saving === "Whisper"}>
                {saving === "Whisper" ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        )}

        {/* Command Security */}
        {tab === "security" && (
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle className="text-xs">Command Security</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-[10px] text-muted-foreground">
              Only binaries in this list can be executed by agents via the run_command tool. Read-only tools (grep, find, cat, ls, sort, head, tail) are always available.
            </p>

            {/* Current allowed binaries as chips */}
            {allowedBinaries.length > 0 && (
              <div className="space-y-1.5">
                <label className={labelClass}>Allowed binaries</label>
                <div className="flex flex-wrap gap-1.5">
                  {allowedBinaries.map(bin => (
                    <span key={bin} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-mono">
                      {bin}
                      <button
                        onClick={() => setAllowedBinaries(prev => prev.filter(b => b !== bin))}
                        className="text-muted-foreground hover:text-foreground ml-0.5"
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Add binary input */}
            <div className="space-y-1.5">
              <label className={labelClass}>Add binary</label>
              <input
                value={newBinary}
                onChange={e => setNewBinary(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && newBinary.trim()) {
                    setAllowedBinaries(prev => [...new Set([...prev, newBinary.trim()])]);
                    setNewBinary("");
                  }
                }}
                placeholder="Type a binary name and press Enter"
                className={`${inputClass} font-mono`}
              />
            </div>

            {/* Scan ~/.local/bin */}
            <button
              onClick={async () => {
                setDetectingBinaries(true);
                try {
                  const res = await fetch("/api/system/binaries");
                  const data = await res.json();
                  setDetectedBinaries(data.binaries || []);
                } catch { toast.error("Failed to scan binaries"); }
                setDetectingBinaries(false);
              }}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {detectingBinaries ? "Scanning..." : "Scan installed binaries"}
            </button>

            {detectedBinaries && (
              <div className="rounded-lg bg-muted p-3 space-y-2">
                <p className="text-[10px] text-muted-foreground">Found in ~/.local/bin and /usr/local/bin:</p>
                {detectedBinaries.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground/60">No binaries found. Type names manually above.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {detectedBinaries.map(bin => {
                      const isAdded = allowedBinaries.includes(bin);
                      return (
                        <button
                          key={bin}
                          disabled={isAdded}
                          onClick={() => setAllowedBinaries(prev => [...new Set([...prev, bin])])}
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-mono transition-colors ${isAdded ? "border-[var(--brand)] text-[var(--brand-text)] bg-[var(--brand-muted)]" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                        >
                          {isAdded ? `${bin} ✓` : `+ ${bin}`}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <Button size="sm" onClick={() => saveSection("CommandSecurity", {
                "global.runCommand.allowedBinaries": JSON.stringify(allowedBinaries),
              })} disabled={saving === "CommandSecurity"}>
                {saving === "CommandSecurity" ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
        )}

          </div>
        </div>
      </div>
    </div>
  );
}
