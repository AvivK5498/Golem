"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Clay checkbox — theme-aware replacement for native `<input type=checkbox>`.
 *
 * Visuals: squircle (8px radius) with a subtle inner highlight when unchecked;
 * filled accent with white checkmark when checked. Spring-y transition on the
 * checkmark stroke. Inherits the theme's --primary so it adapts across all
 * five presets.
 */
interface CheckboxClayProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  size?: "sm" | "md";
  label?: React.ReactNode;
}

export function CheckboxClay({
  checked,
  onCheckedChange,
  size = "md",
  label,
  className,
  disabled,
  ...rest
}: CheckboxClayProps) {
  const id = React.useId();
  const dim = size === "sm" ? "h-3.5 w-3.5" : "h-[18px] w-[18px]";
  const iconSize = size === "sm" ? 10 : 12;

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex items-center gap-2 cursor-pointer select-none",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <span className="relative inline-flex items-center justify-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
          {...rest}
        />
        <span
          aria-hidden
          className={cn(
            "inline-flex items-center justify-center rounded-[6px] border transition-all duration-150",
            dim,
            checked
              ? "border-[var(--primary)] bg-[var(--primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25),_0_1px_2px_rgba(0,0,0,0.06)]"
              : "border-[var(--border)] bg-[var(--card)] shadow-[inset_0_1px_0_rgba(255,255,255,0.6),_0_1px_1px_rgba(0,0,0,0.03)] peer-hover:border-[var(--muted-foreground)]",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--ring)] peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--background)]",
          )}
        >
          <Check
            size={iconSize}
            strokeWidth={3}
            className={cn(
              "transition-all duration-200",
              checked
                ? "scale-100 opacity-100 text-[var(--primary-foreground)]"
                : "scale-50 opacity-0",
            )}
          />
        </span>
      </span>
      {label != null && <span className="text-[13px]">{label}</span>}
    </label>
  );
}
