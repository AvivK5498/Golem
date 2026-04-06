"use client";

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";

interface AutoTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  maxHeight?: number;
  minRows?: number;
}

export const AutoTextarea = forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  function AutoTextarea({ maxHeight = 400, minRows = 3, value, onChange, className, ...props }, ref) {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => innerRef.current!);

    const resize = useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = "auto";
      const scrollH = el.scrollHeight;
      el.style.height = `${Math.min(scrollH, maxHeight)}px`;
    }, [maxHeight]);

    useEffect(() => { resize(); }, [value, resize]);

    return (
      <textarea
        ref={innerRef}
        value={value}
        onChange={onChange}
        rows={minRows}
        className={`w-full bg-card/60 border border-border rounded-md px-3 py-2 text-xs text-foreground font-mono leading-relaxed resize-none outline-none focus:border-muted-foreground transition-colors ${className ?? ""}`}
        style={{ overflow: "auto", maxHeight }}
        {...props}
      />
    );
  },
);
