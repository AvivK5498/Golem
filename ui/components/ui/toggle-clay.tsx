"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Clay toggle — pill-shaped switch with a soft inner shadow and a spring-y
 * thumb. Theme-aware via --primary. Replaces native checkbox toggles for
 * binary "on / off" controls that take effect immediately.
 */
interface ToggleClayProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  label?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function ToggleClay({
  checked,
  onCheckedChange,
  size = "md",
  disabled,
  label,
  className,
  ariaLabel,
}: ToggleClayProps) {
  const id = React.useId();
  const track =
    size === "sm" ? "h-4 w-[28px]" : "h-[20px] w-[36px]";
  const thumb =
    size === "sm"
      ? `h-3 w-3 ${checked ? "translate-x-[14px]" : "translate-x-[2px]"}`
      : `h-4 w-4 ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`;

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex items-center gap-2 cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200",
          track,
          checked
            ? "bg-[var(--primary)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]"
            : "bg-[var(--muted)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--background)]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.18),_0_1px_3px_rgba(0,0,0,0.08)] transition-transform duration-200 ease-[cubic-bezier(0.4,1.4,0.4,1)]",
            thumb,
          )}
        />
      </button>
      {label != null && <span className="text-[13px]">{label}</span>}
    </label>
  );
}
