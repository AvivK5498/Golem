"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModelCombobox } from "@/components/model-combobox";
import type { OpenRouterModel } from "@/lib/types";

const TIER_LABELS: Record<string, string> = {
  low: "Low",
  med: "Medium",
  high: "High",
};

const TIER_HINTS: Record<string, string> = {
  low: "Fast & affordable",
  med: "Balanced",
  high: "Powerful",
};

interface TierSelectorProps {
  /** Currently selected tier key ("low" | "med" | "high") or a raw model ID for override */
  value: string;
  /** Callback with the selected tier key or raw model ID */
  onChange: (value: string) => void;
  /** Available tiers — typically from global settings */
  tiers: Record<string, string>;
  /** Label text */
  label?: React.ReactNode;
  /** Show the override option to pick a specific model */
  allowOverride?: boolean;
  /** Models list for the override combobox */
  models?: OpenRouterModel[];
}

export function TierSelector({
  value,
  onChange,
  tiers,
  label,
  allowOverride = true,
  models,
}: TierSelectorProps) {
  const [showOverride, setShowOverride] = useState(false);

  // Determine if current value is a tier key or a raw model override
  const isTierSelected = value in tiers;
  const activeTier = isTierSelected ? value : null;
  const resolvedModel = isTierSelected ? tiers[value] : value;

  return (
    <div className="space-y-2">
      {label && <label className="text-[13px] font-medium text-muted-foreground">{label}</label>}

      {/* Tier buttons */}
      <div className="flex gap-2">
        {Object.entries(tiers).map(([key, modelId]) => (
          <button
            key={key}
            type="button"
            onClick={() => { onChange(key); setShowOverride(false); }}
            className={cn(
              "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors text-center",
              activeTier === key
                ? "border-[var(--brand)] bg-[var(--brand-muted)] text-[var(--brand-text)]"
                : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <div>{TIER_LABELS[key] || key}</div>
            <div className="text-[10px] font-normal opacity-70 mt-0.5">
              {TIER_HINTS[key] || modelId.split("/").pop()}
            </div>
          </button>
        ))}
      </div>

      {/* Resolved model display */}
      {activeTier && (
        <p className="text-xs text-muted-foreground font-mono">
          → {tiers[activeTier]}
        </p>
      )}

      {/* Override toggle */}
      {allowOverride && (
        <div>
          <button
            type="button"
            onClick={() => setShowOverride(!showOverride)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown size={12} className={cn("transition-transform", showOverride && "rotate-180")} />
            {showOverride ? "Hide model override" : "Override with specific model"}
          </button>

          {showOverride && (
            <div className="mt-2">
              <ModelCombobox
                value={resolvedModel}
                onChange={(id) => onChange(id)}
                models={models}
                label=""
                placeholder="Search models..."
              />
              {!isTierSelected && (
                <p className="text-xs text-[var(--status-warning)] mt-1">
                  Using custom model override — not using tier presets
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
