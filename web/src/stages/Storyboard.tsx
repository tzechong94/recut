import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Clapperboard,
  Loader2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "../api/client";
import type { UseProduction } from "../lib/useProduction";
import type { Production, Scene, Shot } from "../types";
import { Editable } from "../components/Editable";

interface StageProps {
  ctl: UseProduction;
  onAdvance: () => void;
}

const SHOT_TYPES = ["wide", "medium", "close_up", "insert", "two_shot"];
const CAMERAS = ["static", "pan", "push_in", "pull_out", "handheld", "aerial"];

export function StoryboardStage({ ctl, onAdvance }: StageProps) {
  const p = ctl.production!;
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the storyboard");
    } finally {
      setBuilding(false);
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

  return (
    <div className="rc-stage">
      <div className="rc-head">
        <div className="rc-kicker">STAGE 3 · THE BOARD</div>
        <h2>Storyboard</h2>
        <p>
          Every shot the agent will generate. Tune the visual action, framing,
          and dialogue. Reorder, add, or cut shots — then call action.
        </p>
      </div>

      {error && <div className="rc-err">{error}</div>}

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
            {totalShots} shots · ~{Math.round(totalDur)}s · video tokens spend
            after you call action
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
  onChange,
  onUp,
  onDown,
  onRemove,
}: ShotCardProps) {
  const charNames = shot.character_ids
    .map((id) => production.characters.find((c) => c.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="sr-shot">
      <div className="sr-shot-num">{index + 1}</div>
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
          {charNames.length > 0 && (
            <span className="sr-shot-chars">
              <Users size={11} /> {charNames.join(", ")}
            </span>
          )}
        </div>

        <Editable
          value={shot.action}
          onCommit={(v) => onChange({ action: v })}
          multiline
          placeholder="The visual: what the camera sees…"
          aria-label="Shot action"
        />

        {shot.dialogue.length > 0 && (
          <div className="sr-shot-dialogue">
            {shot.dialogue.map((d, di) => (
              <div className="sr-dialogue-line" key={di}>
                <span className="sr-dialogue-name">
                  {d.character_name || "—"}
                </span>
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
              </div>
            ))}
          </div>
        )}

        {(shot.narration || shot.dialogue.length === 0) && (
          <div className="sr-shot-narration">
            <span className="sr-narr-tag">narration</span>
            <Editable
              value={shot.narration}
              onCommit={(v) => onChange({ narration: v })}
              placeholder="Voiceover over this shot…"
              aria-label="Narration"
            />
          </div>
        )}
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
