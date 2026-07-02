import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Download,
  Film,
  Loader2,
  RotateCw,
  Scissors,
  Trash2,
} from "lucide-react";
import { api, assetRawUrl } from "../api/client";
import { pollJob } from "../lib/jobs";
import type { UseProduction } from "../lib/useProduction";
import type { ProductionEval, Scoreboard, Shot, Timeline } from "../types";
import { PreviewPlayer } from "../preview/PreviewPlayer";
import { OrchestrationMap } from "../components/OrchestrationMap";
import { ScoreboardPanel } from "../components/Scoreboard";
import { ProofPanel } from "../components/ProofPanel";
import { DirectorLog } from "../components/DirectorLog";
import { WarningsBanner } from "../components/WarningsBanner";

interface FilmStageProps {
  ctl: UseProduction;
  exportAssetId: string | null;
  /** Open another production (used to jump into the next episode). */
  onOpenProduction?: (id: string) => void;
}

export function FilmStage({ ctl, exportAssetId, onOpenProduction }: FilmStageProps) {
  const p = ctl.production!;
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [evalData, setEvalData] = useState<ProductionEval | null>(null);
  const [rerolling, setRerolling] = useState<string | null>(null);
  // The editor: reorder/cut is free (render only, no regeneration).
  const [dirty, setDirty] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  const [rerenderAsset, setRerenderAsset] = useState<string | null>(null);
  const [epBusy, setEpBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  // StrictMode remounts share the ref — reset to true on (re)mount (see Cast.tsx).
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    void refreshPanels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshPanels() {
    const [sb, tl, ev] = await Promise.all([
      api.getScoreboard(p.id).catch(() => null),
      api.getTimeline(p.id).catch(() => null),
      api.getEval(p.id).catch(() => null),
    ]);
    if (!alive.current) return;
    if (sb) setScoreboard(sb);
    if (tl) setTimeline(tl);
    if (ev) setEvalData(ev);
  }

  async function regenerate(shot: Shot) {
    setRerolling(shot.id);
    setError(null);
    try {
      const { job_id } = await api.regenerateShot(p.id, shot.id);
      const job = await pollJob(job_id, { timeoutMs: 10 * 60 * 1000 });
      const exp = job.result?.export_asset_id;
      if (alive.current && typeof exp === "string") setRerenderAsset(exp);
      await ctl.refetch();
      await refreshPanels();
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Couldn't regenerate the shot");
    } finally {
      if (alive.current) setRerolling(null);
    }
  }

  /** Re-render the recut. FREE: every shot is already generated; this only
   *  recompiles + renders (ffmpeg), so reordering/cutting costs ~0 tokens. */
  async function rerender() {
    setRerendering(true);
    setError(null);
    try {
      await api.saveProduction(p.id, p); // flush the debounced edits first
      const { job_id } = await api.produce(p.id);
      const job = await pollJob(job_id, { timeoutMs: 15 * 60 * 1000 });
      const exp = job.result?.export_asset_id;
      if (alive.current && typeof exp === "string") setRerenderAsset(exp);
      await ctl.refetch();
      await refreshPanels();
      if (alive.current) setDirty(false);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Couldn't re-render the cut");
    } finally {
      if (alive.current) setRerendering(false);
    }
  }

  async function greenlightNextEpisode() {
    if (!onOpenProduction) return;
    setEpBusy(true);
    setError(null);
    try {
      const nxt = await api.nextEpisode(p.id);
      onOpenProduction(nxt.id);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Couldn't start the next episode");
      if (alive.current) setEpBusy(false);
    }
  }

  const moveShot = (sceneId: string, idx: number, dir: -1 | 1) => {
    const scenes = p.scenes.map((sc) => {
      if (sc.id !== sceneId) return sc;
      const shots = [...sc.shots];
      const j = idx + dir;
      if (j < 0 || j >= shots.length) return sc;
      [shots[idx], shots[j]] = [shots[j], shots[idx]];
      return { ...sc, shots: shots.map((s, i) => ({ ...s, index: i })) };
    });
    ctl.update({ ...p, scenes });
    setDirty(true);
  };

  const cutShot = (sceneId: string, shotId: string) => {
    const scenes = p.scenes.map((sc) =>
      sc.id === sceneId
        ? {
            ...sc,
            shots: sc.shots
              .filter((s) => s.id !== shotId)
              .map((s, i) => ({ ...s, index: i })),
          }
        : sc,
    );
    ctl.update({ ...p, scenes });
    setDirty(true);
  };

  // flat rows with scene context so the editor can move within a scene
  const rows = p.scenes.flatMap((sc) =>
    sc.shots.map((sh, i) => ({ sh, sceneId: sc.id, i, len: sc.shots.length })),
  );
  // Prefer the newest render, then the live produce-job result, then persisted.
  const finalAssetId = rerenderAsset ?? exportAssetId ?? p.export_asset_id ?? null;
  const episode = p.episode ?? 1;

  return (
    <div className="rc-stage">
      <div className="rc-head">
        <div className="rc-kicker">
          STAGE 5 · THE FILM{episode > 1 ? ` · EPISODE ${episode}` : ""}
        </div>
        <h2>{p.title}</h2>
        <p>{p.logline}</p>
      </div>

      <WarningsBanner warnings={p.warnings} />
      {error && <div className="rc-err">{error}</div>}

      <div className="sr-film-grid">
        <div className="sr-film-main">
          <FilmPlayer exportAssetId={finalAssetId} timeline={timeline} />
          <div className="sr-film-actions">
            {finalAssetId && (
              <a
                className="rc-cta sr-download"
                href={assetRawUrl(finalAssetId)}
                download={`${p.title || "film"}.mp4`}
                data-testid="download-film"
              >
                <Download size={16} /> Download film
              </a>
            )}
            {onOpenProduction && (
              <button
                className="rc-cta sr-next-ep"
                disabled={epBusy}
                onClick={() => void greenlightNextEpisode()}
                data-testid="next-episode"
              >
                {epBusy ? (
                  <Loader2 size={16} className="rc-spin" />
                ) : (
                  <Clapperboard size={16} />
                )}
                Greenlight Episode {episode + 1}
              </button>
            )}
          </div>

          <div className="sr-section-head">
            The cut · re-roll, reorder, or drop any shot
            {dirty && (
              <button
                className="sr-mini"
                disabled={rerendering}
                onClick={() => void rerender()}
                data-testid="rerender-cut"
              >
                {rerendering ? (
                  <Loader2 size={13} className="rc-spin" />
                ) : (
                  <Scissors size={13} />
                )}
                Re-render the cut (free)
              </button>
            )}
          </div>
          <div className="sr-film-shots">
            {rows.map(({ sh, sceneId, i, len }, k) => (
              <div className="sr-filmshot" key={sh.id}>
                <div className="sr-filmshot-thumb">
                  {sh.asset_id ? (
                    <video
                      src={assetRawUrl(sh.asset_id)}
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <Film size={16} />
                  )}
                  <span className="sr-filmshot-num">{k + 1}</span>
                </div>
                <div className="sr-filmshot-body">
                  <div className="sr-filmshot-action">{sh.action}</div>
                  <div className="sr-filmshot-meta">
                    {sh.shot_type.replace("_", " ")}
                    {typeof sh.critic_score === "number" &&
                      ` · ${sh.critic_score.toFixed(2)}`}
                  </div>
                </div>
                <div className="sr-filmshot-tools">
                  <button
                    className="rc-iconbtn sm"
                    disabled={i === 0}
                    aria-label={`Move shot ${k + 1} earlier`}
                    onClick={() => moveShot(sceneId, i, -1)}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="rc-iconbtn sm"
                    disabled={i === len - 1}
                    aria-label={`Move shot ${k + 1} later`}
                    onClick={() => moveShot(sceneId, i, 1)}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    className="rc-iconbtn sm sr-del"
                    aria-label={`Cut shot ${k + 1} from the film`}
                    onClick={() => cutShot(sceneId, sh.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <button
                  className="sr-mini"
                  disabled={rerolling === sh.id}
                  onClick={() => void regenerate(sh)}
                >
                  {rerolling === sh.id ? (
                    <Loader2 size={13} className="rc-spin" />
                  ) : (
                    <RotateCw size={13} />
                  )}
                  Regenerate
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sr-film-side">
          <ProofPanel ev={evalData} />
          <OrchestrationMap production={p} scoreboard={scoreboard} />
          <ScoreboardPanel scoreboard={scoreboard} />
          <DirectorLog log={p.director_log} />
        </div>
      </div>

      {p.dramatic_question && (
        <div className="sr-closing" data-testid="film-closing">
          <span className="sr-closing-tag">The question</span>
          <p className="sr-closing-q">{p.dramatic_question}</p>
        </div>
      )}
    </div>
  );
}

function FilmPlayer({
  exportAssetId,
  timeline,
}: {
  exportAssetId: string | null;
  timeline: Timeline | null;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  // Prefer the single exported MP4; otherwise replay the compiled timeline.
  if (exportAssetId) {
    return (
      <div className="rc-preview">
        <div className="rc-phone">
          <div className="rc-screen" style={{ background: "#000" }}>
            <video
              ref={ref}
              src={assetRawUrl(exportAssetId)}
              controls
              playsInline
              data-testid="final-video"
            />
          </div>
        </div>
      </div>
    );
  }
  if (timeline && timeline.slots.length > 0) {
    return <PreviewPlayer timeline={timeline} />;
  }
  return (
    <div className="rc-preview">
      <div className="rc-phone">
        <div className="rc-screen" style={{ background: "#0d0b12" }}>
          <div className="rc-screenghost">no export yet</div>
        </div>
      </div>
    </div>
  );
}
