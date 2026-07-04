import { useEffect, useState } from "react";
import {
  ArrowRight,
  Clapperboard,
  Film,
  FlaskConical,
  ImagePlus,
  Loader2,
  Palette,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api, assetRawUrl } from "../api/client";
import type { ProductionSummary, StyleLock, StyleSummary } from "../types";

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
  ghibli: "linear-gradient(150deg,#a8d8a8,#4a7ba6)",
  ink_wash: "linear-gradient(150deg,#e8e4da,#42403a)",
  comic: "linear-gradient(150deg,#ffd23f,#ee4266)",
  pixel: "linear-gradient(150deg,#5efc8d,#233d4d)",
  cyberpunk: "linear-gradient(150deg,#00e5ff,#d400ff)",
  retro_film: "linear-gradient(150deg,#e0a458,#6b4226)",
  paper_craft: "linear-gradient(150deg,#f4e8c1,#a0c1b8)",
};

/** What KIND of drama — the first creative choice, steers the writers' room. */
const DRAMA_KINDS: { key: string; label: string; hint: string }[] = [
  { key: "melodrama", label: "👑 Melodrama", hint: "secret heirs, revenge, bombshells" },
  { key: "thriller", label: "😱 Thriller", hint: "dread, secrets, ticking clocks" },
  { key: "mystery", label: "🔍 Mystery", hint: "clues that recontextualize" },
  { key: "comedy", label: "😂 Comedy", hint: "want vs flaw, dry and quick" },
  { key: "romance", label: "💘 Romance", hint: "charged subtext, near-misses" },
  { key: "horror", label: "🫥 Horror", hint: "the mundane turns hostile" },
  { key: "heartfelt", label: "❤️ Heartfelt", hint: "small details, earned feeling" },
  { key: "", label: "✨ Match style", hint: "let the visual style set the register" },
];

