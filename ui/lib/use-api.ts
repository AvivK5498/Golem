"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export function useFetch<T>(url: string, interval?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refetch = useCallback(() => {
    if (!url) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    fetch(url, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (ac.signal.aborted) return;
        setData(d as T);
        setError(null);
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setError(e.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
  }, [url]);

  useEffect(() => {
    refetch();
    if (interval) {
      const id = setInterval(refetch, interval);
      return () => {
        clearInterval(id);
        abortRef.current?.abort();
      };
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [refetch, interval]);

  return { data, loading, error, refetch };
}
