import { useEffect, useState } from "react";
import {
  ArrowRight,
  Clapperboard,
  Film,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../api/client";
import type { ProductionSummary, StyleSummary } from "../types";

const FALLBACK_STYLES: StyleSummary[] = [
  { name: "noir", descriptors: "film noir, high-contrast B&W, hard shadows", palette: "monochrome" },
  { name: "anime", descriptors: "anime cel-shaded, vibrant, expressive 2D", palette: "saturated" },
  { name: "claymation", descriptors: "claymation stop-motion, handmade clay", palette: "warm earthy" },
  { name: "storybook", descriptors: "painterly watercolor storybook", palette: "pastel" },
  { name: "cinematic", descriptors: "cinematic live-action, anamorphic", palette: "" },
  { name: "pixar", descriptors: "3D animated feature, polished lighting", palette: "vivid" },
];

const STYLE_SWATCH: Record<string, string> = {
  noir: "linear-gradient(150deg,#2b2b2b,#0a0a0a)",
  anime: "linear-gradient(150deg,#ff6ec4,#7873f5)",
  claymation: "linear-gradient(150deg,#d9a066,#7a5230)",
  storybook: "linear-gradient(150deg,#f6d5e0,#a8c0e8)",
  cinematic: "linear-gradient(150deg,#3a4a5a,#11161c)",
  pixar: "linear-gradient(150deg,#4dc3ff,#9b6bff)",
};

/** A premise needs at least a sentence's worth to give the writers' room something. */
const MIN_PREMISE_CHARS = 12;

interface PremiseProps {
  open: (productionId: string) => void;
}

export function Premise({ open }: PremiseProps) {
  const [premise, setPremise] = useState("");
  const [seconds, setSeconds] = useState(45);
  const [style, setStyle] = useState("cinematic");
  const [styles, setStyles] = useState<StyleSummary[]>(FALLBACK_STYLES);
  const [productions, setProductions] = useState<ProductionSummary[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listStyles()
      .then((s) => s.length && setStyles(s))
      .catch(() => {});
    refreshProductions();
  }, []);

  function refreshProductions() {
    api
      .listProductions()
      .then(setProductions)
      .catch(() => {});
  }

  const trimmed = premise.trim();
  const tooShort = trimmed.length < MIN_PREMISE_CHARS;

  async function start() {
    if (tooShort || starting) return;
    setStarting(true);
    setError(null);
    try {
      const prod = await api.createProduction({
        premise: trimmed,
        target_seconds: seconds,
        style,
      });
      open(prod.id);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Couldn't reach the writers' room — ${e.message}`
          : "Something went wrong.",
      );
      setStarting(false);
    }
  }

  async function remove(id: string) {
    setProductions((p) => p.filter((x) => x.id !== id));
    try {
      await api.deleteProduction(id);
    } catch {
      refreshProductions();
    }
  }

  return (
    <div className="sr-landing">
      <div className="sr-landing-inner">
        <header className="sr-hero">
          <div className="sr-hero-badge">
            <Clapperboard size={14} /> AI SHOWRUNNER
          </div>
          <h1>
            Type a premise.
            <br />
            Get a directed short film.
          </h1>
          <p>
            An agent runs the writers' room, casts consistent characters, boards
            every shot, then autonomously generates the film — you approve at
            each beat.
          </p>
        </header>

        <div className="sr-premise-card">
          <label className="sr-field-label">Your premise</label>
          <textarea
            className="sr-premise-input"
            placeholder="A lighthouse keeper discovers the light is talking back…"
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            rows={3}
            autoFocus
          />

          <div className="sr-premise-controls">
            <div className="sr-control">
              <label className="sr-field-label">
                Target length · <b>{seconds}s</b>
              </label>
              <input
                className="sr-range"
                type="range"
                min={15}
                max={90}
                step={5}
                value={seconds}
                aria-label="Target length in seconds"
                onChange={(e) => setSeconds(Number(e.target.value))}
              />
            </div>
          </div>

          <label className="sr-field-label">Style</label>
          <div className="sr-styles">
            {styles.map((s) => (
              <button
                key={s.name}
                className={"sr-style" + (style === s.name ? " on" : "")}
                onClick={() => setStyle(s.name)}
                title={s.descriptors}
                type="button"
              >
                <span
                  className="sr-style-swatch"
                  style={{
                    background:
                      STYLE_SWATCH[s.name] ||
                      "linear-gradient(150deg,#5B3DF5,#241a55)",
                  }}
                />
                <span className="sr-style-name">{s.name}</span>
              </button>
            ))}
          </div>

          {error && <div className="rc-err">{error}</div>}

          {tooShort && (
            <div className="sr-premise-hint" data-testid="premise-hint">
              Give me a sentence to work with — who, and what goes wrong?
            </div>
          )}

          <button
            className="sr-start"
            onClick={start}
            disabled={tooShort || starting}
            type="button"
          >
            {starting ? (
              <>
                <Loader2 size={16} className="rc-spin" /> Convening the writers'
                room…
              </>
            ) : (
              <>
                <Sparkles size={16} /> Start the writers' room
              </>
            )}
          </button>
        </div>

        {productions.length > 0 && (
          <section className="sr-productions" data-testid="productions">
            <h2>Your productions</h2>
            <div className="sr-prod-grid">
              {productions.map((p) => (
                <div className="sr-prod-card" key={p.id} data-testid="prod-card">
                  <div className="sr-prod-thumb">
                    <Film size={18} />
                  </div>
                  <div className="sr-prod-meta">
                    <div className="sr-prod-title" title={p.title || "Untitled"}>
                      {p.title || "Untitled"}
                    </div>
                    <div className="sr-prod-sub">
                      <span
                        className={"sr-stage-chip stage-" + p.stage}
                        data-testid="stage-chip"
                      >
                        {stageLabel(p.stage)}
                      </span>
                      {relativeTime(p.updated_at) && (
                        <span className="sr-prod-time">
                          {relativeTime(p.updated_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="sr-prod-actions">
                    <button
                      className="sr-prod-resume"
                      onClick={() => open(p.id)}
                      type="button"
                    >
                      Resume <ArrowRight size={13} />
                    </button>
                    <button
                      className="rc-iconbtn sm sr-prod-del"
                      aria-label="Delete production"
                      title="Delete production"
                      onClick={() => remove(p.id)}
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function stageLabel(stage: string): string {
  const map: Record<string, string> = {
    premise: "Premise",
    script: "Script",
    cast_style: "Cast & style",
    storyboard: "Storyboard",
    production: "In production",
    export: "Final film",
  };
  return map[stage] ?? stage;
}

/** Compact "2h ago" / "3d ago" relative label. Accepts ISO strings or epoch
 *  seconds/ms; returns "" when the timestamp is missing or unparseable. */
function relativeTime(value: string | number | undefined): string {
  if (value === undefined || value === null) return "";
  let ms: number;
  if (typeof value === "number") {
    // Heuristic: treat 10-digit values as epoch seconds.
    ms = value < 1e12 ? value * 1000 : value;
  } else {
    ms = Date.parse(value);
  }
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}
