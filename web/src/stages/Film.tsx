import { useEffect, useRef, useState } from "react";
import { Download, Film, Loader2, RotateCw } from "lucide-react";
import { api, assetRawUrl } from "../api/client";
import { pollJob } from "../lib/jobs";
import type { UseProduction } from "../lib/useProduction";
import type { Scoreboard, Shot, Timeline } from "../types";
import { PreviewPlayer } from "../preview/PreviewPlayer";
import { ScoreboardPanel } from "../components/Scoreboard";

interface FilmStageProps {
  ctl: UseProduction;
  exportAssetId: string | null;
}

export function FilmStage({ ctl, exportAssetId }: FilmStageProps) {
  const p = ctl.production!;
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [rerolling, setRerolling] = useState<string | null>(null);

  useEffect(() => {
    api.getScoreboard(p.id).then(setScoreboard).catch(() => {});
    api.getTimeline(p.id).then(setTimeline).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function regenerate(shot: Shot) {
    setRerolling(shot.id);
    try {
      const { job_id } = await api.regenerateShot(p.id, shot.id);
      await pollJob(job_id, { timeoutMs: 10 * 60 * 1000 });
      await ctl.refetch();
      const [sb, tl] = await Promise.all([
        api.getScoreboard(p.id).catch(() => null),
        api.getTimeline(p.id).catch(() => null),
      ]);
      if (sb) setScoreboard(sb);
      if (tl) setTimeline(tl);
    } catch {
      /* surfaced via no state change; user can retry */
    } finally {
      setRerolling(null);
    }
  }

  const shots = p.scenes.flatMap((s) => s.shots);

  return (
    <div className="rc-stage">
      <div className="rc-head">
        <div className="rc-kicker">STAGE 5 · THE FILM</div>
        <h2>{p.title}</h2>
        <p>{p.logline}</p>
      </div>

      <div className="sr-film-grid">
        <div className="sr-film-main">
          <FilmPlayer exportAssetId={exportAssetId} timeline={timeline} />
          {exportAssetId && (
            <a
              className="rc-cta sr-download"
              href={assetRawUrl(exportAssetId)}
              download={`${p.title || "film"}.mp4`}
            >
              <Download size={16} /> Download MP4
            </a>
          )}

          <div className="sr-section-head">Shots · re-roll any</div>
          <div className="sr-film-shots">
            {shots.map((sh, i) => (
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
                  <span className="sr-filmshot-num">{i + 1}</span>
                </div>
                <div className="sr-filmshot-body">
                  <div className="sr-filmshot-action">{sh.action}</div>
                  <div className="sr-filmshot-meta">
                    {sh.shot_type.replace("_", " ")}
                    {typeof sh.critic_score === "number" &&
                      ` · ${sh.critic_score.toFixed(2)}`}
                  </div>
                </div>
                <button
                  className="sr-mini"
                  disabled={rerolling === sh.id}
                  onClick={() => regenerate(sh)}
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
          <ScoreboardPanel scoreboard={scoreboard} />
        </div>
      </div>
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
