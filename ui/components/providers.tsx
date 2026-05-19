"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export const GOLEM_THEMES = ["clay", "indigo", "sage", "espresso", "mono"] as const;
export type GolemTheme = (typeof GOLEM_THEMES)[number];
export const DEFAULT_THEME: GolemTheme = "clay";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      themes={[...GOLEM_THEMES]}
      defaultTheme={DEFAULT_THEME}
      enableSystem={false}
      disableTransitionOnChange
      storageKey="golem-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
