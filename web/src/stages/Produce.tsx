import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clapperboard,
  Film,
  Loader2,
  Square,
  XCircle,
} from "lucide-react";
import { api, assetRawUrl } from "../api/client";
import { pollJob } from "../lib/jobs";
import type { UseProduction } from "../lib/useProduction";
import type {
  Job,
  Pricing,
  Production,
  Scoreboard,
  Shot,
  ShotStatus,
  Timeline,
} from "../types";
import { PreviewPlayer } from "../preview/PreviewPlayer";
import { OrchestrationMap } from "../components/OrchestrationMap";
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
  const [notice, setNotice] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pilotN, setPilotN] = useState(0); // 0 = film everything
  const [jobId, setJobId] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const startedRef = useRef(false);
  const stopRef = useRef(false);

  useEffect(() => {
    api.getPricing().then(setPricing).catch(() => {});
  }, []);

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

  /** Fire a browser notification if the user has walked away from the tab. */
  function notify(title: string, body: string) {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
        new Notification(title, { body });
      }
    } catch {
      /* notifications are a nicety, never an error */
    }
  }

  async function start(shotIds: string[] = []) {
    if (startedRef.current) return;
    startedRef.current = true;
    setRun("running");
    setError(null);
    setNotice(null);
    setProgress(0);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
      const { job_id } = await api.produce(p.id, shotIds);
      setJobId(job_id);
      const finalJob = await pollJob(job_id, {
        onProgress: (j: Job) => setProgress(j.progress ?? 0),
        timeoutMs: 30 * 60 * 1000,
      });
      stopRef.current = true;
      await Promise.allSettled([
        ctl.refetch(),
        api.getScoreboard(p.id).then(setScoreboard).catch(() => {}),
        api.getTimeline(p.id).then(setTimeline).catch(() => {}),
      ]);
      if (finalJob.result?.cancelled) {
        setNotice("Stopped — every finished shot was kept. Press Action to resume where it left off.");
        notify("Production stopped", "Finished shots kept; press Action to resume.");
        setRun("idle");
        startedRef.current = false;
      } else if (finalJob.result?.pilot) {
        setNotice("Pilot shots ready — review them below, then press Action to film the rest.");
        notify("Pilot shots ready", "Review the pilot, then film the rest.");
        setPilotN(0);
        setRun("idle");
        startedRef.current = false;
      } else {
        const exportId = finalJob.result?.export_asset_id;
        if (exportId) onExport?.(exportId);
        notify("Your film is ready", `${p.title} finished rendering.`);
        setRun("done");
      }
    } catch (e) {
      stopRef.current = true;
      setError(e instanceof Error ? e.message : "Production failed");
      notify("Production failed", "Open Recut to see what happened.");
      setRun("failed");
      startedRef.current = false;
    } finally {
      setStopping(false);
      setJobId(null);
    }
  }

  async function stop() {
    if (!jobId || stopping) return;
    setStopping(true);
    try {
      await api.cancelJob(jobId);
    } catch {
      setStopping(false);
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
          <h3>The run sheet — what happens when you call action</h3>
          {notice && <div className="sr-gate-notice">{notice}</div>}

          <div className="sr-gate-controls">
            <label className="sr-gate-control">
              Video quality
              <select
                value={p.video_quality === "ship" ? "ship" : "draft"}
                aria-label="Mode"
                onChange={(e) => ctl.update({ ...p, video_quality: e.target.value })}
              >
                <option value="draft">Draft — silent shots on Wan flash (cheap rehearsal)</option>
                <option value="ship">Ship — silent shots on Wan plus (full quality)</option>
              </select>
              <span className="sr-gate-hint">
                dialogue always speaks — your cast voices, lip-synced
              </span>
            </label>
            <label className="sr-gate-control">
              Pilot
              <select
                value={pilotN}
                aria-label="Pilot shots"
                onChange={(e) => setPilotN(Number(e.target.value))}
              >
                <option value={0}>film everything</option>
                <option value={2}>first 2 shots only</option>
                <option value={3}>first 3 shots only</option>
              </select>
            </label>
          </div>

          <RunSheet production={p} pricing={pricing} pilotN={pilotN} />

          {ready > 0 && (
            <div className="sr-pilot-review" data-testid="pilot-shots">
              <div className="sr-pilot-review-head">
                Watch the {ready} filmed shot{ready === 1 ? "" : "s"} — retake any
                with a note before committing the rest
              </div>
              {shots.map((sh, i) =>
                sh.asset_id ? (
                  <PilotShot
                    key={sh.id}
                    shot={sh}
                    index={i}
                    productionId={p.id}
                    onDone={() => void ctl.refetch()}
                  />
                ) : null,
              )}
            </div>
          )}

          <p>
            You're approving this exact plan. Everything above the line is
            already paid (cheap text &amp; stills); video spend starts below it.
          </p>
          <button
            className="rc-cta sr-action-btn"
            onClick={() => void start(pilotN > 0 ? shots.slice(0, pilotN).map((s) => s.id) : [])}
          >
            <Clapperboard size={17} />
            {pilotN > 0
              ? `Action — film the ${pilotN}-shot pilot`
              : ready > 0
                ? "Action — film the rest"
                : "Action — approve the plan & roll"}
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
                {run === "running" && (
                  <button
                    className="sr-mini sr-stop"
                    disabled={stopping || !jobId}
                    onClick={() => void stop()}
                    data-testid="stop-production"
                  >
                    {stopping ? (
                      <Loader2 size={13} className="rc-spin" />
                    ) : (
                      <Square size={13} />
                    )}
                    {stopping ? "Stopping after this shot…" : "Stop"}
                  </button>
                )}
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
            <OrchestrationMap production={p} scoreboard={scoreboard} />
            <DirectorLog log={p.director_log} live={run === "running"} />
          </div>
        </div>
      )}
    </div>
  );
}

