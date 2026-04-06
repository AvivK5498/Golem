"use client";

import { ReactNode } from "react";

export function SectionCard({
  accent,
  headerColor,
  title,
  badge,
  trailing,
  children,
}: {
  accent: string;
  headerColor: string;
  title: string;
  badge?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`border border-border rounded-lg border-l-2 ${accent} bg-card/30`}>
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
        <h2 className={`text-[10px] uppercase tracking-wider font-medium ${headerColor}`}>{title}</h2>
        {badge}
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>
      <div className="px-4 py-3 space-y-3">
        {children}
      </div>
    </div>
  );
}
