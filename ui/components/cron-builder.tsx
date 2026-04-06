"use client";

import { useState, useEffect } from "react";

interface CronBuilderProps {
  value: string;
  onChange: (cron: string) => void;
}

const PRESETS = [
  { label: "Every 5 min", cron: "*/5 * * * *" },
  { label: "Every 10 min", cron: "*/10 * * * *" },
  { label: "Every 15 min", cron: "*/15 * * * *" },
  { label: "Every 30 min", cron: "*/30 * * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Every 2 hours", cron: "0 */2 * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Daily at 9:00 UTC", cron: "0 9 * * *" },
  { label: "Weekdays at 9:00 UTC", cron: "0 9 * * 1-5" },
] as const;

const DAYS = [
  { label: "Mon", value: 1 },
  { label: "Tue", value: 2 },
  { label: "Wed", value: 3 },
  { label: "Thu", value: 4 },
  { label: "Fri", value: 5 },
  { label: "Sat", value: 6 },
  { label: "Sun", value: 0 },
] as const;

type Mode = "preset" | "builder" | "raw";
type FrequencyType = "interval" | "daily" | "weekly";

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [minute, hour, , , dow] = parts;

  // Interval patterns
  if (minute === "*" && hour === "*") return "Every minute";
  if (minute.startsWith("*/") && hour === "*") return `Every ${minute.slice(2)} min`;
  if (minute === "0" && hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;
  if (minute === "0" && hour === "*") return "Every hour";

  // Specific time
  if (hour !== "*" && !hour.startsWith("*/")) {
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")} UTC`;
    if (dow === "*") return `Daily at ${time}`;
    // Parse days
    const dayNums: number[] = [];
    for (const seg of dow.split(",")) {
      if (seg.includes("-")) {
        const [s, e] = seg.split("-").map(Number);
        for (let i = s; i <= e; i++) dayNums.push(i);
      } else dayNums.push(Number(seg));
    }
    const dayNames = dayNums.map((d) => DAYS.find((dd) => dd.value === d)?.label || String(d));
    return `${dayNames.join(", ")} at ${time}`;
  }

  return expr;
}