/** The approval artifact: every call the agent will make, with the estimated spend in
 *  DOLLARS (editable price table) and wall-clock. The human approves THIS, not a vibe. */
function RunSheet({
  production: p,
  pricing,
  pilotN,
}: {
  production: Production;
  pricing: Pricing | null;
  pilotN: number;
}) {
  const all = p.scenes.flatMap((s) => s.shots);
  const target = pilotN > 0 ? all.slice(0, pilotN) : all;
  // THE CONTRACT: shots with a chosen take are NEVER re-filmed by this run
  const kept = target.filter((s) => s.chosen_take_id);
  const toFilm = target.filter((s) => !s.chosen_take_id);
  const speakingShots = toFilm.filter((s) => s.dialogue.some((d) => d.line.trim()));
  const silentShots = toFilm.filter((s) => !s.dialogue.some((d) => d.line.trim()));
  const stills = all.filter((s) => s.keyframe_asset_id || s.keyframe_url).length;
  const gated = all.filter((s) => s.keyframe_score != null).length;
  const draft = (p.video_quality ?? "draft") !== "ship";
  const speakRate = pricing ? (pricing.video_second_happyhorse ?? pricing.video_second_final) : null;
  const silentRate = pricing ? (draft ? pricing.video_second_draft : pricing.video_second_final) : null;
  const speakSecs = speakingShots.reduce((a, s) => a + s.duration_s, 0);
  const silentSecs = silentShots.reduce((a, s) => a + s.duration_s, 0);
  const speakUsd = speakRate != null ? speakSecs * speakRate : null;
  const silentUsd = silentRate != null ? silentSecs * silentRate : null;
  const voiceUsd = pricing ? (speakingShots.length * 60 * pricing.voice_1k) / 1000 : null;
  const minutes = Math.max(2, Math.ceil(speakingShots.length * 3 + silentShots.length * (draft ? 1.5 : 3)));
  const usd = (v: number | null) => (v == null ? "" : `≈$${v.toFixed(2)}`);
  return (
    <div className="sr-runsheet" data-testid="run-sheet">
      <div className="sr-rs-row is-done">
        <span>{stills}/{all.length} board stills composed{gated ? ` · ${gated} gated by the critic` : ""}</span>
        <b>already spent (image)</b>
      </div>
      {kept.length > 0 && (
        <div className="sr-rs-row is-done">
          <span>{kept.length} shot{kept.length === 1 ? "" : "s"} keep their APPROVED takes — never re-filmed</span>
          <b>$0 · the contract</b>
        </div>
      )}
      <div className="sr-rs-line" aria-hidden="true" />
      {speakingShots.length > 0 && (
        <div className="sr-rs-row">
          <span>
            {speakingShots.length} speaking shot{speakingShots.length === 1 ? "" : "s"} — wan2.6 i2v, YOUR cast
            voices lip-synced (both modes)
          </span>
          <b>{usd(speakUsd)}</b>
        </div>
      )}
      {silentShots.length > 0 && (
        <div className="sr-rs-row">
          <span>
            {silentShots.length} silent/action shot{silentShots.length === 1 ? "" : "s"} — Wan {draft ? "flash (DRAFT)" : "plus (SHIP)"}
          </span>
          <b>{usd(silentUsd)}</b>
        </div>
      )}
      <div className="sr-rs-row">
        <span>Qwen-VL critic verifies every new take against its approved still</span>
        <b>re-rolls bounded: ≤2 per drifted shot</b>
      </div>
      <div className="sr-rs-row">
        <span>Character voices — qwen3-tts (embedded + lip-synced on speaking shots)</span>
        <b>{usd(voiceUsd)} voice (tiny)</b>
      </div>
      <div className="sr-rs-row">
        <span>Assemble: music bed, captions, title cards, ffmpeg render</span>
        <b>$0 · 0 model tokens</b>
      </div>
      <div className="sr-rs-total">
        {(speakUsd != null || silentUsd != null) && (
          <b>total ≈${((speakUsd ?? 0) + (silentUsd ?? 0) + (voiceUsd ?? 0)).toFixed(2)}</b>
        )}
        <span> · ≈{minutes} min{pilotN > 0 ? ` · pilot: first ${pilotN} shots only` : ""} · prices editable in settings</span>
      </div>
    </div>
  );
}

