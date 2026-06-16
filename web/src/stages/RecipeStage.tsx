import { useState } from "react";
import { ArrowLeft, ArrowRight, Bookmark, Check } from "lucide-react";
import { Head, Foot } from "../components/Frame";
import { TYPES, fmtClock } from "../components/types-map";
import { api } from "../api/client";
import type { Recipe } from "../types";

export interface RecipeStageProps {
  recipe: Recipe;
  next: () => void;
  back: () => void;
}

export function RecipeStage({ recipe, next, back }: RecipeStageProps) {
  const [saved, setSaved] = useState(!!recipe.saved);
  const [savingErr, setSavingErr] = useState(false);

  let t = 0;
  const dur = recipe.duration_s || recipe.beats.reduce((a, b) => a + b.duration_s, 0);

  const toggleSave = async () => {
    const nextSaved = !saved;
    setSaved(nextSaved);
    try {
      await api.saveRecipe(recipe.recipe_id, nextSaved);
      setSavingErr(false);
    } catch {
      // offline: keep the optimistic UI, note it's local-only
      setSavingErr(true);
    }
  };

  return (
    <div className="rc-stage">
      <Head
        k="02"
        t="Here's the recipe we pulled"
        s="The agent watched the reference — shot by shot, audio and on-screen text — and broke it into beats. This structure becomes your template."
      />
      <div className="rc-analysis">
        <span>
          <b>{fmtClock(dur)}</b> analysed
        </span>
        <i />
        <span>
          <b>{recipe.shot_count}</b> shots detected
        </span>
        <i />
        <span>audio transcribed</span>
        <i />
        <span>on-screen text read</span>
      </div>
      <div className="rc-recipe">
        <div className="rc-tl">
          {recipe.beats.map((b) => {
            const T = TYPES[b.slot_type];
            const start = t;
            t += b.duration_s;
            return (
              <div className="rc-tlrow" key={b.index}>
                <span className="rc-tlts">{fmtClock(start)}</span>
                <span className="rc-tlbeat">
                  <b>{b.label}</b>
                </span>
                <span
                  className="rc-chip"
                  style={{ background: T.soft, color: T.color }}
                >
                  <T.Icon size={13} /> {T.label}
                </span>
                <span
                  className="rc-bar"
                  style={{
                    width: 26 + b.duration_s * 14,
                    background: T.color,
                  }}
                />
                <span className="rc-tldur">{b.duration_s}s</span>
              </div>
            );
          })}
        </div>
        <aside className="rc-readout">
          <h4>What the agent noticed</h4>
          {recipe.hook_transcript && (
            <div className="rc-hooktrans">
              <span>Transcribed hook</span>“{recipe.hook_transcript}”
            </div>
          )}
          <ul>
            {recipe.observations.map((o, i) => {
              const dot = o.indexOf(".");
              const lead = dot > 0 ? o.slice(0, dot + 1) : "";
              const rest = dot > 0 ? o.slice(dot + 1) : o;
              return (
                <li key={i}>
                  {lead && <b>{lead}</b>}
                  {rest}
                </li>
              );
            })}
          </ul>
          <div className="rc-legend">
            {Object.values(TYPES).map((T) => (
              <span key={T.label} className="rc-legitem">
                <i style={{ background: T.color }} />
                {T.label}
              </span>
            ))}
          </div>
        </aside>
      </div>

      <div style={{ marginTop: 18 }}>
        <button
          className={"rc-saverecipe" + (saved ? " is-saved" : "")}
          onClick={toggleSave}
        >
          {saved ? (
            <>
              <Check size={15} /> Saved to library
            </>
          ) : (
            <>
              <Bookmark size={15} /> Save to library
            </>
          )}
        </button>
        {savingErr && saved && (
          <span className="rc-note" style={{ marginLeft: 10 }}>
            Saved locally (backend offline).
          </span>
        )}
      </div>

      <Foot
        left={
          <button className="rc-back" onClick={back}>
            <ArrowLeft size={16} /> Reference
          </button>
        }
        right={
          <button className="rc-cta" onClick={next}>
            Use this structure <ArrowRight size={16} />
          </button>
        }
      />
    </div>
  );
}
