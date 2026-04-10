"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TextShimmer } from "@/components/motion-primitives/text-shimmer";
import { useFetch } from "@/lib/use-api";
import { APP_NAME } from "@/lib/constants";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowLeft,
  Bot,
  Check,
  Copy,
  CreditCard,
  Globe,
  Key,
  Loader2,
  MessageSquare,
  Moon,
  Plug,
  Sparkles,
  Sun,
  Wrench,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import type { OpenRouterModel } from "@/lib/types";

type ProviderSet = Set<"openrouter" | "codex">;

const OPENROUTER_DEFAULT_TIERS = {
  low: "google/gemini-3-flash-preview",
  med: "openai/gpt-5.4",
  high: "anthropic/claude-opus-4-6",
};

const CODEX_DEFAULT_TIERS = {
  low: "codex/gpt-5.4-mini",
  med: "codex/gpt-5.4",
  high: "codex/gpt-5.4",
};

const DEFAULT_TIERS = OPENROUTER_DEFAULT_TIERS;

function getDefaultTiers(providers: ProviderSet) {
  if (providers.has("openrouter")) return OPENROUTER_DEFAULT_TIERS;
  return CODEX_DEFAULT_TIERS;
}

const TIER_DESCRIPTIONS = {
  low: "Fast & affordable — everyday chat, simple tasks",
  med: "Balanced — multi-step tasks, tool usage",
  high: "Powerful — complex reasoning, coding, research",
};

// ── Step Components ───────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-6">
      <div className="space-y-2">
        <h1 className="text-[28px] font-semibold tracking-tight">Welcome to {APP_NAME}</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Your personal AI agent platform. Create agents with custom personas,
          connect them to Telegram, and automate your workflows.
        </p>
      </div>
      <Button onClick={onNext} size="lg" className="gap-2 h-12 px-8">
        Get Started <ArrowRight size={16} />
      </Button>
      <a href="/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
        Already configured? Skip to dashboard
      </a>
      <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
        <span>Theme</span>
        <button
          type="button"
          onClick={() => setTheme("light")}
          className={`flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
            mounted && theme === "light"
              ? "bg-accent text-foreground"
              : "hover:text-foreground"
          }`}
        >
          <Sun size={12} />
          Light
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          className={`flex items-center gap-1 rounded-md px-2 py-1 transition-colors ${
            mounted && theme === "dark"
              ? "bg-accent text-foreground"
              : "hover:text-foreground"
          }`}
        >
          <Moon size={12} />
          Dark
        </button>
      </div>
    </div>
  );
}

