import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  Film,
  Loader2,
  XCircle,
} from "lucide-react";
import { api } from "../api/client";
import { pollJob } from "../lib/jobs";
import type { UseProduction } from "../lib/useProduction";
import type {
  Job,
  Production,
  Scoreboard,
  Shot,
  ShotStatus,
  Timeline,
} from "../types";
import { PreviewPlayer } from "../preview/PreviewPlayer";
import { ScoreboardPanel } from "../components/Scoreboard";
import { ShotBadges } from "../components/ShotBadges";
import { DirectorLog } from "../components/DirectorLog";
import { WarningsBanner } from "../components/WarningsBanner";

interface StageProps {
  ctl: UseProduction;
  onAdvance: () => void;
  onExport?: (assetId: string) => void;
}

type RunState = "idle" | "running" | "done" | "failed";

export function ProduceStage({ ctl, onAdvance, onExport }: StageProps) {
  const p = ctl.production!;
  const [run, setRun] = useState<RunState>(
    p.stage === "export" ? "done" : "idle",
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const startedRef = useRef(false);
  const stopRef = useRef(false);

  // Poll production + scoreboard + timeline while producing, so per-shot status
  // and the live scoreboard fill in independently of the job's coarse progress.
  useEffect(() => {
    if (run !== "running") return;
    stopRef.current = false;
    let delay = 1500;
    let cancelled = false;
    async function loop() {
      while (!cancelled && !stopRef.current) {
        await Promise.allSettled([
          ctl.refetch(),
          api.getScoreboard(p.id).then(setScoreboard).catch(() => {}),
          api.getTimeline(p.id).then(setTimeline).catch(() => {}),
        ]);
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(4000, delay + 300);
      }
    }
    void loop();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // Load a static snapshot when revisiting a finished production.
  useEffect(() => {
    if (run === "done") {
      api.getScoreboard(p.id).then(setScoreboard).catch(() => {});
      api.getTimeline(p.id).then(setTimeline).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    if (startedRef.current) return;
    startedRef.current = true;
    setRun("running");
    setError(null);
    setProgress(0);
    try {
      const { job_id } = await api.produce(p.id);
      const finalJob = await pollJob(job_id, {
        onProgress: (j: Job) => setProgress(j.progress ?? 0),
        timeoutMs: 20 * 60 * 1000,
      });
      const exportId = finalJob.result?.export_asset_id;
      if (exportId) onExport?.(exportId);
      stopRef.current = true;
      await Promise.allSettled([
        ctl.refetch(),
        api.getScoreboard(p.id).then(setScoreboard).catch(() => {}),
        api.getTimeline(p.id).then(setTimeline).catch(() => {}),
      ]);
      setRun("done");
    } catch (e) {
      stopRef.current = true;
      setError(e instanceof Error ? e.message : "Production failed");
      setRun("failed");
      startedRef.current = false;
    }
  }

  const shots = p.scenes.flatMap((s) => s.shots);
  const ready = shots.filter((s) => s.asset_id).length;

  return (
    <div className="rc-stage">
      <div className="rc-head">
        <div className="rc-kicker">STAGE 4 · ACTION</div>
        <h2>{run === "idle" ? "Roll camera" : "In production"}</h2>
        <p>
          The agent generates each shot with image-to-video, then a consistency
          critic scores it against the show bible and re-rolls if it drifts. This
          is where the video tokens are spent — watch the scoreboard.
        </p>
      </div>

      {error && (
        <div className="rc-err sr-produce-err">
          <XCircle size={15} /> {error}
        </div>
      )}

      <WarningsBanner warnings={p.warnings} />

      {run === "idle" ? (
        <div className="sr-action-gate">
          <Clapperboard size={40} />
          <h3>{shots.length} shots ready to generate</h3>
          <p>
            Everything up to here was cheap text &amp; stills. Pressing action
            commits the expensive video pass. Make sure the board is right.
          </p>
          <button className="rc-cta sr-action-btn" onClick={start}>
            <Clapperboard size={17} /> Action — produce the film
          </button>
        </div>
      ) : (
        <div className="sr-produce-grid">
          <div className="sr-produce-main">
            <div className="sr-produce-progress">
              <div className="sr-produce-progress-head">
                <span>
                  {run === "done" ? (
                    <>
                      <CheckCircle2 size={15} /> Film complete
                    </>
                  ) : (
                    <>
                      <Loader2 size={15} className="rc-spin" /> Generating…{" "}
                      {ready}/{shots.length} shots ready
                    </>
                  )}
                </span>
                <span className="sr-produce-pct">
                  {Math.round((run === "done" ? 1 : progress) * 100)}%
                </span>
              </div>
              <div className="rc-exportbar">
                <i
                  style={{
                    width: `${Math.round((run === "done" ? 1 : progress) * 100)}%`,
                  }}
                />
              </div>
            </div>

            <div className="sr-shotlist" data-testid="shot-status-list">
              {shots.map((sh, i) => (
                <ShotStatusRow key={sh.id} shot={sh} index={i} production={p} />
              ))}
            </div>

            {run === "done" && (
              <div className="rc-foot">
                <span className="rc-note">
                  All shots resolved — review the cut and export.
                </span>
                <button className="rc-cta" onClick={onAdvance}>
                  See the film <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>

          <div className="sr-produce-side">
            {timeline && timeline.slots.length > 0 ? (
              <PreviewPlayer timeline={timeline} />
            ) : (
              <div className="rc-preview">
                <div className="rc-phone">
                  <div
                    className="rc-screen"
                    style={{ background: "#0d0b12" }}
                  >
                    <div className="rc-screenghost">building cut…</div>
                  </div>
                </div>
              </div>
            )}
            <ScoreboardPanel scoreboard={scoreboard} live={run === "running"} />
            <DirectorLog log={p.director_log} live={run === "running"} />
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_META: Record<
  ShotStatus,
  { label: string; cls: string }
> = {
  planned: { label: "planned", cls: "planned" },
  standin: { label: "stand-in", cls: "planned" },
  generating: { label: "generating", cls: "generating" },
  ready: { label: "ready", cls: "ready" },
  failed: { label: "failed", cls: "failed" },
};

/** Effective status: an asset means ready even if status lags. */
export function effectiveStatus(shot: Shot): ShotStatus {
  if (shot.asset_id) return "ready";
  return shot.status;
}

function ShotStatusRow({
  shot,
  index,
  production,
}: {
  shot: Shot;
  index: number;
  production: Production;
}) {
  const status = effectiveStatus(shot);
  const meta = STATUS_META[status] ?? STATUS_META.planned;
  const loc = production.locations.find((l) => l.id === shot.location_id);

  return (
    <div className={"sr-shotrow status-" + meta.cls}>
      <div className="sr-shotrow-num">{index + 1}</div>
      <div className="sr-shotrow-body">
        <div className="sr-shotrow-action">
          {shot.action ||
            shot.dialogue.map((d) => d.line).join(" ") ||
            shot.narration ||
            "Shot " + (index + 1)}
        </div>
        <div className="sr-shotrow-meta">
          {shot.shot_type.replace("_", " ")} · {shot.camera.replace("_", " ")}
          {loc && ` · ${loc.name}`}
        </div>
        <ShotBadges shot={shot} />
      </div>
      <div className={"sr-shotrow-status " + meta.cls}>
        {status === "generating" && (
          <Loader2 size={12} className="rc-spin" />
        )}
        {status === "ready" && <Film size={12} />}
        {status === "failed" && <XCircle size={12} />}
        {meta.label}
      </div>
    </div>
  );
}