export function CronBuilder({ value, onChange }: CronBuilderProps) {
  const [mode, setMode] = useState<Mode>("preset");

  // Builder state
  const [freqType, setFreqType] = useState<FrequencyType>("daily");
  const [intervalValue, setIntervalValue] = useState("30");
  const [intervalUnit, setIntervalUnit] = useState<"min" | "hr">("min");
  const [hour, setHour] = useState("9");
  const [minute, setMinute] = useState("0");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);

  const [rawExpr, setRawExpr] = useState(value);
  const [initialized, setInitialized] = useState(false);

  // Sync builder state from value — only auto-switch mode on first mount
  useEffect(() => {
    setRawExpr(value);
    if (!value) return;

    const parts = value.trim().split(/\s+/);
    if (parts.length !== 5) return;
    const [m, h, , , dow] = parts;

    // Always sync builder fields from current value
    if (m.startsWith("*/") && h === "*") {
      setFreqType("interval");
      setIntervalValue(m.slice(2));
      setIntervalUnit("min");
    } else if (m === "0" && h.startsWith("*/")) {
      setFreqType("interval");
      setIntervalValue(h.slice(2));
      setIntervalUnit("hr");
    } else if (h !== "*" && !h.startsWith("*/")) {
      setHour(h);
      setMinute(m);
      if (dow !== "*") {
        setFreqType("weekly");
        const days: number[] = [];
        for (const seg of dow.split(",")) {
          if (seg.includes("-")) {
            const [s, e] = seg.split("-").map(Number);
            for (let i = s; i <= e; i++) days.push(i);
          } else days.push(Number(seg));
        }
        setSelectedDays(days);
      } else {
        setFreqType("daily");
      }
    }

    // Only auto-detect mode on first load
    if (!initialized) {
      setInitialized(true);
      const isPreset = PRESETS.some((p) => p.cron === value);
      if (isPreset) setMode("preset");
      else setMode("builder");
    }
  }, [value, initialized]);

  function buildFromState(type: FrequencyType, h: string, m: string, intVal: string, intUnit: "min" | "hr", days: number[]) {
    if (type === "interval") {
      const n = parseInt(intVal) || 1;
      if (intUnit === "hr") return `0 */${n} * * *`;
      return `*/${n} * * * *`;
    }
    const dow = type === "weekly" && days.length > 0 && days.length < 7
      ? days.sort((a, b) => a - b).join(",")
      : "*";
    return `${m || "0"} ${h || "9"} * * ${dow}`;
  }

  function updateBuilder(updates: Partial<{
    type: FrequencyType; h: string; m: string; intVal: string; intUnit: "min" | "hr"; days: number[];
  }>) {
    const t = updates.type ?? freqType;
    const h = updates.h ?? hour;
    const m = updates.m ?? minute;
    const iv = updates.intVal ?? intervalValue;
    const iu = updates.intUnit ?? intervalUnit;
    const d = updates.days ?? selectedDays;
    if (updates.type !== undefined) setFreqType(t);
    if (updates.h !== undefined) setHour(h);
    if (updates.m !== undefined) setMinute(m);
    if (updates.intVal !== undefined) setIntervalValue(iv);
    if (updates.intUnit !== undefined) setIntervalUnit(iu);
    if (updates.days !== undefined) setSelectedDays(d);
    onChange(buildFromState(t, h, m, iv, iu, d));
  }

  const chipClass = (active: boolean) =>
    `px-2.5 py-1 rounded-md text-[10px] transition-colors ${
      active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
    }`;

  const inputClass =
    "bg-card border border-border rounded-md px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-muted-foreground transition-colors w-16 text-center tabular-nums";

  return (
    <div className="space-y-2">
      {/* Mode tabs */}
      <div className="flex gap-1">
        {(["preset", "builder", "raw"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={chipClass(mode === m)}>
            {m === "preset" ? "Presets" : m === "builder" ? "Builder" : "Raw"}
          </button>
        ))}
        {value && <span className="ml-auto text-[10px] text-muted-foreground self-center font-mono">{value}</span>}
      </div>

      {/* Presets */}
      {mode === "preset" && (
        <div className="grid grid-cols-3 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.cron}
              type="button"
              onClick={() => { onChange(p.cron); setRawExpr(p.cron); }}
              className={`text-left px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                value === p.cron ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Builder */}
      {mode === "builder" && (
        <div className="space-y-3">
          {/* Frequency type */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-14">Repeat</span>
            <div className="flex gap-1">
              {(["interval", "daily", "weekly"] as const).map((t) => (
                <button key={t} type="button" onClick={() => updateBuilder({ type: t })} className={chipClass(freqType === t)}>
                  {t === "interval" ? "Every X" : t === "daily" ? "Daily" : "Weekly"}
                </button>
              ))}
            </div>
          </div>

          {/* Interval config */}
          {freqType === "interval" && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-14">Every</span>
              <input
                type="number"
                min={1}
                max={intervalUnit === "min" ? 59 : 23}
                value={intervalValue}
                onChange={(e) => updateBuilder({ intVal: e.target.value })}
                className={inputClass}
              />
              <div className="flex gap-0.5">
                {(["min", "hr"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => updateBuilder({ intUnit: u })}
                    className={`px-2 py-1 rounded text-[10px] transition-colors ${
                      intervalUnit === u ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {u === "min" ? "minutes" : "hours"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Time picker (daily/weekly) */}
          {(freqType === "daily" || freqType === "weekly") && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-14">At</span>
              <input
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => updateBuilder({ h: e.target.value })}
                placeholder="HH"
                className={inputClass}
              />
              <span className="text-muted-foreground">:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={minute}
                onChange={(e) => updateBuilder({ m: e.target.value })}
                placeholder="MM"
                className={inputClass}
              />
              <span className="text-[10px] text-amber-500/80 font-medium">UTC</span>
            </div>
          )}

          {/* Day picker (weekly) */}
          {freqType === "weekly" && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground w-14">On</span>
              <div className="flex gap-1">
                {DAYS.map(({ label, value: dayVal }) => (
                  <button
                    key={dayVal}
                    type="button"
                    onClick={() => {
                      const next = selectedDays.includes(dayVal)
                        ? selectedDays.filter((d) => d !== dayVal)
                        : [...selectedDays, dayVal];
                      updateBuilder({ days: next });
                    }}
                    className={`w-8 h-7 rounded text-[10px] font-medium transition-colors ${
                      selectedDays.includes(dayVal)
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {selectedDays.length === 0 && <span className="text-[10px] text-muted-foreground">= every day</span>}
            </div>
          )}

          {/* Description */}
          <div className="text-[10px] text-muted-foreground">{describeCron(value)}</div>
        </div>
      )}

      {/* Raw */}
      {mode === "raw" && (
        <div className="space-y-1">
          <input
            type="text"
            value={rawExpr}
            onChange={(e) => { setRawExpr(e.target.value); onChange(e.target.value); }}
            placeholder="* * * * *"
            className="w-full bg-card border border-border rounded-md px-3 py-2 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:border-muted-foreground"
          />
          <div className="text-[10px] text-muted-foreground font-mono">minute hour day-of-month month day-of-week <span className="text-amber-500/80">(all times UTC)</span></div>
        </div>
      )}
    </div>
  );
}

export { describeCron };