function StepProviders({
  selectedProviders,
  setSelectedProviders,
  onNext,
  onBack,
}: {
  selectedProviders: ProviderSet;
  setSelectedProviders: (v: ProviderSet) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  function toggle(id: "openrouter" | "codex") {
    const next = new Set(selectedProviders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedProviders(next);
  }

  const providers = [
    {
      id: "openrouter" as const,
      name: "OpenRouter",
      description: "Pay-per-token. 100+ models including Claude, GPT, Gemini, and Mistral.",
      badge: "API Key",
      icon: <Globe size={18} />,
    },
    {
      id: "codex" as const,
      name: "Codex (ChatGPT)",
      description: "Use your ChatGPT Plus or Pro subscription. No per-token cost under fair-use quota.",
      badge: "OAuth",
      icon: <CreditCard size={18} />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Choose your model providers</h2>
        <p className="text-sm text-muted-foreground">
          Select which LLM providers to use. You can add more later in Settings.
        </p>
      </div>

      <div className="space-y-3">
        {providers.map((p) => {
          const checked = selectedProviders.has(p.id);
          return (
            <Card
              key={p.id}
              className={`cursor-pointer transition-colors ${checked ? "border-[var(--brand)] bg-[var(--brand-muted)]/30" : "hover:border-foreground/20"}`}
              onClick={() => toggle(p.id)}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-[var(--brand)] bg-[var(--brand)] text-black" : "border-border bg-muted"}`}>
                  {checked && <Check size={10} strokeWidth={3} />}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    {p.icon}
                    <span className="text-sm font-medium">{p.name}</span>
                    <Badge variant="secondary" className="text-[10px]">{p.badge}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {selectedProviders.size === 0 && (
        <p className="text-xs text-destructive">Select at least one provider to continue.</p>
      )}

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={onNext} disabled={selectedProviders.size === 0} className="gap-1">
          Next <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

function StepCodex({
  onNext,
  onBack,
  onSkip,
}: {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [accountInfo, setAccountInfo] = useState<{ email?: string; plan?: string } | null>(null);
  const [authUrl, setAuthUrl] = useState("");
  const [error, setError] = useState("");

  async function startLogin() {
    setStarting(true);
    setError("");
    // Open a blank tab synchronously (user-initiated click) so the browser
    // doesn't block it as a popup. We'll navigate it once we have the URL.
    const tab = window.open("about:blank", "_blank");
    try {
      const res = await fetch("/api/codex/login", { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to start login");
        setStarting(false);
        tab?.close();
        return;
      }
      const { url } = await res.json();
      if (url) {
        setAuthUrl(url);
        if (tab) {
          tab.location.href = url;
        } else {
          window.open(url, "_blank");
        }
      }
    } catch {
      setError("Failed to reach the server");
      setStarting(false);
      tab?.close();
    }
  }

  async function checkStatus() {
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        const data = await res.json();
        const codex = data.providers?.find((p: { id: string }) => p.id === "codex");
        if (codex?.configured) {
          setConfigured(true);
          setStarting(false);
          setAccountInfo({ email: codex.email, plan: codex.plan });
        }
      }
    } catch { /* network error */ }
  }

  // Auto-poll every 3s while waiting for auth
  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Connect Codex (ChatGPT)</h2>
        <p className="text-sm text-muted-foreground">
          Sign in with your ChatGPT account to use your Plus or Pro subscription models.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          {configured ? (
            <div className="flex items-center gap-2 text-sm text-[var(--brand-text)]">
              <CheckCircle2 size={16} />
              <span>
                Connected{accountInfo?.email ? ` as ${accountInfo.email}` : ""}
                {accountInfo?.plan ? ` (${accountInfo.plan})` : ""}
              </span>
            </div>
          ) : (
            <>
              <Button
                onClick={startLogin}
                disabled={starting}
                size="lg"
                className="w-full gap-2"
              >
                {starting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Waiting for sign-in...
                  </>
                ) : (
                  <>
                    <ExternalLink size={16} />
                    Sign in with ChatGPT
                  </>
                )}
              </Button>
              {starting && (
                <div className="space-y-2 text-center">
                  <p className="text-xs text-muted-foreground">
                    A browser tab should have opened. Complete the sign-in there and come back here.
                  </p>
                  {authUrl && (
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[var(--brand-text)] hover:underline"
                    >
                      Tab didn't open? Click here <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <div className="flex items-center gap-2">
          {!configured && (
            <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Skip for now
            </button>
          )}
          <Button onClick={onNext} disabled={!configured} className="gap-1">
            Next <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function StepApiKey({
  apiKey,
  setApiKey,
  onNext,
  onBack,
}: {
  apiKey: string;
  setApiKey: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const isValid = apiKey.startsWith("sk-or-") && apiKey.length > 20;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Connect your LLM provider</h2>
        <p className="text-sm text-muted-foreground">
          {APP_NAME} uses OpenRouter to access 100+ models including Claude, GPT, Gemini, and Mistral.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key" className="flex items-center gap-2">
              <Key size={14} />
              OpenRouter API Key
            </Label>
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-v1-..."
              className="font-mono"
            />
            {apiKey && !isValid && (
              <p className="text-xs text-destructive">Key should start with sk-or- and be at least 20 characters</p>
            )}
          </div>
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[var(--brand-text)] hover:underline"
          >
            Get a free key at openrouter.ai <ExternalLink size={11} />
          </a>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={onNext} disabled={!isValid} className="gap-1">
          Next <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

function StepTiers({
  tiers,
  setTiers,
  selectedProviders,
  onNext,
  onBack,
}: {
  tiers: { low: string; med: string; high: string };
  setTiers: (v: { low: string; med: string; high: string }) => void;
  selectedProviders: ProviderSet;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data: modelsData } = useFetch<{ models: OpenRouterModel[] }>("/api/models");
  const models = (modelsData?.models || []).filter(m =>
    selectedProviders.has((m.provider ?? "openrouter") as "openrouter" | "codex")
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Configure model tiers</h2>
        <p className="text-sm text-muted-foreground">
          Instead of browsing hundreds of models, define 3 presets. When creating an agent, you just pick
          Low, Medium, or High based on the agent's complexity.
        </p>
      </div>

      <div className="space-y-4">
        {(["low", "med", "high"] as const).map((tier) => (
          <Card key={tier}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs font-medium capitalize">
                      {tier === "med" ? "Medium" : tier}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {TIER_DESCRIPTIONS[tier]}
                    </span>
                  </div>
                  <div className="mt-2">
                    <Input
                      value={tiers[tier]}
                      onChange={(e) => setTiers({ ...tiers, [tier]: e.target.value })}
                      className="font-mono"
                      placeholder="model-provider/model-name"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        These are sensible defaults. You can change them anytime in Settings.
      </p>

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={onNext} className="gap-1">
          Next <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

function StepTelegram({
  botToken,
  setBotToken,
  ownerId,
  setOwnerId,
  onNext,
  onBack,
}: {
  botToken: string;
  setBotToken: (v: string) => void;
  ownerId: string;
  setOwnerId: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const isValid = botToken.includes(":") && botToken.length > 30;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Connect your Telegram bot</h2>
        <p className="text-sm text-muted-foreground">
          Each agent gets its own Telegram bot. Create one now for your first agent.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="rounded-lg bg-muted p-3 space-y-1">
            <p className="text-[13px] font-medium">How to create a Telegram bot:</p>
            <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside">
              <li>Open Telegram and message <span className="font-mono text-foreground">@BotFather</span></li>
              <li>Send <span className="font-mono text-foreground">/newbot</span> and follow the prompts</li>
              <li>Copy the bot token and paste it below</li>
            </ol>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bot-token" className="flex items-center gap-2">
              <MessageSquare size={14} />
              Bot Token
            </Label>
            <Input
              id="bot-token"
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v..."
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="owner-id">
              Your Telegram User ID <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="owner-id"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              placeholder="Leave blank to auto-detect"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank — your ID will be captured automatically when you send your first message to the bot.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={onNext} disabled={!isValid} className="gap-1">
          Next <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

function StepVoice({
  groqApiKey, setGroqApiKey, onNext, onBack,
}: {
  groqApiKey: string; setGroqApiKey: (v: string) => void;
  onNext: () => void; onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Voice transcription</h2>
        <p className="text-sm text-muted-foreground">
          Your agents can transcribe voice notes sent via Telegram. This uses Groq's free Whisper API — fast and accurate.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="groq-key" className="flex items-center gap-2">
              <Key size={14} /> Groq API Key <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="groq-key"
              type="password"
              value={groqApiKey}
              onChange={(e) => setGroqApiKey(e.target.value)}
              placeholder="gsk_..."
              className="font-mono"
            />
          </div>
          <a
            href="https://console.groq.com/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[var(--brand-text)] hover:underline"
          >
            Get a free key at console.groq.com <ExternalLink size={11} />
          </a>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <div className="flex items-center gap-2">
          {!groqApiKey && (
            <Button variant="outline" onClick={onNext} className="gap-1">
              Skip
            </Button>
          )}
          <Button onClick={onNext} disabled={!!groqApiKey && groqApiKey.length < 10} className="gap-1">
            Next <ArrowRight size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

import { BUILTIN_TOOLS } from "@/lib/tool-definitions";

function CheckboxItem({
  checked,
  onChange,
  label,
  description,
  detail,
  security,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  detail?: string;
  security?: "high";
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="py-1.5">
      <label className="flex items-start gap-2.5 cursor-pointer group">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 rounded border-border bg-muted accent-[var(--brand)] h-4 w-4"
        />
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-foreground group-hover:text-[var(--brand-text)] transition-colors">{label}</span>
            {security === "high" && <span className="text-[9px] text-amber-500 font-medium">&#9888;</span>}
          </div>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </label>
      {detail && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-6.5 pl-[26px] text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          >
            {expanded ? "Hide details" : "Learn more"}
          </button>
          {expanded && (
            <div className="ml-[26px] mt-1 text-[11px] text-muted-foreground bg-muted/50 rounded-md p-2 whitespace-pre-line">
              {detail}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StepAgent({
  agentName,
  setAgentName,
  agentDescription,
  setAgentDescription,
  agentTier,
  setAgentTier,
  ownerName,
  setOwnerName,
  onNext,
  onBack,
}: {
  agentName: string;
  setAgentName: (v: string) => void;
  agentDescription: string;
  setAgentDescription: (v: string) => void;
  agentTier: string;
  setAgentTier: (v: string) => void;
  ownerName: string;
  setOwnerName: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const isValid = agentName.trim().length > 0 && agentDescription.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Create your first agent</h2>
        <p className="text-sm text-muted-foreground">
          Give your agent a name and describe what it should do. A persona will be generated automatically.
        </p>
      </div>

      {/* Identity */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-name" className="flex items-center gap-2">
              <Bot size={14} />
              Agent Name
            </Label>
            <Input
              id="agent-name"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g., Atlas, Friday, Jarvis"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-desc">What should it do?</Label>
            <textarea
              id="agent-desc"
              value={agentDescription}
              onChange={(e) => setAgentDescription(e.target.value)}
              placeholder="e.g., Personal assistant for task management, research, and scheduling"
              rows={3}
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="owner-name">Your name</Label>
            <Input
              id="owner-name"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="e.g., Alex"
            />
          </div>

          <div className="space-y-2">
            <Label>Model tier</Label>
            <div className="flex gap-2">
              {(["low", "med", "high"] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setAgentTier(tier)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    agentTier === tier
                      ? "border-[var(--brand)] bg-[var(--brand-muted)] text-[var(--brand-text)]"
                      : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {tier === "med" ? "Medium" : tier.charAt(0).toUpperCase() + tier.slice(1)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {TIER_DESCRIPTIONS[agentTier as keyof typeof TIER_DESCRIPTIONS]}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={onNext} disabled={!isValid} className="gap-1">
          Next <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

function StepCapabilities({
  selectedTools,
  setSelectedTools,
  selectedSkills,
  setSelectedSkills,
  onSubmit,
  onBack,
  submitting,
}: {
  selectedTools: string[];
  setSelectedTools: (v: string[]) => void;
  selectedSkills: string[];
  setSelectedSkills: (v: string[]) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
}) {
  const { data: skillsData } = useFetch<{ skills: { name: string; description: string; eligible: boolean }[] }>("/api/available-skills");
  const eligibleSkills = (skillsData?.skills || []).filter((s) => s.eligible);

  function toggleTool(id: string) {
    setSelectedTools(selectedTools.includes(id) ? selectedTools.filter((t) => t !== id) : [...selectedTools, id]);
  }
  function toggleSkill(name: string) {
    setSelectedSkills(selectedSkills.includes(name) ? selectedSkills.filter((s) => s !== name) : [...selectedSkills, name]);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">What can your agent do?</h2>
        <p className="text-sm text-muted-foreground">
          Choose what your agent is allowed to do. You can change these later in Settings.
        </p>
      </div>

      {/* Tools */}
      <Card>
        <CardContent className="p-4">
          <p className="text-[13px] font-medium mb-3 flex items-center gap-2">
            <Wrench size={13} /> Tools
            <span className="text-xs text-muted-foreground font-normal">
              ({selectedTools.length} of {BUILTIN_TOOLS.length} selected)
            </span>
          </p>
          <div className="space-y-1">
            {BUILTIN_TOOLS.map((tool) => (
              <CheckboxItem
                key={tool.id}
                checked={selectedTools.includes(tool.id)}
                onChange={() => toggleTool(tool.id)}
                label={tool.label}
                description={tool.description}
                detail={tool.detail}
                security={tool.security}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Skills */}
      {eligibleSkills.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-[13px] font-medium mb-3 flex items-center gap-2">
              <Sparkles size={13} /> Skills
              <span className="text-xs text-muted-foreground font-normal">
                ({eligibleSkills.length} available)
              </span>
            </p>
            <div className="space-y-1">
              {eligibleSkills.map((skill) => (
                <CheckboxItem
                  key={skill.name}
                  checked={selectedSkills.includes(skill.name)}
                  onChange={() => toggleSkill(skill.name)}
                  label={skill.name}
                  description={skill.description}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* MCP awareness footer */}
      <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground flex gap-2">
        <Plug size={13} className="mt-0.5 shrink-0" />
        <p>
          Need web search, GitHub, databases, or other integrations? Those come from{" "}
          <span className="text-foreground font-medium">MCP servers</span>. For now, add them
          manually by editing <span className="font-mono text-foreground">mcp-servers.yaml</span>.
          A UI for managing MCP servers will come in a future release.
        </p>
      </div>

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={onSubmit} disabled={submitting} className="gap-1">
          {submitting ? (
            <TextShimmer className="text-sm" duration={1.5}>
              Creating agent...
            </TextShimmer>
          ) : (
            <>Create Agent <Sparkles size={14} /></>
          )}
        </Button>
      </div>
    </div>
  );
}

function StepDone({ agentName }: { agentName: string }) {
  const router = useRouter();
  const [restarting, setRestarting] = useState(false);
  const [ready, setReady] = useState(false);

  async function handleRestart() {
    setRestarting(true);
    try {
      await fetch("/api/restart", { method: "POST" });
      // Poll for health
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await fetch("/api/health");
          if (res.ok) { setReady(true); return; }
        } catch { /* still down */ }
      }
    } catch {
      toast.error("Restart failed");
    }
    setRestarting(false);
  }

  useEffect(() => {
    handleRestart();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-6">
      {!ready ? (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--brand-muted)]">
            <Sparkles size={28} className="text-[var(--brand-text)]" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">
              <TextShimmer duration={2}>Setting up your platform...</TextShimmer>
            </h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Writing configuration, generating persona, and restarting the platform.
              This takes about 10 seconds.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--brand-muted)]">
            <CheckCircle2 size={28} className="text-[var(--brand-text)]" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">You're all set!</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              <span className="text-foreground font-medium">{agentName}</span> is live.
              Open Telegram and send a message to start chatting.
              {" "}Your Telegram User ID will be captured automatically from your first message.
            </p>
          </div>
          <Button onClick={() => router.push("/")} size="lg" className="gap-2 h-12 px-8">
            Go to Dashboard <ArrowRight size={16} />
          </Button>
        </>
      )}
    </div>
  );
}

// ── Step indicator ────────────────────────────────────

function StepIndicator({ current, total, labels }: { current: number; total: number; labels: string[] }) {
  if (current === 0) return null; // no indicator on welcome
  const currentLabel = labels[current - 1] || "";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--brand-text)] font-medium">{currentLabel}</span>
        <span className="text-muted-foreground">{current} of {total}</span>
      </div>
      <Progress value={(current / total) * 100} className="h-1" />
    </div>
  );
}

// ── Main Onboarding Page ──────────────────────────────

// ── Step definitions for conditional navigation ─────

// Logical step IDs (stable in code, some skipped at runtime)
const STEP_WELCOME = 0;
const STEP_PROVIDERS = 1;
const STEP_API_KEY = 2;   // only if openrouter selected
const STEP_CODEX = 3;     // only if codex selected
const STEP_TIERS = 4;
const STEP_TELEGRAM = 5;
const STEP_VOICE = 6;
const STEP_AGENT = 7;
const STEP_CAPABILITIES = 8;
const STEP_DONE = 9;

function getActiveSteps(providers: ProviderSet): number[] {
  const steps = [STEP_WELCOME, STEP_PROVIDERS];
  if (providers.has("openrouter")) steps.push(STEP_API_KEY);
  if (providers.has("codex")) steps.push(STEP_CODEX);
  steps.push(STEP_TIERS, STEP_TELEGRAM, STEP_VOICE, STEP_AGENT, STEP_CAPABILITIES, STEP_DONE);
  return steps;
}

function getStepLabels(providers: ProviderSet): string[] {
  const labels: string[] = ["Providers"];
  if (providers.has("openrouter")) labels.push("API Key");
  if (providers.has("codex")) labels.push("Codex");
  labels.push("Tiers", "Telegram", "Voice", "Agent", "Capabilities", "Done");
  return labels;
}

function nextStep(current: number, providers: ProviderSet): number {
  const active = getActiveSteps(providers);
  const idx = active.indexOf(current);
  return idx >= 0 && idx < active.length - 1 ? active[idx + 1] : current;
}

function prevStep(current: number, providers: ProviderSet): number {
  const active = getActiveSteps(providers);
  const idx = active.indexOf(current);
  return idx > 0 ? active[idx - 1] : current;
}

function stepToIndicatorIndex(current: number, providers: ProviderSet): number {
  const active = getActiveSteps(providers);
  const idx = active.indexOf(current);
  // Step 0 (welcome) maps to 0, step 1 (providers) maps to 1, etc.
  return Math.max(0, idx);
}

export default function OnboardingPage() {
  const [step, setStep] = useState(0);

  // Providers
  const [selectedProviders, setSelectedProviders] = useState<ProviderSet>(new Set(["openrouter"]));

  // API Key
  const [apiKey, setApiKey] = useState("");

  // Tiers
  const [tiers, setTiers] = useState(DEFAULT_TIERS);
  const [tiersEdited, setTiersEdited] = useState(false);

  // Telegram
  const [botToken, setBotToken] = useState("");
  const [ownerId, setOwnerId] = useState("");

  // Voice
  const [groqApiKey, setGroqApiKey] = useState("");

  // Agent
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentTier, setAgentTier] = useState("low");
  const [ownerName, setOwnerName] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>(
    BUILTIN_TOOLS.filter((t) => t.default).map((t) => t.id)
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // Done
  const [submitting, setSubmitting] = useState(false);

  // Reset tier defaults when providers change (only if user hasn't manually edited)
  useEffect(() => {
    if (!tiersEdited) {
      setTiers(getDefaultTiers(selectedProviders));
    }
  }, [selectedProviders, tiersEdited]);

  const labels = getStepLabels(selectedProviders);
  const totalSteps = labels.length;
  const indicatorIndex = stepToIndicatorIndex(step, selectedProviders);

  const goNext = () => setStep(nextStep(step, selectedProviders));
  const goBack = () => setStep(prevStep(step, selectedProviders));

  function handleCodexSkip() {
    const next = new Set(selectedProviders);
    next.delete("codex");
    setSelectedProviders(next);
    // Jump past the codex step to tiers
    setStep(STEP_TIERS);
  }

  async function handleCreateAgent() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openrouterApiKey: apiKey || undefined,
          providers: [...selectedProviders],
          tiers,
          telegram: {
            botToken,
            ownerId: ownerId ? parseInt(ownerId, 10) : 0,
          },
          groqApiKey: groqApiKey || undefined,
          ownerName: ownerName || undefined,
          agent: {
            name: agentName,
            description: agentDescription,
            tier: agentTier,
            tools: selectedTools,
            skills: selectedSkills,
            mcpServers: [],
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Setup failed");
        setSubmitting(false);
        return;
      }

      setStep(STEP_DONE);
    } catch {
      toast.error("Setup failed — check your connection");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="w-full max-w-xl space-y-8">
        <StepIndicator current={indicatorIndex} total={totalSteps} labels={labels} />

        {step === STEP_WELCOME && <StepWelcome onNext={() => setStep(STEP_PROVIDERS)} />}
        {step === STEP_PROVIDERS && <StepProviders selectedProviders={selectedProviders} setSelectedProviders={setSelectedProviders} onNext={goNext} onBack={goBack} />}
        {step === STEP_API_KEY && <StepApiKey apiKey={apiKey} setApiKey={setApiKey} onNext={goNext} onBack={goBack} />}
        {step === STEP_CODEX && <StepCodex onNext={goNext} onBack={goBack} onSkip={handleCodexSkip} />}
        {step === STEP_TIERS && (
          <StepTiers
            tiers={tiers}
            setTiers={(v) => { setTiers(v); setTiersEdited(true); }}
            selectedProviders={selectedProviders}
            onNext={goNext}
            onBack={goBack}
          />
        )}
        {step === STEP_TELEGRAM && <StepTelegram botToken={botToken} setBotToken={setBotToken} ownerId={ownerId} setOwnerId={setOwnerId} onNext={goNext} onBack={goBack} />}
        {step === STEP_VOICE && <StepVoice groqApiKey={groqApiKey} setGroqApiKey={setGroqApiKey} onNext={goNext} onBack={goBack} />}
        {step === STEP_AGENT && <StepAgent agentName={agentName} setAgentName={setAgentName} agentDescription={agentDescription} setAgentDescription={setAgentDescription} agentTier={agentTier} setAgentTier={setAgentTier} ownerName={ownerName} setOwnerName={setOwnerName} onNext={goNext} onBack={goBack} />}
        {step === STEP_CAPABILITIES && <StepCapabilities selectedTools={selectedTools} setSelectedTools={setSelectedTools} selectedSkills={selectedSkills} setSelectedSkills={setSelectedSkills} onSubmit={handleCreateAgent} onBack={goBack} submitting={submitting} />}
        {step === STEP_DONE && <StepDone agentName={agentName} />}
      </div>
    </div>
  );
}
