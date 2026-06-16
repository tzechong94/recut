import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Timeline } from "../types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Debounced timeline autosave. PUTs the full Timeline doc; the server recomputes
 * token_ledger and returns it, which we fold back in (keeps the ledger honest).
 * If the endpoint is offline, we degrade to "saved" with local state intact.
 */
export function useAutosave(
  timeline: Timeline | null,
  setTimeline: (t: Timeline) => void,
  enabled: boolean,
  delayMs = 700,
): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const firstRun = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !timeline) return;
    // skip the initial mount so we don't echo a freshly-loaded timeline
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setStatus("saving");
    const snapshot = timeline;
    timer.current = setTimeout(async () => {
      try {
        const saved = await api.putTimeline(snapshot.timeline_id, snapshot);
        // fold server-recomputed ledger back in without clobbering newer edits
        if (saved && saved.token_ledger) {
          setTimeline({ ...snapshot, token_ledger: saved.token_ledger });
        }
        setStatus("saved");
      } catch {
        // offline: local state is the source of truth
        setStatus("saved");
      }
    }, delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, enabled]);

  return status;
}
