import { useEffect, useState } from "react";
import {
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

  async function start() {
    if (!premise.trim() || starting) return;
    setStarting(true);
    setError(null);
    try {
      const prod = await api.createProduction({
        premise: premise.trim(),
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

          <button
            className="sr-start"
            onClick={start}
            disabled={!premise.trim() || starting}
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
          <section className="sr-productions">
            <h2>Your productions</h2>
            <div className="sr-prod-grid">
              {productions.map((p) => (
                <div className="sr-prod-card" key={p.id}>
                  <button
                    className="sr-prod-open"
                    onClick={() => open(p.id)}
                    type="button"
                  >
                    <div className="sr-prod-thumb">
                      <Film size={20} />
                    </div>
                    <div className="sr-prod-meta">
                      <div className="sr-prod-title">
                        {p.title || "Untitled"}
                      </div>
                      <div className="sr-prod-stage">{stageLabel(p.stage)}</div>
                    </div>
                  </button>
                  <button
                    className="rc-iconbtn sm sr-prod-del"
                    aria-label="Delete production"
                    onClick={() => remove(p.id)}
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
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
    script: "In the writers' room",
    cast_style: "Casting",
    storyboard: "Storyboarding",
    production: "In production",
    export: "Final film",
  };
  return map[stage] ?? stage;
}
