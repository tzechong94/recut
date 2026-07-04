import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Clapperboard,
  ImageIcon,
  Loader2,
  Plus,
  RotateCw,
  Trash2,
  Users,
} from "lucide-react";
import { api, assetRawUrl } from "../api/client";
import { pollJob } from "../lib/jobs";
import type { UseProduction } from "../lib/useProduction";
import type { Production, Scene, Shot } from "../types";
import { Editable } from "../components/Editable";
import { ShotBadges } from "../components/ShotBadges";

interface StageProps {
  ctl: UseProduction;
  onAdvance: () => void;
}

const SHOT_TYPES = ["wide", "medium", "close_up", "insert", "two_shot"];
const CAMERAS = ["static", "pan", "push_in", "pull_out", "handheld", "aerial"];

/** Mirror of the backend's still_signature — the fields a still is composed from.
 *  A mismatch with shot.keyframe_sig means the still no longer shows what will be
 *  filmed (stale). Keep the format in sync with production.py. */
function stillSignature(sh: Shot): string {
  return [
    sh.action.trim(),
    sh.shot_type,
    [...sh.character_ids].sort().join(","),
    sh.location_id || "",
  ].join("|");
}

function isStale(sh: Shot): boolean {
  const hasStill = Boolean(sh.keyframe_asset_id || sh.keyframe_url);
  return hasStill && Boolean(sh.keyframe_sig) && sh.keyframe_sig !== stillSignature(sh);
}