/** One filmed pilot shot: WATCH it, then retake with a director's note. */
function PilotShot({
  shot,
  index,
  productionId,
  onDone,
}: {
  shot: Shot;
  index: number;
  productionId: string;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function retake() {
    setBusy(true);
    try {
      const { job_id } = await api.regenerateShot(productionId, shot.id, note.trim());
      await pollJob(job_id, { timeoutMs: 15 * 60 * 1000 });
      setNote("");
      onDone();
    } catch {
      /* row resets; user can retry */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sr-pilotshot">
      <video
        className="sr-pilotshot-video"
        src={assetRawUrl(shot.asset_id!)}
        controls
        playsInline
        preload="metadata"
      />
      <div className="sr-pilotshot-body">
        <div className="sr-pilotshot-title">Shot {index + 1}</div>
        <div className="sr-pilotshot-action">{shot.action}</div>
        {typeof shot.critic_score === "number" && (
          <div className="sr-pilotshot-meta">consistency {shot.critic_score.toFixed(2)}</div>
        )}
        <input
          className="sr-edit sr-pilotshot-note"
          value={note}
          disabled={busy}
          placeholder="Retake note — “slower, hold on her face”"
          aria-label={`Retake note for shot ${index + 1}`}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !busy) void retake();
          }}
        />
        <button className="sr-mini" disabled={busy} onClick={() => void retake()}>
          {busy ? <Loader2 size={13} className="rc-spin" /> : <Film size={13} />}
          {busy ? "Retaking…" : "Retake this shot"}
        </button>
      </div>
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
