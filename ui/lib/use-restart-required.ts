"use client";

/**
 * Tracks whether the platform needs a restart to apply pending changes.
 *
 * State is persisted in localStorage and tied to the platform's `startedAt`
 * timestamp. When the platform actually restarts, `startedAt` changes, and
 * the stored flag is automatically cleared on next read.
 */
import { useCallback, useEffect, useState } from "react";
import { useFetch } from "./use-api";
import { POLL_INTERVAL_MS } from "./constants";
import type { HealthInfo } from "./types";

const STORAGE_KEY = "golem.restartRequired";
const EVENT = "golem:restart-required-changed";

interface StoredFlag {
  startedAt: number; // platform startedAt at the time the flag was set
}

function readFlag(): StoredFlag | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredFlag;
  } catch {
    return null;
  }
}

function writeFlag(value: StoredFlag | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* ignore */
  }
}

export function useRestartRequired() {
  const { data: health } = useFetch<HealthInfo>("/api/health", POLL_INTERVAL_MS);
  const [required, setRequired] = useState(false);

  // Sync from localStorage whenever health.startedAt changes
  useEffect(() => {
    const sync = () => {
      const stored = readFlag();
      if (!stored) {
        setRequired(false);
        return;
      }
      // If the platform has restarted since the flag was set, clear it
      if (health?.startedAt && health.startedAt > stored.startedAt) {
        writeFlag(null);
        setRequired(false);
        return;
      }
      setRequired(true);
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [health?.startedAt]);

  const markRequired = useCallback(() => {
    if (!health?.startedAt) return;
    writeFlag({ startedAt: health.startedAt });
  }, [health?.startedAt]);

  const clear = useCallback(() => {
    writeFlag(null);
  }, []);

  return { required, markRequired, clear };
}
