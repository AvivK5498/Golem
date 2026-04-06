"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  Key,
  Layers,
  MessageSquare,
  Plug,
  Sparkles,
  Wrench,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import type { OpenRouterModel } from "@/lib/types";

const TOTAL_STEPS = 6;

const DEFAULT_TIERS = {
  low: "google/gemini-3-flash-preview",
  med: "openai/gpt-5.4",
  high: "anthropic/claude-opus-4-6",
};

const TIER_DESCRIPTIONS = {
  low: "Fast & affordable — everyday chat, simple tasks",
  med: "Balanced — multi-step tasks, tool usage",
  high: "Powerful — complex reasoning, coding, research",
};

// ── Step Components ───────────────────────────────────

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--brand)] text-[var(--primary-foreground)] text-2xl font-bold shadow-md">
        G
      </div>
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
  onNext,
  onBack,
}: {
  tiers: { low: string; med: string; high: string };
  setTiers: (v: { low: string; med: string; high: string }) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const { data: modelsData } = useFetch<{ models: OpenRouterModel[] }>("/api/models");
  const models = modelsData?.models || [];

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
  ownerRole,
  setOwnerRole,
  selectedTools,
  setSelectedTools,
  selectedSkills,
  setSelectedSkills,
  selectedMcp,
  setSelectedMcp,
  onSubmit,
  onBack,
  submitting,
}: {
  agentName: string;
  setAgentName: (v: string) => void;
  agentDescription: string;
  setAgentDescription: (v: string) => void;
  agentTier: string;
  setAgentTier: (v: string) => void;
  ownerName: string;
  setOwnerName: (v: string) => void;
  ownerRole: string;
  setOwnerRole: (v: string) => void;
  selectedTools: string[];
  setSelectedTools: (v: string[]) => void;
  selectedSkills: string[];
  setSelectedSkills: (v: string[]) => void;
  selectedMcp: string[];
  setSelectedMcp: (v: string[]) => void;
  onSubmit: () => void;
  onBack: () => void;
  submitting: boolean;
}) {
  const [showCapabilities, setShowCapabilities] = useState(false);
  const { data: skillsData } = useFetch<{ skills: { name: string; description: string; eligible: boolean }[] }>("/api/available-skills");
  const { data: mcpData } = useFetch<{ servers: string[] }>("/api/platform/mcp-servers");

  const eligibleSkills = (skillsData?.skills || []).filter((s) => s.eligible);
  const mcpServers = mcpData?.servers || [];
  const isValid = agentName.trim().length > 0 && agentDescription.trim().length > 0;

  function toggleTool(id: string) {
    setSelectedTools(selectedTools.includes(id) ? selectedTools.filter((t) => t !== id) : [...selectedTools, id]);
  }
  function toggleSkill(name: string) {
    setSelectedSkills(selectedSkills.includes(name) ? selectedSkills.filter((s) => s !== name) : [...selectedSkills, name]);
  }
  function toggleMcp(name: string) {
    setSelectedMcp(selectedMcp.includes(name) ? selectedMcp.filter((m) => m !== name) : [...selectedMcp, name]);
  }

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

          <div className="grid grid-cols-2 gap-4">
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
              <Label htmlFor="owner-role">Your role <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="owner-role"
                value={ownerRole}
                onChange={(e) => setOwnerRole(e.target.value)}
                placeholder="e.g., Software Engineer, Founder"
              />
            </div>
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

      {/* Capabilities (collapsible) */}
      <div>
        <button
          onClick={() => setShowCapabilities(!showCapabilities)}
          className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Layers size={14} />
          {showCapabilities ? "Hide capabilities" : "Configure capabilities (optional)"}
          <span className="text-xs text-muted-foreground/60">
            {selectedTools.length} tools · {selectedSkills.length} skills · {selectedMcp.length} MCP
          </span>
        </button>

        {showCapabilities && (
          <div className="mt-3 space-y-4">
            {/* Built-in tools */}
            <Card>
              <CardContent className="p-4">
                <p className="text-[13px] font-medium mb-2 flex items-center gap-2">
                  <Wrench size={13} /> Built-in Tools
                </p>
                <div className="grid grid-cols-2 gap-x-4">
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
                  <p className="text-[13px] font-medium mb-2 flex items-center gap-2">
                    <Sparkles size={13} /> Skills
                    <span className="text-xs text-muted-foreground font-normal">({eligibleSkills.length} available)</span>
                  </p>
                  <div className="grid grid-cols-2 gap-x-4">
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

            {/* MCP Servers */}
            {mcpServers.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <p className="text-[13px] font-medium mb-2 flex items-center gap-2">
                    <Plug size={13} /> MCP Servers
                    <span className="text-xs text-muted-foreground font-normal">({mcpServers.length} configured)</span>
                  </p>
                  <div className="grid grid-cols-2 gap-x-4">
                    {mcpServers.map((server) => (
                      <CheckboxItem
                        key={server}
                        checked={selectedMcp.includes(server)}
                        onChange={() => toggleMcp(server)}
                        label={server}
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={onSubmit} disabled={!isValid || submitting} className="gap-1">
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

function StepIndicator({ current, total }: { current: number; total: number }) {
  if (current === 0) return null; // no indicator on welcome
  const labels = ["LLM Key", "Tiers", "Telegram", "Voice", "Agent", "Done"];
  return (
    <div className="space-y-3">
      <Progress value={(current / total) * 100} className="h-1" />
      <div className="flex items-center justify-between">
        {labels.map((label, i) => {
          const stepNum = i + 1;
          const isActive = current === stepNum;
          const isComplete = current > stepNum;
          return (
            <div key={label} className={`flex items-center gap-1.5 text-xs ${isActive ? "text-[var(--brand-text)] font-medium" : isComplete ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${isActive ? "bg-[var(--brand)] text-[var(--primary-foreground)]" : isComplete ? "bg-[var(--brand-muted)] text-[var(--brand-text)]" : "bg-muted text-muted-foreground/40"}`}>
                {isComplete ? "✓" : stepNum}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Onboarding Page ──────────────────────────────

export default function OnboardingPage() {
  const [step, setStep] = useState(0);

  // Step 1: API Key
  const [apiKey, setApiKey] = useState("");

  // Step 2: Tiers
  const [tiers, setTiers] = useState(DEFAULT_TIERS);

  // Step 3: Telegram
  const [botToken, setBotToken] = useState("");
  const [ownerId, setOwnerId] = useState("");

  // Step 4: Voice
  const [groqApiKey, setGroqApiKey] = useState("");

  // Step 5: Agent
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentTier, setAgentTier] = useState("low");
  const [ownerName, setOwnerName] = useState("");
  const [ownerRole, setOwnerRole] = useState("");
  const [selectedTools, setSelectedTools] = useState<string[]>(
    BUILTIN_TOOLS.filter((t) => t.default).map((t) => t.id)
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedMcp, setSelectedMcp] = useState<string[]>([]);

  // Step 5: Done
  const [submitting, setSubmitting] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);

  async function handleCreateAgent() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openrouterApiKey: apiKey,
          tiers,
          telegram: {
            botToken,
            ownerId: ownerId ? parseInt(ownerId, 10) : 0,
          },
          groqApiKey: groqApiKey || undefined,
          ownerName: ownerName || undefined,
          ownerRole: ownerRole || undefined,
          agent: {
            name: agentName,
            description: agentDescription,
            tier: agentTier,
            tools: selectedTools,
            skills: selectedSkills,
            mcpServers: selectedMcp,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Setup failed");
        setSubmitting(false);
        return;
      }

      setSetupComplete(true);
      setStep(6);
    } catch (err) {
      toast.error("Setup failed — check your connection");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="w-full max-w-xl space-y-8">
        <StepIndicator current={step} total={TOTAL_STEPS} />

        {step === 0 && <StepWelcome onNext={() => setStep(1)} />}
        {step === 1 && <StepApiKey apiKey={apiKey} setApiKey={setApiKey} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <StepTiers tiers={tiers} setTiers={setTiers} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <StepTelegram botToken={botToken} setBotToken={setBotToken} ownerId={ownerId} setOwnerId={setOwnerId} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
        {step === 4 && <StepVoice groqApiKey={groqApiKey} setGroqApiKey={setGroqApiKey} onNext={() => setStep(5)} onBack={() => setStep(3)} />}
        {step === 5 && <StepAgent agentName={agentName} setAgentName={setAgentName} agentDescription={agentDescription} setAgentDescription={setAgentDescription} agentTier={agentTier} setAgentTier={setAgentTier} ownerName={ownerName} setOwnerName={setOwnerName} ownerRole={ownerRole} setOwnerRole={setOwnerRole} selectedTools={selectedTools} setSelectedTools={setSelectedTools} selectedSkills={selectedSkills} setSelectedSkills={setSelectedSkills} selectedMcp={selectedMcp} setSelectedMcp={setSelectedMcp} onSubmit={handleCreateAgent} onBack={() => setStep(4)} submitting={submitting} />}
        {step === 6 && <StepDone agentName={agentName} />}
      </div>
    </div>
  );
}