export function StoryboardStage({ ctl, onAdvance }: StageProps) {
  const p = ctl.production!;
  const [building, setBuilding] = useState(false);
  const [stillsBusy, setStillsBusy] = useState(false);
  const [stillBusy, setStillBusy] = useState<string | null>(null);
  const [animaticBusy, setAnimaticBusy] = useState(false);
  const [animaticAsset, setAnimaticAsset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  // StrictMode remounts share the ref — reset to true on (re)mount (see Cast.tsx).
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const hasShots = p.scenes.some((s) => s.shots.length > 0);

  useEffect(() => {
    if (!hasShots && !building) void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function build() {
    setBuilding(true);
    setError(null);
    try {
      const next = await api.storyboard(p.id);
      ctl.set(next);
      void generateStills(); // a board without pictures isn't a board
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the storyboard");
    } finally {
      setBuilding(false);
    }
  }

  /** Generate every missing shot still — the exact frames produce will animate.
   *  Stills stream into the board as each one lands (the job saves per shot). */
  async function generateStills() {
    setStillsBusy(true);
    setError(null);
    try {
      const { job_id } = await api.boardStills(p.id);
      await pollJob(job_id, {
        timeoutMs: 15 * 60 * 1000,
        onProgress: () => { if (alive.current) void ctl.refetch(); },
      });
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Couldn't generate the stills");
    } finally {
      if (alive.current) {
        await ctl.refetch().catch(() => {});
        setStillsBusy(false);
      }
    }
  }

  /** THE ANIMATIC: the whole film from these stills + real voices — $0 video. */
  async function playAnimatic() {
    setAnimaticBusy(true);
    setError(null);
    try {
      const { job_id } = await api.animatic(p.id);
      const job = await pollJob(job_id, { timeoutMs: 10 * 60 * 1000 });
      const asset = job.result?.animatic_asset_id;
      if (alive.current && typeof asset === "string") setAnimaticAsset(asset);
      await ctl.refetch().catch(() => {});
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Couldn't build the animatic");
    } finally {
      if (alive.current) setAnimaticBusy(false);
    }
  }

  /** Redo ONE still, steered by the card's note. */
  async function redoStill(shotId: string, note: string) {
    setStillBusy(shotId);
    setError(null);
    try {
      const { job_id } = await api.shotStill(p.id, shotId, note);
      await pollJob(job_id, { timeoutMs: 10 * 60 * 1000 });
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "Couldn't redo the still");
    } finally {
      if (alive.current) {
        await ctl.refetch().catch(() => {});
        setStillBusy(null);
      }
    }
  }

  const setScenes = (scenes: Scene[]) => ctl.update({ ...p, scenes });

  const setShot = (sceneId: string, shotId: string, next: Partial<Shot>) =>
    setScenes(
      p.scenes.map((sc) =>
        sc.id === sceneId
          ? {
              ...sc,
              shots: sc.shots.map((sh) =>
                sh.id === shotId ? { ...sh, ...next } : sh,
              ),
            }
          : sc,
      ),
    );

  const moveShot = (sceneId: string, idx: number, dir: -1 | 1) =>
    setScenes(
      p.scenes.map((sc) => {
        if (sc.id !== sceneId) return sc;
        const shots = [...sc.shots];
        const j = idx + dir;
        if (j < 0 || j >= shots.length) return sc;
        [shots[idx], shots[j]] = [shots[j], shots[idx]];
        return { ...sc, shots: shots.map((s, i) => ({ ...s, index: i })) };
      }),
    );

  const removeShot = (sceneId: string, shotId: string) =>
    setScenes(
      p.scenes.map((sc) =>
        sc.id === sceneId
          ? {
              ...sc,
              shots: sc.shots
                .filter((s) => s.id !== shotId)
                .map((s, i) => ({ ...s, index: i })),
            }
          : sc,
      ),
    );

  const addShot = (sceneId: string) =>
    setScenes(
      p.scenes.map((sc) =>
        sc.id === sceneId ? { ...sc, shots: [...sc.shots, newShot(sc)] } : sc,
      ),
    );

  if (building && !hasShots) {
    return (
      <div className="rc-stage">
        <div className="rc-head">
          <div className="rc-kicker">STAGE 3 · THE BOARD</div>
          <h2>Boarding every shot…</h2>
        </div>
        <div className="rc-loading">
          <Loader2 size={26} className="rc-spin" />
          <span>The director is breaking scenes into shots.</span>
        </div>
      </div>
    );
  }

  const totalShots = p.scenes.reduce((a, s) => a + s.shots.length, 0);
  const totalDur = p.scenes
    .flatMap((s) => s.shots)
    .reduce((a, s) => a + s.duration_s, 0);
  const missingStills = p.scenes
    .flatMap((s) => s.shots)
    .filter((s) => !s.keyframe_asset_id && !s.keyframe_url).length;
  const staleStills = p.scenes.flatMap((s) => s.shots).filter(isStale).length;

  return (
    <div className="rc-stage">
      <div className="rc-head">
        <div className="rc-kicker">STAGE 3 · THE BOARD</div>
        <h2>Shot board</h2>
        <p>
          Every still below is the exact first frame the film will animate.
          Fix the pictures here — notes and redos cost cheap image tokens.
          Video tokens are spent only on frames you approve.
        </p>
      </div>

      {error && <div className="rc-err">{error}</div>}

      {missingStills < totalShots && (
        <div className="sr-animatic-bar">
          <button
            className="sr-mini"
            disabled={animaticBusy || stillsBusy}
            onClick={() => void playAnimatic()}
            data-testid="watch-animatic"
          >
            {animaticBusy ? <Loader2 size={13} className="rc-spin" /> : <Clapperboard size={13} />}
            {animaticBusy ? "Building the animatic…" : "Watch animatic — $0 video"}
          </button>
          <span>
            The whole film as your stills + real character voices, before any video
            spend. If the animatic works, the film works.
          </span>
        </div>
      )}
      {animaticAsset && (
        <div className="sr-animatic-player" data-testid="animatic-player">
          <video src={assetRawUrl(animaticAsset)} controls playsInline />
        </div>
      )}

      {(stillsBusy || missingStills > 0 || staleStills > 0) && (
        <div className="sr-stills-bar">
          {stillsBusy ? (
            <>
              <Loader2 size={14} className="rc-spin" />
              <span>Composing stills — each shot's character placed into its set…</span>
            </>
          ) : (
            <>
              <ImageIcon size={14} />
              <span>
                {missingStills > 0 &&
                  `${missingStills} shot${missingStills === 1 ? "" : "s"} without a still`}
                {missingStills > 0 && staleStills > 0 && " · "}
                {staleStills > 0 &&
                  `${staleStills} still${staleStills === 1 ? "" : "s"} stale after edits — redo before approving`}
              </span>
              {missingStills > 0 && (
                <button className="sr-mini" onClick={() => void generateStills()}>
                  <ImageIcon size={13} /> Generate stills
                </button>
              )}
            </>
          )}
        </div>
      )}

      {p.scenes.map((sc) => (
        <section className="sr-board-scene" key={sc.id}>
          <div className="sr-board-heading">
            <Clapperboard size={14} />
            <span>{sc.heading || `Scene ${sc.index + 1}`}</span>
            <span className="sr-board-summary">{sc.summary}</span>
          </div>
          <div className="sr-shots">
            {sc.shots.map((sh, i) => (
              <ShotCard
                key={sh.id}
                shot={sh}
                index={i}
                production={p}
                first={i === 0}
                last={i === sc.shots.length - 1}
                stillPending={
                  stillBusy === sh.id ||
                  (stillsBusy && !sh.keyframe_asset_id && !sh.keyframe_url)
                }
                onRedoStill={(note) => void redoStill(sh.id, note)}
                onChange={(n) => setShot(sc.id, sh.id, n)}
                onUp={() => moveShot(sc.id, i, -1)}
                onDown={() => moveShot(sc.id, i, 1)}
                onRemove={() => removeShot(sc.id, sh.id)}
              />
            ))}
            <button className="rc-add" onClick={() => addShot(sc.id)}>
              <Plus size={15} /> Add shot
            </button>
          </div>
        </section>
      ))}

      <div className="rc-foot">
        <div className="rc-footl">
          <span className="rc-note">
            {totalShots} shots · ~{Math.round(totalDur)}s film · est. ≈
            {Math.round(totalDur * 1.8)}k video tokens when you call action
            {staleStills > 0 && ` · ${staleStills} stale still${staleStills === 1 ? "" : "s"}`}
          </span>
        </div>
        <button
          className="rc-cta sr-action"
          onClick={onAdvance}
          disabled={totalShots === 0}
        >
          <Clapperboard size={16} /> Approve &amp; Produce
        </button>
      </div>
    </div>
  );
}

function newShot(scene: Scene): Shot {
  return {
    id: "shot_new_" + Math.random().toString(36).slice(2, 10),
    index: scene.shots.length,
    shot_type: "medium",
    camera: "static",
    action: "",
    dialogue: [],
    narration: "",
    character_ids: [],
    location_id: scene.shots[0]?.location_id ?? null,
    duration_s: 4,
    source: "standin",
    asset_id: null,
    status: "planned",
    reroll_count: 0,
    critic_score: null,
  };
}

interface ShotCardProps {
  shot: Shot;
  index: number;
  production: Production;
  first: boolean;
  last: boolean;
  stillPending: boolean;
  onRedoStill: (note: string) => void;
  onChange: (next: Partial<Shot>) => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}

function ShotCard({
  shot,
  index,
  production,
  first,
  last,
  stillPending,
  onRedoStill,
  onChange,
  onUp,
  onDown,
  onRemove,
}: ShotCardProps) {
  const [note, setNote] = useState("");
  const hasStill = Boolean(shot.keyframe_asset_id || shot.keyframe_url);
  const stale = isStale(shot);

  const toggleChar = (cid: string) =>
    onChange({
      character_ids: shot.character_ids.includes(cid)
        ? shot.character_ids.filter((x) => x !== cid)
        : [...shot.character_ids, cid],
    });

  const redo = () => {
    onRedoStill(note.trim());
    setNote("");
  };

  return (
    <div className="sr-shot">
      <div className="sr-shot-num">{index + 1}</div>
      <div className="sr-still">
        <div className={"sr-still-frame" + (stale ? " is-stale" : "")}>
          {stale && <span className="sr-still-stale">stale</span>}
          {stillPending ? (
            <Loader2 size={18} className="rc-spin" />
          ) : shot.keyframe_asset_id ? (
            <img
              src={assetRawUrl(shot.keyframe_asset_id)}
              alt={`Still for shot ${index + 1}`}
              title="This exact frame is what the film animates — click to view full size"
              onClick={() => window.open(assetRawUrl(shot.keyframe_asset_id!), "_blank")}
            />
          ) : shot.keyframe_url ? (
            <img src={shot.keyframe_url} alt={`Still for shot ${index + 1}`} />
          ) : (
            <ImageIcon size={18} />
          )}
        </div>
        <div className="sr-still-note">
          <input
            className="sr-edit"
            value={note}
            placeholder="Optional note — “closer, add rain”"
            aria-label={`Still note for shot ${index + 1}`}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !stillPending) redo();
            }}
          />
        </div>
        <button
          className="sr-mini sr-still-redo"
          disabled={stillPending}
          aria-label={`Regenerate still for shot ${index + 1}`}
          onClick={redo}
        >
          <RotateCw size={12} />
          {hasStill ? "Regenerate still" : "Generate still"}
        </button>
      </div>
      <div className="sr-shot-body">
        <div className="sr-shot-meta">
          <Select
            value={shot.shot_type}
            options={SHOT_TYPES}
            onChange={(v) => onChange({ shot_type: v as Shot["shot_type"] })}
            label="Shot type"
          />
          <Select
            value={shot.camera}
            options={CAMERAS}
            onChange={(v) => onChange({ camera: v as Shot["camera"] })}
            label="Camera"
            icon={<Camera size={11} />}
          />
          <input
            className="sr-dur-edit"
            type="number"
            min={1}
            max={12}
            step={0.5}
            value={shot.duration_s}
            aria-label="Duration seconds"
            onChange={(e) =>
              onChange({ duration_s: Number(e.target.value) || 1 })
            }
          />
          <span className="sr-dur-unit">s</span>
          <ShotBadges shot={shot} />
        </div>

        <div className="sr-shot-cast">
          <Users size={11} />
          {production.characters.map((c) => (
            <button
              key={c.id}
              className={
                "sr-chip" + (shot.character_ids.includes(c.id) ? " is-on" : "")
              }
              aria-pressed={shot.character_ids.includes(c.id)}
              aria-label={`${c.name} in shot`}
              onClick={() => toggleChar(c.id)}
            >
              {c.name}
            </button>
          ))}
          <label className="sr-select sr-loc-select">
            <select
              value={shot.location_id ?? ""}
              aria-label="Shot location"
              onChange={(e) =>
                onChange({ location_id: e.target.value || null })
              }
            >
              <option value="">no set</option>
              {production.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Editable
          value={shot.action}
          onCommit={(v) => onChange({ action: v })}
          multiline
          placeholder="The visual: what the camera sees…"
          aria-label="Shot action"
        />

        <div className="sr-shot-dialogue">
          {shot.dialogue.map((d, di) => (
            <div className="sr-dialogue-line" key={di}>
              <select
                className="sr-dialogue-speaker"
                value={d.character_id ?? ""}
                aria-label="Speaker"
                onChange={(e) => {
                  const c = production.characters.find((x) => x.id === e.target.value);
                  onChange({
                    dialogue: shot.dialogue.map((x, xi) =>
                      xi === di
                        ? { ...x, character_id: c?.id ?? null, character_name: c?.name ?? "" }
                        : x,
                    ),
                  });
                }}
              >
                <option value="">—</option>
                {production.characters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <Editable
                value={d.line}
                onCommit={(v) =>
                  onChange({
                    dialogue: shot.dialogue.map((x, xi) =>
                      xi === di ? { ...x, line: v } : x,
                    ),
                  })
                }
                placeholder="line…"
                aria-label="Dialogue line"
              />
              <button
                className="rc-iconbtn sm"
                aria-label={`Remove line ${di + 1}`}
                onClick={() =>
                  onChange({ dialogue: shot.dialogue.filter((_, xi) => xi !== di) })
                }
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <button
            className="sr-mini sm sr-add-line"
            data-testid={`add-line-${shot.id}`}
            onClick={() => {
              const c = production.characters[0];
              onChange({
                dialogue: [
                  ...shot.dialogue,
                  { character_id: c?.id ?? null, character_name: c?.name ?? "", line: "" },
                ],
              });
            }}
          >
            + line
          </button>
        </div>

      </div>

      <div className="sr-shot-side">
        <button
          className="rc-iconbtn sm"
          disabled={first}
          aria-label="Move shot up"
          onClick={onUp}
        >
          <ArrowUp size={14} />
        </button>
        <button
          className="rc-iconbtn sm"
          disabled={last}
          aria-label="Move shot down"
          onClick={onDown}
        >
          <ArrowDown size={14} />
        </button>
        <button
          className="rc-iconbtn sm sr-del"
          aria-label="Remove shot"
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
  label,
  icon,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <label className="sr-select">
      {icon}
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