const KIND_PLACEHOLDERS: Record<string, string> = {
  melodrama:
    "The cleaner they fired at dawn inherits the hotel by noon — her first act: audit the manager who fired her…",
  thriller: "The night-shift nurse recognizes her new patient: the hit-and-run driver no one ever caught…",
  mystery: "Every clock in town stopped at 3:07 — except the one the locksmith's father built…",
  comedy: "A wedding planner books two weddings, one venue, one bride who invited both grooms…",
  romance: "Two rival food-truck owners keep stealing each other's customers — and glances…",
  horror: "The apartment's previous tenant left one rule taped inside the pantry: never answer the delivery knock twice…",
  heartfelt: "A retiring bus driver's last route collects every passenger whose life he quietly changed…",
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
  const [tone, setTone] = useState("comedy");  // user picks their drama kind up top
  const [testMode, setTestMode] = useState(false);
  // Custom style (LTX-style "style element"): built from a description and/or refs.
  const [customOpen, setCustomOpen] = useState(false);
  const [customDesc, setCustomDesc] = useState("");
  const [customRefs, setCustomRefs] = useState<{ url: string; display: string }[]>([]);
  const [customStyle, setCustomStyle] = useState<StyleLock | null>(null);
  const [customBusy, setCustomBusy] = useState(false);
  const [styles, setStyles] = useState<StyleSummary[]>(FALLBACK_STYLES);
  const [productions, setProductions] = useState<ProductionSummary[]>([]);
  const [starting, setStarting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggest = async () => {
    setSuggesting(true);
    try {
      const r = await api.suggestPremise(premise.trim());
      if (r?.premise) setPremise(r.premise);
    } catch {
      /* offline / unavailable — leave the box as-is */
    } finally {
      setSuggesting(false);
    }
  };

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
        tone,
        custom_style: style === "custom" ? customStyle : null,
        test_mode: testMode,
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

  async function addRefFile(file: File) {
    try {
      const up = await api.uploadReference(file);
      setCustomRefs((r) => [...r, { url: up.url, display: assetRawUrl(up.asset_id) }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload the reference");
    }
  }

  async function createCustomStyle() {
    if (!customDesc.trim() && customRefs.length === 0) return;
    setCustomBusy(true);
    setError(null);
    try {
      const s = await api.customStyle({
        description: customDesc.trim(),
        image_urls: customRefs.map((r) => r.url),
        test_mode: testMode,
      });
      setCustomStyle(s);
      setStyle("custom");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the style");
    } finally {
      setCustomBusy(false);
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
          <div className="sr-premise-labelrow">
            <label className="sr-field-label">Your premise</label>
            <button
              type="button"
              className="sr-suggest"
              onClick={suggest}
              disabled={suggesting}
              data-testid="suggest-premise"
              title={premise.trim() ? "Sharpen this premise" : "Generate a premise"}
            >
              <Sparkles size={13} />
              {suggesting ? "Thinking…" : premise.trim() ? "Refine with AI" : "Surprise me"}
            </button>
          </div>
          <div className="sr-kind-row" data-testid="drama-kinds">
            {DRAMA_KINDS.map((k) => (
              <button
                key={k.key || "match"}
                className={"sr-chip sr-kind" + (tone === k.key ? " is-on" : "")}
                title={k.hint}
                onClick={() => setTone(k.key)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <textarea
            className="sr-premise-input"
            placeholder={
              KIND_PLACEHOLDERS[tone] ??
              "A lighthouse keeper discovers the light is talking back…"
            }
            value={premise}
            onChange={(e) => setPremise(e.target.value)}
            rows={3}
            autoFocus
          />

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
                      "linear-gradient(150deg,#2c2c30,#1a1a1d)",
                  }}
                >
                  {s.image && (
                    <img
                      className="sr-style-img"
                      src={s.image}
                      alt={`${s.name} style`}
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                </span>
                <span className="sr-style-name">{s.name.replace("_", " ")}</span>
              </button>
            ))}
            <button
              className={"sr-style" + (style === "custom" ? " on" : "")}
              onClick={() => {
                setCustomOpen(true);
                if (customStyle) setStyle("custom");
              }}
              title="Build your own look from a description or reference images"
              type="button"
              data-testid="custom-style-card"
            >
              <span
                className="sr-style-swatch sr-style-custom"
                style={{
                  background: "linear-gradient(150deg,#2c2c30,#1a1a1d)",
                }}
              >
                {customRefs[0] ? (
                  <img className="sr-style-img" src={customRefs[0].display} alt="your style" />
                ) : (
                  <Palette size={18} />
                )}
              </span>
              <span className="sr-style-name">your style</span>
            </button>
          </div>

          {customOpen && (
            <div className="sr-custom-style" data-testid="custom-style-panel">
              <textarea
                className="sr-premise-input sr-custom-desc"
                placeholder="Describe the look — “1970s Kodachrome road movie, dust and lens flare”"
                value={customDesc}
                rows={2}
                onChange={(e) => setCustomDesc(e.target.value)}
              />
              <div className="sr-custom-row">
                <label className="sr-custom-upload">
                  <ImagePlus size={14} />
                  {customRefs.length ? `${customRefs.length} reference${customRefs.length > 1 ? "s" : ""}` : "Add reference image(s)"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => {
                      for (const f of Array.from(e.target.files ?? [])) void addRefFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {customRefs.map((r, i) => (
                  <img key={i} className="sr-custom-thumb" src={r.display} alt="" />
                ))}
                <button
                  className="sr-mini"
                  disabled={customBusy || (!customDesc.trim() && customRefs.length === 0)}
                  onClick={() => void createCustomStyle()}
                  type="button"
                >
                  {customBusy ? <Loader2 size={13} className="rc-spin" /> : <Palette size={13} />}
                  {customStyle ? "Update style" : "Create style"}
                </button>
              </div>
              {customStyle && (
                <div className="sr-custom-locked">
                  ✓ locked: {customStyle.descriptors}
                  {customStyle.palette ? ` · ${customStyle.palette}` : ""}
                </div>
              )}
            </div>
          )}

          <div className="sr-controls-row">
            <div className="sr-control sr-control-len">
              <label className="sr-field-label">
                Length · <b>{seconds}s</b>
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
            <label className="sr-testmode" data-testid="test-mode-toggle">
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
              />
              <FlaskConical size={13} />
              <span>
                <b>Test drive</b> · zero tokens
              </span>
            </label>
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
            disabled={tooShort || starting || (style === "custom" && !customStyle)}
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
                  <button
                    className="sr-prod-thumb"
                    onClick={() => open(p.id)}
                    aria-label={`Open ${p.title || "Untitled"}`}
                    title={p.logline || p.title || "Untitled"}
                    type="button"
                  >
                    {p.cover_asset_id ? (
                      <img
                        src={assetRawUrl(p.cover_asset_id)}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <Film size={18} />
                    )}
                    {(p.episode ?? 1) > 1 && (
                      <span className="sr-ep-badge">EP {p.episode}</span>
                    )}
                    {p.test_mode && (
                      <span className="sr-test-badge" title="Test drive — no tokens">
                        <FlaskConical size={10} /> TEST
                      </span>
                    )}
                  </button>
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
                  <div className="sr-prod-actions">
                    <button
                      className="sr-prod-resume"
                      onClick={() => open(p.id)}
                      type="button"
                    >
                      {p.stage === "export" ? (
                        <>
                          <Play size={12} /> Watch
                        </>
                      ) : (
                        <>
                          Resume <ArrowRight size={12} />
                        </>
                      )}
                    </button>
                    <button
                      className="rc-iconbtn sm sr-prod-del"
                      aria-label="Delete production"
                      title="Delete production"
                      onClick={() => remove(p.id)}
                      type="button"
                    >
                      <Trash2 size={13} />
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
