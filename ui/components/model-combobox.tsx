"use client";

import { useState, useRef, useEffect } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OpenRouterModel } from "@/lib/types";

export function ModelCombobox({
  value,
  onChange,
  models,
  placeholder = "Select model...",
  label,
}: {
  value: string;
  onChange: (id: string) => void;
  models?: OpenRouterModel[];
  placeholder?: string;
  label?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const filtered = models?.filter((m) =>
    !filter || m.id.toLowerCase().includes(filter.toLowerCase())
  ) ?? [];

  return (
    <div className="space-y-1.5" ref={containerRef}>
      <label className="text-[10px] text-muted-foreground">{label ?? "Model"}</label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between bg-card/60 border border-border rounded-md px-3 h-[38px] text-xs text-left hover:border-muted-foreground transition-colors"
      >
        <span className={value ? "text-foreground font-mono truncate" : "text-muted-foreground"}>
          {value || placeholder}
        </span>
        <ChevronsUpDown size={12} className="text-muted-foreground shrink-0 ml-2" />
      </button>
      {open && (
        <div className="border border-border rounded-md bg-background overflow-hidden">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search models..."
            className="w-full bg-background border-b border-border px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <div className="max-h-[250px] overflow-y-auto">
            {filtered.length === 0 && (
              <p className="text-[10px] text-muted-foreground py-3 text-center">No models found.</p>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { onChange(m.id); setOpen(false); setFilter(""); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-xs font-mono text-left transition-colors",
                  value === m.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Check size={12} className={cn("shrink-0", value === m.id ? "opacity-100" : "opacity-0")} />
                <span className="truncate flex-1">{m.id}</span>
                {m.provider === "codex" && (
                  <span className="shrink-0 text-[9px] uppercase tracking-wide bg-[var(--brand)]/15 text-[var(--brand-text)] px-1.5 py-0.5 rounded">
                    codex
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
