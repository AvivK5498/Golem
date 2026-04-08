"use client";

import { useFetch } from "@/lib/use-api";
import { use, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { PageHeader } from "@/components/page-header";
import { AutoTextarea } from "@/components/auto-textarea";
import { ModelCombobox } from "@/components/model-combobox";
import { toast } from "sonner";
import { useRestartRequired } from "@/lib/use-restart-required";
import type { OpenRouterModel, CronJob } from "@/lib/types";

interface AgentDetail {
  config: {
    id: string;
    name: string;
    description: string;
    characterName?: string;
    ownerName?: string;
    role?: string;
    enabled: boolean;
    transport: { platform: string; botToken: string; ownerId: number };
    llm: { provider: string; model: string; temperature: number; maxSteps: number; vision?: { model: string } };
    memory: {
      lastMessages: number;
      workingMemory?: { enabled: boolean; scope: string };
    };
    tools: string[];
    skills?: string[];
    mcpServers: string[];
    allowedGroups: string[];
    adminGroups: string[];
  };
  persona: string;
  memoryTemplate: string;
  subAgents: { agents: Record<string, SubAgentEntry>; defaults?: { instructions?: string } };
}

interface SubAgentEntry {
  description?: string;
  model?: string;
  instructions?: string;
  tools?: string[];
  skills?: string[];
  maxSteps?: number;
  temperature?: number;
  reasoningEffort?: string;
}

const inputClass =
  "w-full bg-card/60 border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-muted-foreground transition-colors";
const labelClass = "text-[10px] text-muted-foreground";
const numberInputClass =
  "w-24 bg-card/60 border border-border rounded-md px-3 py-1.5 text-xs text-foreground tabular-nums outline-none focus:border-muted-foreground";

interface PromptSection {
  label: string;
  content: string;
  editable?: boolean;
}

interface WebhookScenario {
  name: string;
  when: string;
  then: string;
  enabled: boolean;
  allowUnauthenticated?: boolean;
}

type TabId = "identity" | "model" | "memory" | "tools" | "subagents" | "crons" | "webhooks" | "telegram" | "proactive" | "runtime";

const NAV_GROUPS: { label: string; items: { id: TabId; label: string }[] }[] = [
  {
    label: "General",
    items: [
      { id: "identity", label: "Identity" },
      { id: "model", label: "Model" },
      { id: "memory", label: "Memory" },
    ],
  },
  {
    label: "Capabilities",
    items: [
      { id: "tools", label: "Tools / MCP / Skills" },
      { id: "subagents", label: "Sub-agents" },
      { id: "crons", label: "Crons" },
    ],
  },
  {
    label: "Integrations",
    items: [
      { id: "webhooks", label: "Webhooks" },
      { id: "telegram", label: "Telegram" },
    ],
  },
  {
    label: "Behavior",
    items: [
      { id: "proactive", label: "Proactive" },
    ],
  },
  {
    label: "Runtime",
    items: [
      { id: "runtime", label: "Settings" },
    ],
  },
];

/** Displays the full prompt in labeled sections -- platform (read-only) + persona (editable) */
function PromptSections({ agentId, persona, onPersonaChange, onSavePersona, subAgents, identity }: {
  agentId: string;
  persona: string;
  onPersonaChange: (v: string) => void;
  onSavePersona: () => void;
  subAgents: [string, SubAgentEntry][];
  identity: { name: string; characterName: string; ownerName: string; role: string };
}) {
  const { data } = useFetch<{ sections: PromptSection[] }>(
    `/api/platform/agents/${agentId}/prompt`,
  );

  const sections = data?.sections || [];

  // Build accordion value keys: editable sections use "persona", others use kebab label
  const sectionKey = (label: string, editable?: boolean) =>
    editable ? "persona" : label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <Accordion defaultValue={["persona", "delegation"]} className="space-y-3">
      {sections.map((section, i) => {
        const key = sectionKey(section.label, section.editable);
        if (section.editable) {
          return (
            <AccordionItem key={i} value={key} className="rounded-xl border border-border/60 bg-card/70 px-0">
              <AccordionTrigger className="px-5 py-4 text-left text-sm font-semibold hover:no-underline">
                <span className="flex items-center gap-2">
                  {section.label}
                  <span className="text-[10px] font-normal text-muted-foreground">editable</span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-5 pb-5">
                <div className="space-y-3">
                  <AutoTextarea value={persona} onChange={e => onPersonaChange(e.target.value)} minRows={8} maxHeight={600} className="font-mono text-[11px]" />
                  <Button onClick={onSavePersona} size="sm">Save Persona</Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        }
        // Live-preview the Opening section from current identity fields
        const content = section.label === "Opening"
          ? `You have emerged, you are now ${identity.characterName || identity.name || "Agent"}, ${identity.ownerName || "the user"}'s ${identity.role || "personal assistant"}.\nBefore we get into requests and details here are a few guidelines you must adhere to.`
          : section.content;
        return (
          <AccordionItem key={i} value={key} className="rounded-xl border border-border/60 bg-card/70 px-0">
            <AccordionTrigger className="px-5 py-4 text-left text-sm font-semibold hover:no-underline">
              {section.label}
            </AccordionTrigger>
            <AccordionContent className="px-5 pb-5">
              <pre className="whitespace-pre-wrap font-mono text-[12px] leading-5 text-muted-foreground">{content}</pre>
            </AccordionContent>
          </AccordionItem>
        );
      })}

      {/* Delegation (auto-generated from sub-agents) */}
      {subAgents.length > 0 && (
        <AccordionItem value="delegation" className="rounded-xl border border-border/60 bg-card/70 px-0">
          <AccordionTrigger className="px-5 py-4 text-left text-sm font-semibold hover:no-underline">
            <span className="flex items-center gap-2">
              Delegation -- {subAgents.length} sub-agents
              <span className="text-[10px] font-normal text-muted-foreground">auto-generated</span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-5 pb-5">
            <div className="space-y-1">
              {subAgents.map(([name, sa]) => (
                <div key={name} className="flex items-baseline gap-2 text-[11px]">
                  <span className="text-foreground font-mono shrink-0">{name}</span>
                  <span className="text-muted-foreground">--</span>
                  <span className="text-muted-foreground truncate">{sa.description || "No description"}</span>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground mt-2">
                Delegation table is auto-injected into the prompt from sub-agents.yaml
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );
}

// ── Webhook Scenarios Tab ────────────────────────────────────

function WebhookScenariosTab({ agentId, scenariosData, refetchScenarios }: {
  agentId: string;
  scenariosData: { sources: Record<string, WebhookScenario[]> } | null;
  refetchScenarios: () => void;
}) {
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [newSourceName, setNewSourceName] = useState("");
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<WebhookScenario>({ name: "", when: "", then: "", enabled: true });
  const [saving, setSaving] = useState(false);

  const sources = scenariosData?.sources || {};
  const sourceNames = Object.keys(sources).sort();
  const selected = activeSource && sources[activeSource] ? activeSource : sourceNames[0] || null;
  const scenarios = selected ? sources[selected] || [] : [];

  // Fetch last payload for field discovery
  const { data: lastPayloadData } = useFetch<{ payload: Record<string, unknown> | null; fields: string[] }>(
    selected ? `/api/platform/agents/${agentId}/webhook-last-payload/${selected}` : "",
  );
  const payloadFields: string[] = lastPayloadData?.fields ?? [];

  const webhookPath = `/hooks/${agentId}/${selected || "<source>"}`;

  async function saveScenarios(source: string, updated: WebhookScenario[]) {
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agents/${agentId}/webhook-scenarios/${source}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        refetchScenarios();
        toast.success("Scenarios saved");
      } else {
        toast.error("Failed to save scenarios");
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteSource(source: string) {
    const res = await fetch(`/api/platform/agents/${agentId}/webhook-scenarios/${source}`, { method: "DELETE" });
    if (res.ok) {
      refetchScenarios();
      setActiveSource(null);
      toast.success(`Source "${source}" deleted`);
    } else {
      toast.error("Failed to delete source");
    }
  }

  function addSource() {
    const name = newSourceName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!name) return;
    if (sources[name]) { toast.error("Source already exists"); return; }
    saveScenarios(name, []);
    setActiveSource(name);
    setNewSourceName("");
  }

  function startAdd() {
    setEditingIdx(-1);
    setEditForm({ name: "", when: "", then: "", enabled: true });
  }

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setEditForm({ ...scenarios[idx] });
  }

  function cancelEdit() {
    setEditingIdx(null);
  }

  function saveEdit() {
    if (!selected || !editForm.name.trim()) return;
    const updated = [...scenarios];
    if (editingIdx === -1) {
      updated.push(editForm);
    } else if (editingIdx !== null) {
      updated[editingIdx] = editForm;
    }
    saveScenarios(selected, updated);
    setEditingIdx(null);
  }

  function deleteScenario(idx: number) {
    if (!selected) return;
    const updated = scenarios.filter((_, i) => i !== idx);
    saveScenarios(selected, updated);
  }

  function toggleEnabled(idx: number) {
    if (!selected) return;
    const updated = [...scenarios];
    updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled };
    saveScenarios(selected, updated);
  }

  function toggleAllowUnauth(idx: number) {
    if (!selected) return;
    const updated = [...scenarios];
    updated[idx] = { ...updated[idx], allowUnauthenticated: !updated[idx].allowUnauthenticated };
    saveScenarios(selected, updated);
  }

  if (!scenariosData) return <p className="text-[10px] text-muted-foreground">Loading...</p>;

  return (
    <>
      {/* Source selector */}
      <Card size="sm">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs">Webhook Sources</CardTitle>
            <div className="flex items-center gap-2">
              <input
                value={newSourceName}
                onChange={e => setNewSourceName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addSource()}
                placeholder="new-source"
                className={`${inputClass} w-32 !py-1 !text-[11px]`}
              />
              <Button size="sm" variant="outline" onClick={addSource} className="h-6 text-[10px] px-2">
                Add
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {sourceNames.length === 0 ? (
            <p className="text-[10px] text-muted-foreground py-2">No webhook sources configured. Add one above.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sourceNames.map(src => (
                <button
                  key={src}
                  onClick={() => setActiveSource(src)}
                  className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                    selected === src
                      ? "bg-muted text-foreground border-border font-medium"
                      : "text-muted-foreground border-transparent hover:bg-muted/50 hover:border-border/50"
                  }`}
                >
                  {src}
                  <span className="text-[9px] text-muted-foreground">({(sources[src] || []).length})</span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scenarios for selected source */}
      {selected && (
        <>
          <Card size="sm">
            <CardHeader className="border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs">{selected} scenarios</CardTitle>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={startAdd} className="h-6 text-[10px] px-2">
                    + Add Scenario
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => deleteSource(selected)} className="h-6 text-[10px] px-2 text-destructive hover:text-destructive">
                    Delete Source
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {scenarios.length === 0 && editingIdx === null && (
                <p className="text-[10px] text-muted-foreground py-2">No scenarios yet. Add one to start routing webhooks.</p>
              )}

              {scenarios.map((s, idx) => (
                <div key={idx} className={`rounded-lg border p-3 space-y-2 ${s.enabled ? "border-border" : "border-border/40 opacity-60"}`}>
                  {editingIdx === idx ? (
                    <ScenarioEditForm form={editForm} setForm={setEditForm} onSave={saveEdit} onCancel={cancelEdit} saving={saving} fields={payloadFields} />
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{s.name}</span>
                          {!s.enabled && <Badge variant="outline" className="text-[9px]">disabled</Badge>}
                          {s.allowUnauthenticated && <Badge variant="outline" className="text-[9px] border-[var(--status-warning)]/40 text-[var(--status-warning)]">no auth</Badge>}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => toggleEnabled(idx)} className="h-5 text-[9px] px-1.5">
                            {s.enabled ? "Disable" : "Enable"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => toggleAllowUnauth(idx)} className="h-5 text-[9px] px-1.5">
                            {s.allowUnauthenticated ? "Require Auth" : "Allow Unauth"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => startEdit(idx)} className="h-5 text-[9px] px-1.5">
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteScenario(idx)} className="h-5 text-[9px] px-1.5 text-destructive hover:text-destructive">
                            Delete
                          </Button>
                        </div>
                      </div>
                      <div className="text-[10px] space-y-1">
                        <p><span className="text-muted-foreground">When:</span> {s.when}</p>
                        <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Then:</span> {s.then}</p>
                      </div>
                    </>
                  )}
                </div>
              ))}

              {/* Inline add form */}
              {editingIdx === -1 && (
                <div className="rounded-lg border border-dashed border-border p-3">
                  <ScenarioEditForm form={editForm} setForm={setEditForm} onSave={saveEdit} onCancel={cancelEdit} saving={saving} fields={payloadFields} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Webhook URL */}
          <Card size="sm">
            <CardHeader className="border-b">
              <CardTitle className="text-xs">Webhook URL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] font-mono text-muted-foreground bg-card/60 border border-border rounded-md px-3 py-2 select-all">
                  {webhookPath}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px] px-2 shrink-0"
                  onClick={() => { navigator.clipboard.writeText(webhookPath); toast.success("Copied"); }}
                >
                  Copy
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                POST JSON payload. Auth via <code className="text-[10px]">Authorization: Bearer &lt;token&gt;</code> or <code className="text-[10px]">X-Golem-Token</code> header.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

const BUILTIN_FIELDS = [
  { path: "_raw", desc: "Full JSON payload" },
  { path: "_source", desc: "Source name" },
  { path: "_agent", desc: "Agent ID" },
  { path: "_today", desc: "Today's date (YYYY-MM-DD)" },
  { path: "_now", desc: "Current ISO timestamp" },
];

function ScenarioEditForm({ form, setForm, onSave, onCancel, saving, fields }: {
  form: WebhookScenario;
  setForm: (f: WebhookScenario) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  fields: string[];
}) {
  const safeFields = fields ?? [];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [fieldsOpen, setFieldsOpen] = useState(false);

  function insertField(fieldPath: string) {
    const ta = textareaRef.current;
    const tag = `{{${fieldPath}}}`;
    if (ta) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const before = form.then.slice(0, start);
      const after = form.then.slice(end);
      setForm({ ...form, then: before + tag + after });
      // Restore cursor after the inserted tag
      requestAnimationFrame(() => {
        ta.focus();
        ta.selectionStart = ta.selectionEnd = start + tag.length;
      });
    } else {
      setForm({ ...form, then: form.then + tag });
    }
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className={labelClass}>Scenario Name</label>
        <input
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder="Build Failed"
          className={`${inputClass} !text-[11px]`}
        />
      </div>
      <div className="space-y-1">
        <label className={labelClass}>When (natural language condition)</label>
        <input
          value={form.when}
          onChange={e => setForm({ ...form, when: e.target.value })}
          placeholder="a Docker build fails or errors"
          className={`${inputClass} !text-[11px]`}
        />
      </div>
      <div className="space-y-1">
        <label className={labelClass}>Then (prompt template)</label>
        <textarea
          ref={textareaRef}
          value={form.then}
          onChange={e => setForm({ ...form, then: e.target.value })}
          placeholder={"This is an automated webhook from {{_source}}.\n\n{{_raw}}"}
          rows={4}
          className={`${inputClass} !text-[11px] resize-y font-mono`}
        />
      </div>

      {/* Field picker */}
      <div>
        <button
          type="button"
          onClick={() => setFieldsOpen(!fieldsOpen)}
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {fieldsOpen ? "▾" : "▸"} Insert field {safeFields.length > 0 && <span className="text-muted-foreground/60">({safeFields.length} from last payload)</span>}
        </button>
        {fieldsOpen && (
          <div className="mt-1.5 rounded-md border border-border bg-card/60 p-2 space-y-1.5">
            {/* Built-in variables */}
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Built-in</p>
            <div className="flex flex-wrap gap-1">
              {BUILTIN_FIELDS.map(f => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => insertField(f.path)}
                  title={f.desc}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border hover:bg-muted hover:text-foreground text-muted-foreground transition-colors"
                >
                  {`{{${f.path}}}`}
                </button>
              ))}
            </div>

            {/* Payload fields */}
            {safeFields.length > 0 ? (
              <>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-2">Payload fields</p>
                <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                  {safeFields.map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => insertField(f)}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border hover:bg-muted hover:text-foreground text-muted-foreground transition-colors"
                    >
                      {`{{${f}}}`}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[9px] text-muted-foreground italic mt-1">
                Payload fields appear here after the first webhook is received.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={e => setForm({ ...form, enabled: e.target.checked })}
            className="rounded border-border bg-accent"
          />
          <span className="text-[10px] text-muted-foreground">Enabled</span>
        </label>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} className="h-6 text-[10px] px-2">Cancel</Button>
          <Button size="sm" onClick={onSave} disabled={saving || !form.name.trim()} className="h-6 text-[10px] px-3">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-Agents Editor ────────────────────────────────────────

function SubAgentsEditor({ agentId, subAgentsData, models, availableTools, availableSkills, mcpTools }: {
  agentId: string;
  subAgentsData: { agents: Record<string, SubAgentEntry>; defaults?: { instructions?: string } };
  models?: OpenRouterModel[];
  availableTools?: string[];
  availableSkills?: Array<{ name: string; eligible: boolean }>;
  mcpTools?: Record<string, string[]>;
}) {
  const [agents, setAgents] = useState<Record<string, SubAgentEntry>>(subAgentsData?.agents || {});
  const [defaults, setDefaults] = useState(subAgentsData?.defaults || { instructions: "Complete the task and return results only." });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [saving, setSaving] = useState(false);

  const agentIds = Object.keys(agents);

  function updateAgent(id: string, patch: Partial<SubAgentEntry>) {
    setAgents(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function deleteAgent(id: string) {
    setAgents(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (expandedId === id) setExpandedId(null);
  }

  const [newIdError, setNewIdError] = useState("");

  function addAgent() {
    const id = newId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!id) { setNewIdError("Enter a name first"); return; }
    if (agents[id]) { setNewIdError(`"${id}" already exists`); return; }
    setNewIdError("");
    setAgents(prev => ({
      ...prev,
      [id]: { description: "", model: "google/gemini-3-flash-preview", instructions: "", tools: [], skills: [], maxSteps: 10 },
    }));
    setExpandedId(id);
    setNewId("");
  }

  async function saveAll() {
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agents/${agentId}/sub-agents`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents, defaults }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.reloaded ? "Sub-agents saved and reloaded" : "Sub-agents saved");
      } else {
        toast.error("Failed to save");
      }
    } finally {
      setSaving(false);
    }
  }

  function toggleTool(agentId: string, tool: string) {
    const current = agents[agentId]?.tools || [];
    const next = current.includes(tool) ? current.filter(t => t !== tool) : [...current, tool];
    updateAgent(agentId, { tools: next });
  }

  function toggleSkill(agentId: string, skill: string) {
    const current = agents[agentId]?.skills || [];
    const next = current.includes(skill) ? current.filter(s => s !== skill) : [...current, skill];
    updateAgent(agentId, { skills: next });
  }

  return (
    <>
      <Card size="sm">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-xs">Sub-agents</CardTitle>
              <span className="text-[10px] text-muted-foreground">({agentIds.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    value={newId}
                    onChange={e => { setNewId(e.target.value); setNewIdError(""); }}
                    onKeyDown={e => e.key === "Enter" && addAgent()}
                    placeholder="new-agent-id"
                    className={`${inputClass} w-36 !py-1 !text-[11px] ${newIdError ? "!border-destructive" : ""}`}
                  />
                  {newIdError && <p className="absolute -bottom-4 left-0 text-[9px] text-destructive whitespace-nowrap">{newIdError}</p>}
                </div>
                <Button size="sm" variant="outline" onClick={addAgent} className="h-6 text-[10px] px-2">
                  Add
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {agentIds.length === 0 && (
            <p className="text-[10px] text-muted-foreground py-2">No sub-agents. Add one above.</p>
          )}
          {agentIds.map(saId => {
            const sa = agents[saId];
            const isExpanded = expandedId === saId;
            return (
              <div key={saId} className="border border-border/60 rounded-md overflow-hidden">
                {/* Header — always visible */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : saId)}
                  className="w-full flex items-center justify-between p-3 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{isExpanded ? "▾" : "▸"}</span>
                    <span className="text-xs font-medium">{saId}</span>
                    {sa.model && (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground border-border font-mono truncate max-w-[200px]">
                        {sa.model}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{sa.tools?.length || 0} tools</span>
                    {sa.skills && sa.skills.length > 0 && <span>{sa.skills.length} skills</span>}
                    <span>{sa.maxSteps || 10} steps</span>
                  </div>
                </button>

                {/* Expanded editor */}
                {isExpanded && (() => {
                  const mcpServers = Object.keys(mcpTools || {});
                  const regularTools = (availableTools || []).filter(t =>
                    !mcpServers.some(s => t.startsWith(`${s}_`))
                  );
                  return (
                  <div className="border-t border-border/60 p-3 space-y-4 bg-card/30">
                    <div className="space-y-1.5">
                      <label className={labelClass}>Description</label>
                      <input
                        value={sa.description || ""}
                        onChange={e => updateAgent(saId, { description: e.target.value })}
                        placeholder="What this sub-agent does"
                        className={inputClass}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <ModelCombobox
                          value={sa.model || ""}
                          onChange={v => updateAgent(saId, { model: v })}
                          models={models}
                          label="Model"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className={labelClass}>Reasoning Effort</label>
                        <select
                          value={sa.reasoningEffort || "medium"}
                          onChange={e => updateAgent(saId, { reasoningEffort: e.target.value })}
                          className={`${inputClass} h-[38px]`}
                        >
                          <option value="xhigh">xhigh</option>
                          <option value="high">high</option>
                          <option value="medium">medium</option>
                          <option value="low">low</option>
                          <option value="minimal">minimal</option>
                          <option value="none">none</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className={labelClass}>Max Steps</label>
                        <input
                          type="number"
                          value={sa.maxSteps ?? 10}
                          onChange={e => updateAgent(saId, { maxSteps: Number(e.target.value) })}
                          min={1} max={100}
                          className={inputClass}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className={labelClass}>Temperature</label>
                        <input
                          type="number"
                          value={sa.temperature ?? 0.2}
                          onChange={e => updateAgent(saId, { temperature: Number(e.target.value) })}
                          min={0} max={2} step={0.1}
                          className={inputClass}
                        />
                      </div>
                    </div>

                    {/* Workspace Access */}
                    <div className="space-y-1.5">
                      <label className={labelClass}>Workspace Access</label>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(sa.tools || []).includes("workspace_read")}
                            onChange={() => toggleTool(saId, "workspace_read")}
                            className="rounded border-border bg-accent"
                          />
                          <span className="text-[10px] text-muted-foreground">Read</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(sa.tools || []).includes("workspace_write")}
                            onChange={() => toggleTool(saId, "workspace_write")}
                            className="rounded border-border bg-accent"
                          />
                          <span className="text-[10px] text-muted-foreground">Write</span>
                        </label>
                        {(sa.skills || []).length > 0 && !(sa.tools || []).includes("workspace_read") && (
                          <span className="text-[9px] text-muted-foreground/60">Skills auto-grant read access</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className={labelClass}>Instructions</label>
                      <textarea
                        value={sa.instructions || ""}
                        onChange={e => updateAgent(saId, { instructions: e.target.value })}
                        placeholder="System prompt for this sub-agent..."
                        rows={4}
                        className={`${inputClass} !text-[11px] resize-y font-mono`}
                      />
                    </div>

                    {/* Regular Tools */}
                    <div className="space-y-1.5">
                      <label className={labelClass}>
                        Tools ({(sa.tools || []).filter(t => !mcpServers.some(s => t.startsWith(`${s}_`))).length} selected)
                      </label>
                      <div className="bg-background/50 border border-border/60 rounded-md p-2 max-h-[160px] overflow-y-auto">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5">
                          {regularTools.map(tool => (
                            <label key={tool} className="flex items-center gap-1.5 cursor-pointer py-0.5">
                              <input type="checkbox" checked={(sa.tools || []).includes(tool)} onChange={() => toggleTool(saId, tool)}
                                className="rounded border-border bg-accent accent-purple-500" />
                              <span className="text-[9px] text-muted-foreground truncate">{tool}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* MCP Tools */}
                    {mcpServers.length > 0 && (
                      <div className="space-y-1.5">
                        <label className={labelClass}>
                          MCP Tools ({(sa.tools || []).filter(t => mcpServers.some(s => t.startsWith(`${s}_`))).length} selected)
                        </label>
                        <div className="space-y-2">
                          {mcpServers.map(server => {
                            const serverTools = mcpTools?.[server] || [];
                            if (serverTools.length === 0) return null;
                            const selectedCount = serverTools.filter(t => (sa.tools || []).includes(t)).length;
                            return (
                              <div key={server} className="bg-background/50 border border-border/60 rounded-md p-2">
                                <p className="text-[9px] text-muted-foreground font-medium mb-1">{server} ({selectedCount}/{serverTools.length})</p>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5">
                                  {serverTools.map(tool => (
                                    <label key={tool} className="flex items-center gap-1.5 cursor-pointer py-0.5">
                                      <input type="checkbox" checked={(sa.tools || []).includes(tool)} onChange={() => toggleTool(saId, tool)}
                                        className="rounded border-border bg-accent accent-[var(--brand)]" />
                                      <span className="text-[9px] text-muted-foreground truncate">{tool.replace(`${server}_`, "")}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Skills */}
                    <div className="space-y-1.5">
                      <label className={labelClass}>Skills ({sa.skills?.length || 0} selected)</label>
                      <div className="bg-background/50 border border-border/60 rounded-md p-2">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-0.5">
                          {(availableSkills || []).map(skill => (
                            <label key={skill.name} className="flex items-center gap-1.5 cursor-pointer py-0.5">
                              <input type="checkbox" checked={(sa.skills || []).includes(skill.name)} onChange={() => toggleSkill(saId, skill.name)}
                                className="rounded border-border bg-accent" />
                              <span className="text-[9px] text-muted-foreground truncate">{skill.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deleteAgent(saId)}
                        className="h-6 text-[10px] px-2 text-destructive hover:text-destructive"
                      >
                        Delete Sub-agent
                      </Button>
                    </div>
                  </div>
                  );
                })()}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Save footer */}
      <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm border-t border-border -mx-6 px-6 py-3 flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">Changes are hot-reloaded — no restart needed.</p>
        <Button onClick={saveAll} disabled={saving} size="sm">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </>
  );
}

// ── Proactive Check-ins Tab ──────────────────────────────────

function ProactiveTab({ agentId, settingsData, refetchSettings }: {
  agentId: string;
  settingsData: Record<string, string>;
  refetchSettings: () => void;
}) {
  const toHM = (val: string | undefined, fallbackH: number) => {
    const total = parseFloat(val ?? "") || fallbackH;
    return { h: Math.floor(total), m: Math.round((total % 1) * 60) };
  };

  const [enabled, setEnabled] = useState(settingsData["proactive.enabled"] === "true");
  const [minH, setMinH] = useState(toHM(settingsData["proactive.minIntervalHours"], 2).h);
  const [minM, setMinM] = useState(toHM(settingsData["proactive.minIntervalHours"], 2).m);
  const [maxH, setMaxH] = useState(toHM(settingsData["proactive.maxIntervalHours"], 4).h);
  const [maxM, setMaxM] = useState(toHM(settingsData["proactive.maxIntervalHours"], 4).m);
  const [gapH, setGapH] = useState(toHM(settingsData["proactive.minGapHours"], 4).h);
  const [gapM, setGapM] = useState(toHM(settingsData["proactive.minGapHours"], 4).m);
  const [activeStart, setActiveStart] = useState(settingsData["proactive.activeHoursStart"] ?? "08:00");
  const [activeEnd, setActiveEnd] = useState(settingsData["proactive.activeHoursEnd"] ?? "21:00");
  const [probability, setProbability] = useState(settingsData["proactive.probability"] ?? "0.4");
  const [prompt, setPrompt] = useState(settingsData["proactive.prompt"] ?? "");
  const [saving, setSaving] = useState(false);

  async function saveAll() {
    // Validate: ensure intervals > 0, max >= min
    let minVal = Math.max(0, minH + minM / 60);
    let maxVal = Math.max(0, maxH + maxM / 60);
    if (minVal <= 0) { minVal = 2; setMinH(2); setMinM(0); }
    if (maxVal <= 0) { maxVal = 4; setMaxH(4); setMaxM(0); }
    if (maxVal < minVal) { maxVal = minVal; setMaxH(Math.floor(minVal)); setMaxM(Math.round((minVal % 1) * 60)); }

    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agents/${agentId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "proactive.enabled": enabled,
          "proactive.minIntervalHours": minVal,
          "proactive.maxIntervalHours": maxVal,
          "proactive.minGapHours": Math.max(0, gapH + gapM / 60),
          "proactive.activeHoursStart": activeStart,
          "proactive.activeHoursEnd": activeEnd,
          "proactive.probability": parseFloat(probability) || 0.4,
          "proactive.prompt": prompt,
        }),
      });
      if (res.ok) {
        refetchSettings();
        toast.success("Changes applied");
      } else {
        toast.error("Failed to save");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card size="sm">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs">Proactive Check-ins</CardTitle>
            <Badge variant="outline" className="text-[9px] border-border">live</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted/30 border border-border/50 p-3 space-y-1.5">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              When enabled, this agent will occasionally review its conversation history and decide on its own whether to follow up with you — like a real coach or advisor checking in.
            </p>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Check-ins happen at randomized intervals (not on a fixed schedule) during active hours. The agent may decide there&apos;s nothing worth following up on and stay silent. You&apos;ll only hear from it when it has something relevant to say.
            </p>
            <p className="text-[10px] text-muted-foreground/60">
              Off by default. Each check costs one agent turn (~500-2000 tokens).
            </p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => setEnabled(e.target.checked)}
              className="rounded border-border bg-accent"
            />
            <span className="text-xs">Enable proactive check-ins</span>
          </label>
        </CardContent>
      </Card>

      {enabled && (
        <>
          <Card size="sm">
            <CardHeader className="border-b">
              <CardTitle className="text-xs">Timing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className={labelClass}>Min Interval</label>
                  <p className="text-[10px] text-muted-foreground/70">Earliest next check</p>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={minH} onChange={e => setMinH(Number(e.target.value))} min={0} max={48} className={numberInputClass} />
                    <span className="text-[10px] text-muted-foreground">h</span>
                    <input type="number" value={minM} onChange={e => setMinM(Number(e.target.value))} min={0} max={59} step={5} className={numberInputClass} />
                    <span className="text-[10px] text-muted-foreground">m</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Max Interval</label>
                  <p className="text-[10px] text-muted-foreground/70">Latest next check</p>
                  <div className="flex items-center gap-1.5">
                    <input type="number" value={maxH} onChange={e => setMaxH(Number(e.target.value))} min={0} max={48} className={numberInputClass} />
                    <span className="text-[10px] text-muted-foreground">h</span>
                    <input type="number" value={maxM} onChange={e => setMaxM(Number(e.target.value))} min={0} max={59} step={5} className={numberInputClass} />
                    <span className="text-[10px] text-muted-foreground">m</span>
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Min Gap</label>
                <p className="text-[10px] text-muted-foreground/70">Won&apos;t check in if you interacted within this time</p>
                <div className="flex items-center gap-1.5">
                  <input type="number" value={gapH} onChange={e => setGapH(Number(e.target.value))} min={0} max={48} className={numberInputClass} />
                  <span className="text-[10px] text-muted-foreground">h</span>
                  <input type="number" value={gapM} onChange={e => setGapM(Number(e.target.value))} min={0} max={59} step={5} className={numberInputClass} />
                  <span className="text-[10px] text-muted-foreground">m</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className={labelClass}>Active Hours Start</label>
                  <input type="time" value={activeStart} onChange={e => setActiveStart(e.target.value)} className={inputClass} />
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Active Hours End</label>
                  <input type="time" value={activeEnd} onChange={e => setActiveEnd(e.target.value)} className={inputClass} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader className="border-b">
              <CardTitle className="text-xs">Behavior</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <label className={labelClass}>Probability (0-1)</label>
                <p className="text-[10px] text-muted-foreground/70">Chance of proceeding past the random gate each check. Lower = less frequent.</p>
                <input
                  type="number"
                  value={probability}
                  onChange={e => setProbability(e.target.value)}
                  min={0} max={1} step={0.1}
                  className={numberInputClass}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Custom Prompt (optional)</label>
                <p className="text-[10px] text-muted-foreground/70">Override the default check-in prompt. Leave empty to use the built-in prompt.</p>
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  rows={4}
                  placeholder="You have a chance to check in with the user proactively..."
                  className={`${inputClass} resize-y font-mono`}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm border-t border-border -mx-6 px-6 py-3 flex justify-end">
        <Button onClick={saveAll} disabled={saving} size="sm">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </>
  );
}

export default function AgentEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { markRequired } = useRestartRequired();

  const { data } = useFetch<AgentDetail>(`/api/platform/agents/${id}`);
  const { data: modelsData } = useFetch<{ models: OpenRouterModel[] }>("/api/models");
  const { data: toolsData } = useFetch<{ tools: string[] }>("/api/available-tools");
  const { data: alwaysToolsData } = useFetch<{ tools: string[] }>("/api/platform/always-available-tools");
  const { data: mcpData } = useFetch<{ servers: string[] }>("/api/platform/mcp-servers");
  const { data: mcpToolsData } = useFetch<{ servers: Record<string, string[]> }>("/api/platform/mcp-tools");
  const { data: skillsData } = useFetch<{ skills: Array<{ name: string; eligible: boolean }> }>("/api/available-skills");
  const { data: cronsData } = useFetch<{ crons: CronJob[] }>(`/api/platform/agents/${id}/crons`, 5000);
  const { data: settingsData, refetch: refetchSettings } = useFetch<Record<string, string>>(
    `/api/platform/agents/${id}/settings`,
  );
  const { data: globalSettings } = useFetch<Record<string, string>>("/api/settings");
  const { data: scenariosData, refetch: refetchScenarios } = useFetch<{ sources: Record<string, WebhookScenario[]> }>(
    `/api/platform/agents/${id}/webhook-scenarios`,
  );

  const [tab, setTab] = useState<TabId>("identity");

  // -- Identity state --
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [role, setRole] = useState("");
  const [persona, setPersona] = useState("");

  // -- Model state --
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("");
  const [modelOverrideEnabled, setModelOverrideEnabled] = useState(false);
  const [temperature, setTemperature] = useState(0.2);
  const [maxSteps, setMaxSteps] = useState(50);
  const [visionModel, setVisionModel] = useState("");

  // -- Tools state --
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [selectedMcp, setSelectedMcp] = useState<string[]>([]);

  // -- Memory state --
  const [lastMessages, setLastMessages] = useState(12);
  const [wmEnabled, setWmEnabled] = useState(true);
  const [wmScope, setWmScope] = useState("resource");
  const [memoryTemplate, setMemoryTemplate] = useState("");

  // -- Telegram state --
  const [botToken, setBotToken] = useState("");
  const [ownerId, setOwnerId] = useState(0);
  const [allowedGroups, setAllowedGroups] = useState("");
  const [adminGroups, setAdminGroups] = useState("");

  // -- Behavior state --
  const [behaviorResponseLength, setBehaviorResponseLength] = useState("balanced");
  const [behaviorAgency, setBehaviorAgency] = useState("execute_first");
  const [behaviorTone, setBehaviorTone] = useState("balanced");
  const [behaviorFormat, setBehaviorFormat] = useState("conversational");
  const [behaviorLanguage, setBehaviorLanguage] = useState("auto_detect");
  const [behaviorCustomInstructions, setBehaviorCustomInstructions] = useState("");
  const [savingBehavior, setSavingBehavior] = useState(false);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settingsData) return;
    setBehaviorResponseLength(settingsData["behavior.responseLength"] || "balanced");
    setBehaviorAgency(settingsData["behavior.agency"] || "execute_first");
    setBehaviorTone(settingsData["behavior.tone"] || "balanced");
    setBehaviorFormat(settingsData["behavior.format"] || "conversational");
    setBehaviorLanguage(settingsData["behavior.language"] || "auto_detect");
    setBehaviorCustomInstructions(settingsData["behavior.customInstructions"] || "");
    // Runtime fields from settings.db (override config defaults when present)
    if (settingsData["tools"]) try { setSelectedTools(JSON.parse(settingsData["tools"])); } catch {}
    if (settingsData["skills"]) try { setSelectedSkills(JSON.parse(settingsData["skills"])); } catch {}
    if (settingsData["mcp_servers"]) try { setSelectedMcp(JSON.parse(settingsData["mcp_servers"])); } catch {}
    if (settingsData["memory.lastMessages"]) setLastMessages(Number(settingsData["memory.lastMessages"]) || 12);
    if (settingsData["memory.workingMemory.enabled"] !== undefined) setWmEnabled(settingsData["memory.workingMemory.enabled"] === "true");
    if (settingsData["memory.workingMemory.scope"]) setWmScope(settingsData["memory.workingMemory.scope"]);
    if (settingsData["llm.temperature"]) setTemperature(Number(settingsData["llm.temperature"]) || 0.2);
    if (settingsData["llm.maxSteps"]) setMaxSteps(Number(settingsData["llm.maxSteps"]) || 50);
    if (settingsData["allowedGroups"]) setAllowedGroups(settingsData["allowedGroups"]);
    if (settingsData["adminGroups"]) setAdminGroups(settingsData["adminGroups"]);
  }, [settingsData]);

  useEffect(() => {
    if (!data) return;
    const c = data.config;
    setName(c.name);
    setDescription(c.description);
    setCharacterName(c.characterName || "");
    setOwnerName(c.ownerName || "");
    setRole(c.role || "");
    setPersona(data.persona);
    setProvider(c.llm.provider);
    setModel(c.llm.model);
    // Check if the model is a tier value or a custom override
    try {
      const gTiers = globalSettings?.["global.llm.tiers"] ? JSON.parse(globalSettings["global.llm.tiers"]) : {};
      const tierValues = Object.values(gTiers);
      setModelOverrideEnabled(!!c.llm.model && !tierValues.includes(c.llm.model));
    } catch { setModelOverrideEnabled(false); }
    setTemperature(c.llm.temperature);
    setMaxSteps(c.llm.maxSteps);
    setVisionModel(c.llm.vision?.model || "");
    setSelectedTools(c.tools);
    setSelectedSkills(c.skills || []);
    setSelectedMcp(c.mcpServers);
    setLastMessages(c.memory.lastMessages);
    setWmEnabled(c.memory.workingMemory?.enabled ?? true);
    setWmScope(c.memory.workingMemory?.scope || "resource");
    setMemoryTemplate(data.memoryTemplate);
    setBotToken(c.transport.botToken);
    setOwnerId(c.transport.ownerId);
    setAllowedGroups((c.allowedGroups || []).join(", "));
    setAdminGroups((c.adminGroups || []).join(", "));
  }, [data]);

  /** Save identity fields to agents.db (requires restart) */
  async function saveIdentity() {
    if (!data) return;
    setSaving(true);
    try {
      const updated = {
        name,
        description,
        ...(characterName && { characterName }),
        ...(ownerName && { ownerName }),
        ...(role && { role }),
        enabled: data.config.enabled,
        transport: {
          ...data.config.transport,
          ownerId,
          ...(botToken !== data.config.transport.botToken ? { botToken } : {}),
        },
      };
      const res = await fetch(`/api/platform/agents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) { markRequired(); toast.success("Saved — restart to apply"); }
      else toast.error("Failed to save config");
    } finally {
      setSaving(false);
    }
  }

  /** Save tools/skills/mcpServers to settings.db (immediate effect) */
  async function saveToolsSettings() {
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agents/${id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tools: JSON.stringify(selectedTools),
          skills: JSON.stringify(selectedSkills),
          mcpServers: JSON.stringify(selectedMcp),
        }),
      });
      if (res.ok) {
        refetchSettings();
        markRequired();
        toast.success("Saved — restart to apply");
      } else toast.error("Failed to save tools");
    } finally {
      setSaving(false);
    }
  }

  /** Save memory settings to settings.db (immediate effect) */
  async function saveMemorySettings() {
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agents/${id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "memory.lastMessages": lastMessages,
          "memory.workingMemory.enabled": wmEnabled,
          "memory.workingMemory.scope": wmScope,
        }),
      });
      if (res.ok) {
        refetchSettings();
        toast.success("Changes applied");
      } else toast.error("Failed to save memory settings");
    } finally {
      setSaving(false);
    }
  }

  /** Save model settings (temperature, maxSteps) to settings.db (immediate effect) */
  async function saveModelSettings() {
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agents/${id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "llm.temperature": temperature,
          "llm.maxSteps": maxSteps,
        }),
      });
      if (res.ok) {
        refetchSettings();
        toast.success("Changes applied");
      } else toast.error("Failed to save model settings");
    } finally {
      setSaving(false);
    }
  }

  /** Save Telegram identity (botToken, ownerId) to agents.db */
  async function saveTelegramIdentity() {
    if (!data) return;
    setSaving(true);
    try {
      const updated = {
        ...data.config,
        transport: {
          ...data.config.transport,
          ownerId,
          ...(botToken !== data.config.transport.botToken ? { botToken } : {}),
        },
      };
      const res = await fetch(`/api/platform/agents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      if (res.ok) { markRequired(); toast.success("Saved — restart to apply"); }
      else toast.error("Failed to save transport config");
    } finally {
      setSaving(false);
    }
  }

  /** Save Telegram runtime settings (groups) to settings.db */
  async function saveTelegramRuntime() {
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/agents/${id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allowedGroups: allowedGroups,
          adminGroups: adminGroups,
        }),
      });
      if (res.ok) {
        refetchSettings();
        toast.success("Changes applied");
      } else toast.error("Failed to save group settings");
    } finally {
      setSaving(false);
    }
  }

  async function saveBehavior() {
    setSavingBehavior(true);
    try {
      const res = await fetch(`/api/platform/agents/${id}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          "behavior.responseLength": behaviorResponseLength,
          "behavior.agency": behaviorAgency,
          "behavior.tone": behaviorTone,
          "behavior.format": behaviorFormat,
          "behavior.language": behaviorLanguage,
          "behavior.customInstructions": behaviorCustomInstructions,
        }),
      });
      if (res.ok) {
        toast.success("Changes applied");
        refetchSettings();
      } else toast.error("Failed to save behavior");
    } finally {
      setSavingBehavior(false);
    }
  }

  async function saveMarkdown(type: "persona" | "memory-template", content: string) {
    const res = await fetch(`/api/platform/agents/${id}/${type}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (res.ok) toast.success("Saved -- restart to apply");
    else toast.error(`Failed to save ${type}`);
  }

  async function saveSetting(key: string, value: unknown) {
    const res = await fetch(`/api/platform/agents/${id}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (res.ok) {
      refetchSettings();
      toast.success("Changes applied");
    } else {
      toast.error("Failed to update setting");
    }
  }

  function toggleTool(tool: string) {
    setSelectedTools(prev => prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]);
  }

  function toggleSkill(skill: string) {
    setSelectedSkills(prev => prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]);
  }

  function toggleMcp(server: string) {
    setSelectedMcp(prev => prev.includes(server) ? prev.filter(s => s !== server) : [...prev, server]);
  }

  if (!data) {
    return <div className="p-4"><p className="text-sm text-muted-foreground">Loading...</p></div>;
  }

  const models = modelsData?.models;
  const crons = cronsData?.crons || [];
  const subAgentEntries = Object.entries(data.subAgents?.agents || {});

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto py-6 px-6">
        <PageHeader
          title={name}
          breadcrumbs={[
            { label: "Agents", href: "/agents" },
            { label: name || id },
          ]}
          actions={
            <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
              {id}
            </Badge>
          }
        />

        <div className="flex gap-6">
          {/* Left nav */}
          <nav className="w-48 shrink-0">
            <div className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-4">
              {NAV_GROUPS.map(group => (
                <div key={group.label}>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-2">
                    {group.label}
                  </p>
                  <div className="space-y-0.5">
                    {group.items.map(item => (
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

            {/* ---- Identity ---- */}
            {tab === "identity" && (
              <>
                <Card size="sm">
                  <CardHeader className="border-b">
                    <CardTitle className="text-xs">Agent Identity</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className={labelClass}>Name</label>
                        <input value={name} onChange={e => setName(e.target.value)} className={inputClass} />
                      </div>
                      <div className="space-y-1.5">
                        <label className={labelClass}>Character Name (optional -- used in prompt opening)</label>
                        <input value={characterName} onChange={e => setCharacterName(e.target.value)} className={inputClass} placeholder={name} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className={labelClass}>Owner Name</label>
                        <input value={ownerName} onChange={e => setOwnerName(e.target.value)} className={inputClass} placeholder="Owner" />
                      </div>
                      <div className="space-y-1.5">
                        <label className={labelClass}>Role (used in prompt: &quot;{ownerName || "the user"}&apos;s {role || "personal assistant"}&quot;)</label>
                        <input value={role} onChange={e => setRole(e.target.value)} className={inputClass} placeholder="personal assistant" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClass}>Description</label>
                      <AutoTextarea value={description} onChange={e => setDescription(e.target.value)} minRows={2} maxHeight={200} />
                    </div>
                  </CardContent>
                </Card>

                <Card size="sm">
                  <CardHeader className="border-b">
                    <CardTitle className="text-xs">Response Style</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className={labelClass}>Response Length</label>
                        <select value={behaviorResponseLength} onChange={e => setBehaviorResponseLength(e.target.value)} className={inputClass}>
                          <option value="brief">Brief</option>
                          <option value="balanced">Balanced</option>
                          <option value="detailed">Detailed</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className={labelClass}>Agency</label>
                        <select value={behaviorAgency} onChange={e => setBehaviorAgency(e.target.value)} className={inputClass}>
                          <option value="execute_first">Execute first</option>
                          <option value="ask_before_acting">Ask before acting</option>
                          <option value="consultative">Consultative</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className={labelClass}>Tone</label>
                        <select value={behaviorTone} onChange={e => setBehaviorTone(e.target.value)} className={inputClass}>
                          <option value="casual">Casual</option>
                          <option value="balanced">Balanced</option>
                          <option value="professional">Professional</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className={labelClass}>Format</label>
                        <select value={behaviorFormat} onChange={e => setBehaviorFormat(e.target.value)} className={inputClass}>
                          <option value="texting">Texting</option>
                          <option value="conversational">Conversational</option>
                          <option value="structured">Structured</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClass}>Language</label>
                      <select value={behaviorLanguage} onChange={e => setBehaviorLanguage(e.target.value)} className={inputClass}>
                        <option value="english">English</option>
                        <option value="hebrew">Hebrew</option>
                        <option value="auto_detect">Auto-detect</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClass}>Custom Instructions</label>
                      <AutoTextarea
                        value={behaviorCustomInstructions}
                        onChange={e => setBehaviorCustomInstructions(e.target.value)}
                        minRows={2}
                        maxHeight={200}
                        placeholder="e.g. Always include calorie counts when discussing meals"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button onClick={saveBehavior} disabled={savingBehavior} size="sm">
                        {savingBehavior ? "Saving..." : "Save Behavior"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <PromptSections agentId={id} persona={persona} onPersonaChange={setPersona} onSavePersona={() => saveMarkdown("persona", persona)} subAgents={subAgentEntries} identity={{ name, characterName, ownerName, role }} />

                {/* Sticky save footer */}
                <div className="sticky bottom-0 z-20 mt-6 flex items-center justify-between border-t border-border/60 bg-background/80 px-0 py-3 backdrop-blur">
                  <span className="text-xs text-muted-foreground">Identity changes require restart</span>
                  <Button onClick={saveIdentity} disabled={saving} size="sm">{saving ? "Saving..." : "Save Identity"}</Button>
                </div>
              </>
            )}

            {/* ---- Model ---- */}
            {tab === "model" && (
              <>
                {/* Active Model — global tiers, per-agent tier selection */}
                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs">Active Model</CardTitle>
                      <Badge variant="outline" className="text-[9px] border-border">live</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(() => {
                      try {
                        const tiersRaw = globalSettings?.["global.llm.tiers"];
                        if (!tiersRaw) return <p className="text-[10px] text-muted-foreground">No tiers configured. Set global tiers in <a href="/settings" className="underline hover:text-foreground">Settings</a>.</p>;
                        const tiers: Record<string, string> = JSON.parse(tiersRaw);
                        const activeTier = settingsData?.["model_tier"] || "med";
                        return (
                          <>
                            <p className="text-[10px] text-muted-foreground">Select a tier for this agent. Tiers are configured globally in <a href="/settings" className="underline hover:text-foreground">Settings</a>.</p>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(tiers).map(([tier, tierModel]) => (
                                <button
                                  key={tier}
                                  onClick={() => saveSetting("model_tier", tier)}
                                  className={`px-3 py-2 rounded-md text-xs border transition-colors ${
                                    activeTier === tier
                                      ? "bg-muted text-foreground border-border font-medium"
                                      : "text-muted-foreground border-transparent hover:bg-muted/50 hover:border-border/50"
                                  }`}
                                >
                                  <div className="font-medium">{tier}</div>
                                  <div className="text-[9px] text-muted-foreground font-mono mt-0.5">{tierModel}</div>
                                </button>
                              ))}
                            </div>
                          </>
                        );
                      } catch { return null; }
                    })()}
                    {settingsData?.["_resolvedModel"] && (
                      <p className="text-[10px] text-muted-foreground">
                        Currently active: <code className="font-mono text-foreground">{settingsData["_resolvedModel"]}</code>
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Model override — pick any OpenRouter model for this agent */}
                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs">Model Override</CardTitle>
                      <span className="text-[9px] text-muted-foreground">this agent only — restart required</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="model-override-toggle"
                        checked={modelOverrideEnabled}
                        onChange={(e) => {
                          setModelOverrideEnabled(e.target.checked);
                          if (!e.target.checked) {
                            // Clear the override — revert to tier
                            saveSetting("llm.model", "");
                          }
                        }}
                        className="h-4 w-4 rounded border-border accent-[var(--brand)]"
                      />
                      <label htmlFor="model-override-toggle" className="text-xs text-muted-foreground">
                        Override tier with a specific model for this agent
                      </label>
                    </div>
                    {modelOverrideEnabled && (
                      <div className="space-y-3">
                        <ModelCombobox value={model} onChange={(v) => { setModel(v); saveSetting("llm.model", v); }} models={models} label="Model" />
                        {model && (
                          <p className="text-[11px] text-[var(--status-warning)]">
                            This agent will use <code className="font-mono">{model}</code> instead of the tier-assigned model.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>Temperature</label>
                        <input type="number" value={temperature} onChange={e => setTemperature(Number(e.target.value))} min={0} max={2} step={0.1} className={numberInputClass} />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className={labelClass}>Max Steps</label>
                        <input type="number" value={maxSteps} onChange={e => setMaxSteps(Number(e.target.value))} min={1} max={100} className={numberInputClass} />
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button onClick={saveModelSettings} disabled={saving} size="sm">{saving ? "Saving..." : "Save Model Settings"}</Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ---- Memory ---- */}
            {tab === "memory" && (
              <>
                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs">Memory Settings</CardTitle>
                      <Badge variant="outline" className="text-[9px] border-border">live</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-col gap-1.5">
                      <label className={labelClass}>Last Messages (context window)</label>
                      <input type="number" value={lastMessages} onChange={e => setLastMessages(Number(e.target.value))} min={1} max={50} className={numberInputClass} />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={wmEnabled} onChange={e => setWmEnabled(e.target.checked)}
                        className="rounded border-border bg-accent accent-teal-500" />
                      <span className="text-[10px] text-muted-foreground">Working Memory</span>
                    </label>
                    <div className="flex justify-end pt-2">
                      <Button onClick={saveMemorySettings} disabled={saving} size="sm">{saving ? "Saving..." : "Save Memory Settings"}</Button>
                    </div>
                  </CardContent>
                </Card>

                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs">Memory Template</CardTitle>
                      <span className="text-[9px] text-muted-foreground">restart required</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-[10px] text-muted-foreground">
                      This template defines the initial structure for the agent&apos;s working memory. The actual memory content is managed by the agent at runtime.
                    </p>
                    <AutoTextarea value={memoryTemplate} onChange={e => setMemoryTemplate(e.target.value)} minRows={6} maxHeight={500} className="font-mono text-[11px]" />
                    <Button onClick={() => saveMarkdown("memory-template", memoryTemplate)} size="sm">Save Template</Button>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ---- Tools / MCP / Skills ---- */}
            {tab === "tools" && (
              <>
                {/* Always-available tools (locked) */}
                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xs">Always Available</CardTitle>
                      <span className="text-[10px] text-muted-foreground">all agents</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {(alwaysToolsData?.tools || []).map(tool => (
                        <label key={tool} className="flex items-center gap-2 py-0.5 opacity-60">
                          <input type="checkbox" checked disabled
                            className="rounded border-border bg-accent accent-purple-500" />
                          <span className="text-[10px] text-muted-foreground">{tool}</span>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Optional tools */}
                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xs">Additional Tools</CardTitle>
                      <span className="text-[10px] text-muted-foreground">({selectedTools.filter(t => !(alwaysToolsData?.tools || []).includes(t)).length} selected)</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-background/50 border border-border/60 rounded-md p-3 max-h-[300px] overflow-y-auto">
                      {!toolsData && <p className="text-[10px] text-muted-foreground">Loading tools...</p>}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {toolsData?.tools.filter(t => {
                          if ((alwaysToolsData?.tools || []).includes(t)) return false;
                          const mcpServers = Object.keys(mcpToolsData?.servers || {});
                          return !mcpServers.some(s => t.startsWith(`${s}_`));
                        }).map(tool => (
                          <label key={tool} className="flex items-center gap-2 cursor-pointer group py-0.5">
                            <input type="checkbox" checked={selectedTools.includes(tool)} onChange={() => toggleTool(tool)}
                              className="rounded border-border bg-accent text-foreground accent-purple-500" />
                            <span className="text-[10px] text-muted-foreground group-hover:text-foreground truncate">{tool}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Separator />

                {/* MCP Servers */}
                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xs">MCP Servers & Tools</CardTitle>
                      <span className="text-[10px] text-muted-foreground">({selectedMcp.length} servers)</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {!mcpData && <p className="text-[10px] text-muted-foreground">Loading MCP servers...</p>}
                    {mcpData?.servers.map(server => {
                      const isEnabled = selectedMcp.includes(server);
                      const serverTools = mcpToolsData?.servers?.[server] || [];
                      const enabledToolCount = isEnabled
                        ? serverTools.filter(t => selectedTools.includes(t) || !selectedTools.some(st => st.startsWith(`${server}_`))).length
                        : serverTools.filter(t => selectedTools.includes(t)).length;

                      return (
                        <div key={server} className="bg-background/50 border border-border/60 rounded-md p-3">
                          <label className="flex items-center gap-2 cursor-pointer group">
                            <input type="checkbox" checked={isEnabled} onChange={() => {
                              toggleMcp(server);
                              if (isEnabled) {
                                setSelectedTools(prev => prev.filter(t => !t.startsWith(`${server}_`)));
                              }
                            }}
                              className="rounded border-border bg-accent text-foreground accent-[var(--brand)]" />
                            <span className={`text-xs group-hover:text-foreground font-medium ${isEnabled ? "text-foreground" : "text-muted-foreground"}`}>{server}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                              {isEnabled ? `all ${serverTools.length} tools` : enabledToolCount > 0 ? `${enabledToolCount}/${serverTools.length} tools` : `${serverTools.length} tools`}
                            </span>
                          </label>
                          {serverTools.length > 0 && (
                            <div className="mt-2 pl-5 grid grid-cols-2 gap-x-4 gap-y-1">
                              {serverTools.map(tool => {
                                const shortName = tool.replace(`${server}_`, "");
                                const isToolEnabled = isEnabled || selectedTools.includes(tool);
                                return (
                                  <label key={tool} className="flex items-center gap-2 cursor-pointer group py-0.5">
                                    <input type="checkbox"
                                      checked={isToolEnabled}
                                      disabled={isEnabled}
                                      onChange={() => toggleTool(tool)}
                                      className="rounded border-border bg-accent accent-[var(--brand)]" />
                                    <span className={`text-[10px] truncate ${isToolEnabled ? "text-muted-foreground group-hover:text-foreground" : "text-muted-foreground"}`}>{shortName}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Enable a server for all its tools, or select individual tools without enabling the server.
                    </p>
                  </CardContent>
                </Card>

                <Separator />

                {/* Workspace Access */}
                <Card size="sm">
                  <CardHeader className="border-b">
                    <CardTitle className="text-xs">Workspace Access</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 cursor-pointer group py-0.5">
                        <input type="checkbox"
                          checked={selectedTools.includes("workspace_read") || selectedSkills.length > 0}
                          onChange={() => toggleTool("workspace_read")}
                          disabled={selectedSkills.length > 0}
                          className="rounded border-border bg-accent accent-yellow-500 disabled:opacity-50" />
                        <span className="text-[10px] text-muted-foreground group-hover:text-foreground">workspace_read</span>
                        <span className="text-[10px] text-muted-foreground">
                          {selectedSkills.length > 0 ? "-- enabled by skills" : "-- read-only filesystem access"}
                        </span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group py-0.5">
                        <input type="checkbox" checked={selectedTools.includes("workspace_write")}
                          onChange={() => toggleTool("workspace_write")}
                          className="rounded border-border bg-accent accent-yellow-500" />
                        <span className="text-[10px] text-muted-foreground group-hover:text-foreground">workspace_write</span>
                        <span className="text-[10px] text-muted-foreground">-- read-write filesystem access</span>
                      </label>
                    </div>
                  </CardContent>
                </Card>

                <Separator />

                {/* Skills */}
                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xs">Skills</CardTitle>
                      <span className="text-[10px] text-muted-foreground">({selectedSkills.length} selected)</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-background/50 border border-border/60 rounded-md p-3 max-h-[240px] overflow-y-auto">
                      {!skillsData && <p className="text-[10px] text-muted-foreground">Loading skills...</p>}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {skillsData?.skills.map(skill => (
                          <label key={skill.name} className="flex items-center gap-2 cursor-pointer group py-0.5">
                            <input type="checkbox" checked={selectedSkills.includes(skill.name)}
                              onChange={() => toggleSkill(skill.name)}
                              className="rounded border-border bg-accent accent-[var(--brand)]" />
                            <span className="text-[10px] text-muted-foreground group-hover:text-foreground truncate">{skill.name}</span>
                            {!skill.eligible && (
                              <Badge className="text-[9px] bg-[var(--status-warning-bg)] text-[var(--status-warning)] border-0 px-1 py-0">ineligible</Badge>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Save footer */}
                <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm border-t border-border -mx-6 px-6 py-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Tool changes take effect immediately</span>
                  <Button onClick={saveToolsSettings} disabled={saving} size="sm">{saving ? "Saving..." : "Save"}</Button>
                </div>
              </>
            )}

            {/* ---- Sub-agents ---- */}
            {tab === "subagents" && data && (
              <SubAgentsEditor
                agentId={id}
                subAgentsData={data.subAgents}
                models={models}
                availableTools={toolsData?.tools}
                availableSkills={skillsData?.skills}
                mcpTools={mcpToolsData?.servers}
              />
            )}

            {/* ---- Crons ---- */}
            {tab === "crons" && (
              <Card size="sm">
                <CardHeader className="border-b">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xs">Cron Jobs</CardTitle>
                    <span className="text-[10px] text-muted-foreground">({crons.length} jobs)</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  {crons.length === 0 && <p className="text-[10px] text-muted-foreground">No cron jobs for this agent.</p>}
                  {crons.map(cron => (
                    <div key={cron.id} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${cron.paused ? "bg-muted-foreground" : "bg-[var(--status-success)]"}`} />
                      <span className="text-xs text-foreground flex-1 truncate">{cron.name}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{cron.cron_expr}</span>
                      <Badge className={`text-[9px] border-0 ${cron.task_kind === "agent_turn" ? "bg-[var(--chart-4)]/10 text-[var(--chart-4)]" : "bg-[var(--status-info-bg)] text-[var(--status-info)]"}`}>
                        {cron.task_kind}
                      </Badge>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 mt-2">
                    <Link href={`/crons/new?agent_id=${id}`} className="text-[10px] text-muted-foreground hover:text-foreground underline">
                      + Add cron for this agent
                    </Link>
                    <span className="text-[10px] text-muted-foreground">|</span>
                    <Link href="/crons" className="text-[10px] text-muted-foreground hover:text-foreground">
                      All crons
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ---- Webhooks ---- */}
            {tab === "webhooks" && (
              <WebhookScenariosTab agentId={id} scenariosData={scenariosData} refetchScenarios={refetchScenarios} />
            )}

            {/* ---- Telegram ---- */}
            {tab === "telegram" && (
              <>
                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs">Bot Connection</CardTitle>
                      <span className="text-[9px] text-muted-foreground">restart required</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <label className={labelClass}>Bot Token (env var reference)</label>
                      <input value={botToken} onChange={e => setBotToken(e.target.value)} className={`${inputClass} font-mono`} placeholder="${BOT_TOKEN}" />
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClass}>Owner Telegram User ID</label>
                      <input type="number" value={ownerId} onChange={e => setOwnerId(Number(e.target.value))} className={inputClass} />
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button onClick={saveTelegramIdentity} disabled={saving} size="sm">{saving ? "Saving..." : "Save"}</Button>
                    </div>
                  </CardContent>
                </Card>

                <Card size="sm">
                  <CardHeader className="border-b">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-xs">Group Access</CardTitle>
                      <Badge variant="outline" className="text-[9px] border-border">live</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <label className={labelClass}>Allowed Groups (comma-separated)</label>
                      <input value={allowedGroups} onChange={e => setAllowedGroups(e.target.value)} className={inputClass} placeholder="-100123456, -100789012" />
                    </div>
                    <div className="space-y-1.5">
                      <label className={labelClass}>Admin Groups (comma-separated)</label>
                      <input value={adminGroups} onChange={e => setAdminGroups(e.target.value)} className={inputClass} placeholder="-100123456" />
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button onClick={saveTelegramRuntime} disabled={saving} size="sm">{saving ? "Saving..." : "Save Groups"}</Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Discovered Groups */}
                {settingsData?.["discovered_groups"] && (() => {
                  try {
                    const groups: Record<string, string> = JSON.parse(settingsData["discovered_groups"]);
                    const entries = Object.entries(groups);
                    if (entries.length === 0) return null;
                    return (
                      <Card size="sm">
                        <CardHeader className="border-b">
                          <CardTitle className="text-xs">Discovered Groups</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <p className="text-[10px] text-muted-foreground">Groups this bot has been added to. Copy the ID to add it to Allowed Groups above.</p>
                          {entries.map(([gid, gname]) => (
                            <div key={gid} className="flex items-center justify-between bg-background/50 border border-border/60 rounded-md px-3 py-2">
                              <div>
                                <span className="text-xs">{gname}</span>
                                <span className="text-[10px] text-muted-foreground ml-2 font-mono">{gid}</span>
                              </div>
                              <Button
                                size="sm" variant="ghost"
                                className="h-5 text-[9px] px-1.5"
                                onClick={() => { navigator.clipboard.writeText(gid); toast.success("Copied"); }}
                              >
                                Copy ID
                              </Button>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    );
                  } catch { return null; }
                })()}

                {/* Privacy mode tip */}
                <div className="rounded-md bg-muted/30 border border-border/50 p-3">
                  <p className="text-[10px] text-muted-foreground leading-relaxed">
                    For group chat features (auto-classification, multi-agent conversations), disable privacy mode via BotFather: <code className="font-mono text-[10px]">/setprivacy</code> → <code className="font-mono text-[10px]">Disable</code>. This allows the bot to see all group messages, not just @mentions.
                  </p>
                </div>
              </>
            )}

            {/* ---- Proactive Check-ins ---- */}
            {tab === "proactive" && settingsData && (
              <ProactiveTab agentId={id} settingsData={settingsData} refetchSettings={refetchSettings} />
            )}

            {/* ---- Runtime Settings ---- */}
            {tab === "runtime" && (
              <>
                {!settingsData && <p className="text-[10px] text-muted-foreground">Loading settings...</p>}
                {settingsData && (
                  <>
                    {/* Memory Settings */}
                    <Card size="sm">
                      <CardHeader className="border-b">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-xs">Memory Settings</CardTitle>
                          <Badge variant="outline" className="text-[9px] border-border">live</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-col gap-1.5">
                          <label className={labelClass}>Last Messages (context window)</label>
                          <input
                            type="number"
                            defaultValue={settingsData["memory.lastMessages"] ?? ""}
                            onBlur={e => saveSetting("memory.lastMessages", Number(e.target.value))}
                            min={1} max={50}
                            className={numberInputClass}
                          />
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settingsData["memory.workingMemory.enabled"] === "true"}
                            onChange={e => saveSetting("memory.workingMemory.enabled", e.target.checked)}
                            className="rounded border-border bg-accent accent-teal-500"
                          />
                          <span className="text-[10px] text-muted-foreground">Working Memory</span>
                        </label>
                      </CardContent>
                    </Card>

                    <Separator />

                    {/* Access Control */}
                    <Card size="sm">
                      <CardHeader className="border-b">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-xs">Access Control</CardTitle>
                          <Badge variant="outline" className="text-[9px] border-border">live</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-1.5">
                          <label className={labelClass}>Allowed Groups (comma-separated)</label>
                          <input
                            defaultValue={settingsData["allowedGroups"] || ""}
                            onBlur={e => saveSetting("allowedGroups", e.target.value)}
                            className={inputClass}
                            placeholder="-100123456, -100789012"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className={labelClass}>Admin Groups (comma-separated)</label>
                          <input
                            defaultValue={settingsData["adminGroups"] || ""}
                            onBlur={e => saveSetting("adminGroups", e.target.value)}
                            className={inputClass}
                            placeholder="-100123456"
                          />
                        </div>
                      </CardContent>
                    </Card>

                    <p className="text-[10px] text-muted-foreground">
                      Runtime settings are stored in SQLite and take effect immediately -- no restart needed.
                    </p>
                  </>
                )}
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
