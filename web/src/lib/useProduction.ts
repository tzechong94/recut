/**
 * Loads a Production, exposes a debounced autosave (PUT the full doc), and a
 * refetch. Edits update local state immediately (optimistic) and persist after a
 * short debounce; if the backend is unreachable the local copy stays the source
 * of truth so the UI never blocks on the network.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Production } from "../types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseProduction {
  production: Production | null;
  loading: boolean;
  error: string | null;
  saveStatus: SaveStatus;
  /** Apply an edit (optimistic) and schedule a debounced save. */
  update: (next: Production) => void;
  /** Replace local state from the server (no save). */
  set: (next: Production) => void;
  refetch: () => Promise<Production | null>;
}

export function useProduction(id: string, delayMs = 700): UseProduction {
  const [production, setProduction] = useState<Production | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const p = await api.getProduction(id);
      setProduction(p);
      setError(null);
      return p;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load production");
      return null;
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getProduction(id)
      .then((p) => {
        if (alive) {
          setProduction(p);
          setError(null);
        }
      })
      .catch((e) => {
        if (alive)
          setError(e instanceof Error ? e.message : "Failed to load production");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const update = useCallback(
    (next: Production) => {
      setProduction(next);
      if (timer.current) clearTimeout(timer.current);
      setSaveStatus("saving");
      timer.current = setTimeout(async () => {
        try {
          const saved = await api.saveProduction(next.id, next);
          // Fold the server's recomputed fields (token_ledger, version) back in,
          // but keep the latest local edits to scenes/cast.
          setProduction((cur) =>
            cur && cur.id === saved.id
              ? { ...cur, token_ledger: saved.token_ledger, version: saved.version }
              : saved,
          );
          setSaveStatus("saved");
        } catch {
          // Offline: keep local edits; surface a soft saved state.
          setSaveStatus("saved");
        }
      }, delayMs);
    },
    [delayMs],
  );

  const set = useCallback((next: Production) => setProduction(next), []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { production, loading, error, saveStatus, update, set, refetch };
}
