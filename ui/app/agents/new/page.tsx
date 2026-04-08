"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { TextShimmer } from "@/components/motion-primitives/text-shimmer";
import { TierSelector } from "@/components/tier-selector";
import { ModelCombobox } from "@/components/model-combobox";
import { useFetch } from "@/lib/use-api";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowLeft,
  Bot,
  MessageSquare,
  Sparkles,
  Wrench,
  Plug,
  PenLine,
  CheckCircle2,
} from "lucide-react";
import type { OpenRouterModel } from "@/lib/types";

const TOTAL_STEPS = 5;
const STEP_LABELS = ["Identity", "Telegram", "Style", "Persona", "Done"];

const inputClass =
  "w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors";

import { BUILTIN_TOOLS } from "@/lib/tool-definitions";

// ── Shared Components ────────────────────────────────

function CheckboxItem({ checked, onChange, label, description, detail, security }: {
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
            className="pl-[26px] text-[10px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
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

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="space-y-3">
      <Progress value={(current / TOTAL_STEPS) * 100} className="h-1" />
      <div className="flex items-center justify-between">
        {STEP_LABELS.map((label, i) => {
          const isActive = current === i;
          const isComplete = current > i;
          return (
            <div key={label} className={`flex items-center gap-1.5 text-xs ${isActive ? "text-[var(--brand-text)] font-medium" : isComplete ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${isActive ? "bg-[var(--brand)] text-[var(--primary-foreground)]" : isComplete ? "bg-[var(--brand-muted)] text-[var(--brand-text)]" : "bg-muted text-muted-foreground/40"}`}>
                {isComplete ? "✓" : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 0: Identity ─────────────────────────────────

function StepIdentity({
  name, setName, description, setDescription,
  characterName, setCharacterName, ownerName, setOwnerName, role, setRole,
  model, setModel, reasoningEffort, setReasoningEffort,
  maxSteps, setMaxSteps, temperature, setTemperature,
  selectedTools, setSelectedTools, selectedSkills, setSelectedSkills,
  onNext, sanitizedName,
}: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  characterName: string; setCharacterName: (v: string) => void;
  ownerName: string; setOwnerName: (v: string) => void;
  role: string; setRole: (v: string) => void;
  model: string; setModel: (v: string) => void;
  reasoningEffort: string; setReasoningEffort: (v: string) => void;
  maxSteps: number; setMaxSteps: (v: number) => void;
  temperature: number; setTemperature: (v: number) => void;
  selectedTools: string[]; setSelectedTools: (v: string[]) => void;
  selectedSkills: string[]; setSelectedSkills: (v: string[]) => void;
  onNext: () => void;
  sanitizedName: string;
}) {
  const { data: modelsData } = useFetch<{ models: OpenRouterModel[] }>("/api/models");
  const { data: globalSettings } = useFetch<Record<string, string>>("/api/settings");
  const { data: skillsData } = useFetch<{ skills: { name: string; description: string; eligible: boolean }[] }>("/api/available-skills");
  const models = modelsData?.models;

  const tiers: Record<string, string> = (() => {
    try { return globalSettings?.["global.llm.tiers"] ? JSON.parse(globalSettings["global.llm.tiers"]) : {}; } catch { return {}; }
  })();
  const hasTiers = Object.keys(tiers).length > 0;

  const eligibleSkills = (skillsData?.skills || []).filter(s => s.eligible);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTool(id: string) { setSelectedTools(selectedTools.includes(id) ? selectedTools.filter(t => t !== id) : [...selectedTools, id]); }
  function toggleSkill(n: string) { setSelectedSkills(selectedSkills.includes(n) ? selectedSkills.filter(s => s !== n) : [...selectedSkills, n]); }

  function handleNext() {
    if (!sanitizedName) { setError("Name is required"); return; }
    if (!description) { setError("Description is required"); return; }
    if (!model) { setError("Model is required"); return; }
    setError(null);
    onNext();
  }

  const isValid = !!sanitizedName && !!description && !!model;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Create a new agent</h2>
        <p className="text-sm text-muted-foreground">
          Give your agent an identity and choose its model.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="agent-name" className="flex items-center gap-2">
              <Bot size={14} /> Agent Name
            </Label>
            <Input
              id="agent-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Atlas, Friday, Jarvis"
            />
            {name && sanitizedName !== name && (
              <p className="text-[10px] text-muted-foreground">ID: <code className="font-mono">{sanitizedName}</code></p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-desc">What should this agent do?</Label>
            <textarea
              id="agent-desc"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g., Personal assistant for task management, research, and scheduling"
              rows={3}
              className={`${inputClass} resize-y`}
            />
          </div>

          <div className="space-y-2">
            {hasTiers ? (
              <TierSelector
                value={model}
                onChange={setModel}
                tiers={tiers}
                label="Model Tier"
                allowOverride
                models={models}
              />
            ) : (
              <ModelCombobox
                value={model}
                onChange={setModel}
                models={models}
                label="Model"
              />
            )}
          </div>

          {/* Optional identity fields */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Character Name</Label>
              <Input value={characterName} onChange={e => setCharacterName(e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Agent Role</Label>
              <Input value={role} onChange={e => setRole(e.target.value)} placeholder="personal assistant" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Owner Name</Label>
              <Input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="the user" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Advanced settings (collapsible) */}
      <div>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAdvanced ? "Hide advanced settings" : "Advanced settings (optional)"}
        </button>
        {showAdvanced && (
          <Card className="mt-3">
            <CardContent className="p-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Reasoning Effort</Label>
                  <select value={reasoningEffort} onChange={e => setReasoningEffort(e.target.value)} className={inputClass}>
                    <option value="xhigh">xhigh</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                    <option value="minimal">minimal</option>
                    <option value="none">none</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Max Steps</Label>
                  <Input type="number" value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))} min={1} max={100} className="font-mono tabular-nums" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Temperature</Label>
                  <Input type="number" value={temperature} onChange={e => setTemperature(Number(e.target.value))} min={0} max={2} step={0.1} className="font-mono tabular-nums" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* What can your agent do? */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-[15px] font-semibold">What can your agent do?</h3>
          <p className="text-xs text-muted-foreground">
            Choose what your agent is allowed to do. You can change these later in Settings.
          </p>
        </div>

        <Card>
          <CardContent className="p-4">
            <p className="text-[13px] font-medium mb-3 flex items-center gap-2">
              <Wrench size={13} /> Tools
              <span className="text-xs text-muted-foreground font-normal">
                ({selectedTools.length} of {BUILTIN_TOOLS.length} selected)
              </span>
            </p>
            <div className="space-y-1">
              {BUILTIN_TOOLS.map(tool => (
                <CheckboxItem key={tool.id} checked={selectedTools.includes(tool.id)} onChange={() => toggleTool(tool.id)} label={tool.label} description={tool.description} detail={tool.detail} security={tool.security} />
              ))}
            </div>
          </CardContent>
        </Card>

        {eligibleSkills.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-[13px] font-medium mb-3 flex items-center gap-2">
                <Sparkles size={13} /> Skills
                <span className="text-xs text-muted-foreground font-normal">({eligibleSkills.length} available)</span>
              </p>
              <div className="space-y-1">
                {eligibleSkills.map(skill => (
                  <CheckboxItem key={skill.name} checked={selectedSkills.includes(skill.name)} onChange={() => toggleSkill(skill.name)} label={skill.name} description={skill.description} />
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
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={() => window.location.href = "/agents"} className="gap-1">
          Cancel
        </Button>
        <Button onClick={handleNext} disabled={!isValid} className="gap-1">
          Next <ArrowRight size={14} />
        </Button>
      </div>
    </div>
  );
}

// ── Step 1: Telegram ─────────────────────────────────

function StepTelegram({
  botToken, setBotToken, ownerId, setOwnerId, onNext, onBack,
}: {
  botToken: string; setBotToken: (v: string) => void;
  ownerId: string; setOwnerId: (v: string) => void;
  onNext: () => void; onBack: () => void;
}) {
  const isValid = botToken.includes(":") && botToken.length > 30;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Connect a Telegram bot</h2>
        <p className="text-sm text-muted-foreground">
          Each agent gets its own Telegram bot. Create one now or configure later.
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
              <MessageSquare size={14} /> Bot Token
            </Label>
            <Input
              id="bot-token"
              type="password"
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
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
              onChange={e => setOwnerId(e.target.value)}
              placeholder="Leave blank to auto-detect"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank — your ID will be captured automatically when you send your first message.
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

// ── Step 2: Response Style ───────────────────────────

function StepStyle({
  responseLength, setResponseLength,
  agency, setAgency,
  tone, setTone,
  format, setFormat,
  language, setLanguage,
  customInstructions, setCustomInstructions,
  onNext, onBack,
}: {
  responseLength: string; setResponseLength: (v: string) => void;
  agency: string; setAgency: (v: string) => void;
  tone: string; setTone: (v: string) => void;
  format: string; setFormat: (v: string) => void;
  language: string; setLanguage: (v: string) => void;
  customInstructions: string; setCustomInstructions: (v: string) => void;
  onNext: () => void; onBack: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Response style</h2>
        <p className="text-sm text-muted-foreground">
          Control how your agent communicates. These become part of the system prompt and can be changed later.
        </p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Response Length</Label>
              <select value={responseLength} onChange={e => setResponseLength(e.target.value)} className={inputClass}>
                <option value="brief">Brief</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Agency</Label>
              <select value={agency} onChange={e => setAgency(e.target.value)} className={inputClass}>
                <option value="execute_first">Execute first</option>
                <option value="ask_before_acting">Ask before acting</option>
                <option value="consultative">Consultative</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Tone</Label>
              <select value={tone} onChange={e => setTone(e.target.value)} className={inputClass}>
                <option value="casual">Casual</option>
                <option value="balanced">Balanced</option>
                <option value="professional">Professional</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Format</Label>
              <select value={format} onChange={e => setFormat(e.target.value)} className={inputClass}>
                <option value="texting">Texting</option>
                <option value="conversational">Conversational</option>
                <option value="structured">Structured</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Language</Label>
            <select value={language} onChange={e => setLanguage(e.target.value)} className={inputClass}>
              <option value="english">English</option>
              <option value="hebrew">Hebrew</option>
              <option value="auto_detect">Auto-detect</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Custom Instructions</Label>
            <textarea
              value={customInstructions}
              onChange={e => setCustomInstructions(e.target.value)}
              rows={2}
              placeholder="e.g., Always include calorie counts when discussing meals"
              className={`${inputClass} resize-y`}
            />
          </div>
        </CardContent>
      </Card>

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

// ── Step 3: Persona ──────────────────────────────────

const PERSONA_TEMPLATE = `## Identity

You are [Agent Name]. [Brief description of what you do.]

## Boundaries

- Only perform actions within your defined capabilities
- Ask for clarification when instructions are ambiguous

## Notes

- [Domain-specific notes here]
`;

const MEMORY_TEMPLATE = `# Working Memory

## User Preferences
- Communication style: (discovered)
- Preferred format: (discovered)
- Frequency: (discovered)

## Context
- Owner: (discovered)
- Recent topics: (updated automatically)

## Reflection
- Patterns noticed: (updated over time)
- Things to improve: (updated over time)
- Lessons learned: (updated over time)
`;

function StepPersona({
  name, description, role, behavior,
  persona, setPersona, memoryTemplate, setMemoryTemplate,
  onNext, onBack,
}: {
  name: string; description: string; role: string;
  behavior: { responseLength: string; agency: string; tone: string; format: string; language: string };
  persona: string; setPersona: (v: string) => void;
  memoryTemplate: string; setMemoryTemplate: (v: string) => void;
  onNext: () => void; onBack: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/platform/agents/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, role: role || undefined, behavior }),
      });
      if (!res.ok) {
        toast.error("Generation failed — try again or write manually");
        setGenerating(false);
        return;
      }
      const data = await res.json();
      setPersona(data.persona || "");
      setMemoryTemplate(data.memoryTemplate || "");
      setGenerated(true);
    } catch {
      toast.error("Generation failed");
    }
    setGenerating(false);
  }

  function handleManual() {
    setPersona(
      PERSONA_TEMPLATE
        .replace("[Agent Name]", name)
        .replace("[Brief description of what you do.]", description),
    );
    setMemoryTemplate(MEMORY_TEMPLATE);
    setGenerated(true);
  }

  const canProceed = persona.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Generate persona</h2>
        <p className="text-sm text-muted-foreground">
          Create a persona for <span className="text-foreground font-medium">{name}</span> using AI, or write one from scratch.
        </p>
      </div>

      {!generated ? (
        <div className="flex flex-col items-center justify-center min-h-[200px] space-y-8">
          <Button onClick={handleGenerate} disabled={generating} size="lg" className="h-14 px-8 text-sm gap-2">
            <Sparkles size={18} />
            {generating ? (
              <TextShimmer className="text-sm" duration={1.5}>Crafting persona...</TextShimmer>
            ) : (
              "Generate Persona"
            )}
          </Button>
          <button
            onClick={handleManual}
            disabled={generating}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <PenLine size={12} /> or write it manually
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <Label className="text-xs text-muted-foreground">Persona</Label>
              <textarea
                value={persona}
                onChange={e => setPersona(e.target.value)}
                rows={10}
                className={`${inputClass} font-mono text-xs resize-y`}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-3">
              <Label className="text-xs text-muted-foreground">Memory Template</Label>
              <textarea
                value={memoryTemplate}
                onChange={e => setMemoryTemplate(e.target.value)}
                rows={8}
                className={`${inputClass} font-mono text-xs resize-y`}
              />
            </CardContent>
          </Card>
          <button
            onClick={() => { setGenerated(false); setPersona(""); setMemoryTemplate(""); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Regenerate or start over
          </button>
        </div>
      )}

      <div className="flex items-center justify-between pt-4">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ArrowLeft size={14} /> Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed} className="gap-1">
          {canProceed ? <>Create Agent <Sparkles size={14} /></> : "Next"}
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: Done ─────────────────────────────────────

function StepDone({
  agentName, agentId, config, persona, memoryTemplate, behavior, onBack,
}: {
  agentName: string;
  agentId: string;
  config: Record<string, unknown>;
  persona: string;
  memoryTemplate: string;
  behavior: { responseLength: string; agency: string; tone: string; format: string; language: string; customInstructions: string };
  onBack: () => void;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startedRef = useRef(false);

  useEffect(() => {
    // Guard against React strict mode double-mount
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    async function createAndRestart() {
      try {
        // 1. Create agent
        const res = await fetch("/api/platform/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...config, persona, memoryTemplate }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Failed to create agent (${res.status})`);
          return;
        }

        // 2. Save behavior settings
        await fetch(`/api/platform/agents/${agentId}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            "behavior.responseLength": behavior.responseLength,
            "behavior.agency": behavior.agency,
            "behavior.tone": behavior.tone,
            "behavior.format": behavior.format,
            "behavior.language": behavior.language,
            "behavior.customInstructions": behavior.customInstructions,
          }),
        }).catch(() => { /* non-critical */ });

        // 3. Restart + poll health
        const restartRes = await fetch("/api/restart", { method: "POST" });
        if (!restartRes.ok) {
          // Restart not available (e.g., not running via launchd) — agent is created but won't load until manual restart
          setError("Agent created, but automatic restart is not available. Restart the platform manually to load the new agent.");
          return;
        }
        for (let i = 0; i < 30; i++) {
          if (cancelled) return;
          await new Promise(r => setTimeout(r, 2000));
          try {
            const h = await fetch("/api/health");
            if (h.ok) { setReady(true); return; }
          } catch { /* still down */ }
        }
        setError("Platform restart timed out — check manually");
      } catch (e) {
        setError(String(e));
      }
    }

    createAndRestart();
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
          <span className="text-destructive text-2xl">!</span>
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Something went wrong</h2>
          <p className="text-sm text-muted-foreground max-w-md">{error}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={onBack} variant="outline" className="gap-1">
            <ArrowLeft size={14} /> Go Back
          </Button>
          <Button onClick={() => router.push("/agents")} variant="outline" className="gap-1">
            Go to Agents
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-6">
      {!ready ? (
        <>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--brand-muted)]">
            <Sparkles size={28} className="text-[var(--brand-text)]" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold">
              <TextShimmer duration={2}>Creating agent...</TextShimmer>
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
            </p>
          </div>
          <Button onClick={() => router.push(`/agents/${agentId}`)} size="lg" className="gap-2 h-12 px-8">
            Go to Agent <ArrowRight size={16} />
          </Button>
        </>
      )}
    </div>
  );
}

// ── Main Wizard ──────────────────────────────────────

export default function NewAgentWizard() {
  const [step, setStep] = useState(0);

  // Identity
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [role, setRole] = useState("");
  const [model, setModel] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [maxSteps, setMaxSteps] = useState(50);
  const [temperature, setTemperature] = useState(0.2);

  // Telegram
  const [botToken, setBotToken] = useState("");
  const [ownerId, setOwnerId] = useState("");

  // Capabilities
  const [selectedTools, setSelectedTools] = useState<string[]>(
    BUILTIN_TOOLS.filter(t => t.default).map(t => t.id),
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // Style
  const [responseLength, setResponseLength] = useState("balanced");
  const [agency, setAgency] = useState("execute_first");
  const [tone, setTone] = useState("balanced");
  const [format, setFormat] = useState("conversational");
  const [language, setLanguage] = useState("auto_detect");
  const [customInstructions, setCustomInstructions] = useState("");

  // Persona
  const [persona, setPersona] = useState("");
  const [memoryTemplate, setMemoryTemplate] = useState("");

  // Fetch global settings for tier resolution
  const { data: globalSettings } = useFetch<Record<string, string>>("/api/settings");
  const tiers: Record<string, string> = (() => {
    try { return globalSettings?.["global.llm.tiers"] ? JSON.parse(globalSettings["global.llm.tiers"]) : {}; } catch { return {}; }
  })();

  const sanitizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const displayName = characterName || (sanitizedName ? sanitizedName.charAt(0).toUpperCase() + sanitizedName.slice(1).replace(/-/g, " ") : "Agent");

  // Build config object for agent creation
  const agentConfig = {
    id: sanitizedName,
    name: displayName,
    description,
    characterName: characterName || undefined,
    ownerName: ownerName || undefined,
    role: role || undefined,
    model: tiers[model] || model,
    modelTier: model in tiers ? model : undefined,
    reasoningEffort,
    maxSteps,
    temperature,
    botToken: botToken || `\${${sanitizedName.toUpperCase().replace(/-/g, "_")}_BOT_TOKEN}`,
    ownerId: ownerId ? parseInt(ownerId, 10) : 0,
    tools: selectedTools,
    skills: selectedSkills,
    mcpServers: [],
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="w-full max-w-xl space-y-8">
        <StepIndicator current={step} />

        {step === 0 && (
          <StepIdentity
            name={name} setName={setName}
            description={description} setDescription={setDescription}
            characterName={characterName} setCharacterName={setCharacterName}
            ownerName={ownerName} setOwnerName={setOwnerName}
            role={role} setRole={setRole}
            model={model} setModel={setModel}
            reasoningEffort={reasoningEffort} setReasoningEffort={setReasoningEffort}
            maxSteps={maxSteps} setMaxSteps={setMaxSteps}
            temperature={temperature} setTemperature={setTemperature}
            selectedTools={selectedTools} setSelectedTools={setSelectedTools}
            selectedSkills={selectedSkills} setSelectedSkills={setSelectedSkills}
            onNext={() => setStep(1)}
            sanitizedName={sanitizedName}
          />
        )}

        {step === 1 && (
          <StepTelegram
            botToken={botToken} setBotToken={setBotToken}
            ownerId={ownerId} setOwnerId={setOwnerId}
            onNext={() => setStep(2)} onBack={() => setStep(0)}
          />
        )}

        {step === 2 && (
          <StepStyle
            responseLength={responseLength} setResponseLength={setResponseLength}
            agency={agency} setAgency={setAgency}
            tone={tone} setTone={setTone}
            format={format} setFormat={setFormat}
            language={language} setLanguage={setLanguage}
            customInstructions={customInstructions} setCustomInstructions={setCustomInstructions}
            onNext={() => setStep(3)} onBack={() => setStep(1)}
          />
        )}

        {step === 3 && (
          <StepPersona
            name={displayName} description={description} role={role}
            behavior={{ responseLength, agency, tone, format, language }}
            persona={persona} setPersona={setPersona}
            memoryTemplate={memoryTemplate} setMemoryTemplate={setMemoryTemplate}
            onNext={() => setStep(4)} onBack={() => setStep(2)}
          />
        )}

        {step === 4 && (
          <StepDone
            agentName={displayName}
            agentId={sanitizedName}
            config={agentConfig}
            persona={persona}
            memoryTemplate={memoryTemplate}
            behavior={{ responseLength, agency, tone, format, language, customInstructions }}
            onBack={() => setStep(0)}
          />
        )}
      </div>
    </div>
  );
}
