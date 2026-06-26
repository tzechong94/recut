import { useEffect, useRef } from "react";
import { Clapperboard } from "lucide-react";
import type { DirectorLogEntry } from "../types";

/**
 * The agent's per-shot reasoning, rendered as a live, scrolling feed:
 *   shot → decision → reason.
 *
 * This is the visible "multimodal orchestration" showpiece — it should feel
 * like watching a director think out loud while production runs. When `live`,
 * the panel auto-scrolls to the newest decision as entries arrive.
 */
export function DirectorLog({
  log,
  live = false,
}: {
  log: DirectorLogEntry[] | undefined;
  live?: boolean;
}) {
  const entries = log ?? [];
  const threadRef = useRef<HTMLDivElement | null>(null);

  // Stick to the bottom as new decisions land while producing.
  useEffect(() => {
    if (!live) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, live]);

  return (
    <div className="sr-dirlog" data-testid="director-log">
      <div className="sr-dirlog-head">
        <Clapperboard size={15} /> Director&rsquo;s log
        {live && (
          <span className="sr-dirlog-live" data-testid="director-log-live">
            <i className="sr-dirlog-pulse" /> LIVE
          </span>
        )}
        {entries.length > 0 && (
          <span className="sr-dirlog-count">{entries.length}</span>
        )}
      </div>
      <div className="sr-dirlog-thread" ref={threadRef}>
        {entries.length === 0 ? (
          <p className="sr-empty-note">
            The director&rsquo;s decisions will appear here as each shot is
            generated.
          </p>
        ) : (
          entries.map((e, i) => (
            <div className="sr-dirlog-entry" key={`${e.shot}-${i}`}>
              <div className="sr-dirlog-shot">{e.shot}</div>
              <div className="sr-dirlog-decision">{e.decision}</div>
              <div className="sr-dirlog-reason">{e.reason}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
