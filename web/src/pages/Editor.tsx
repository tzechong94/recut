import { useEffect, useState } from "react";
import { ArrowLeft, Check, Clapperboard } from "lucide-react";
import { STAGES } from "../components/types-map";
import { api } from "../api/client";
import { useAutosave } from "../lib/useAutosave";
import {
  DEMO_RECIPE,
  demoBaseCut,
  recomputeLedger,
} from "../lib/demo";
import type { Recipe, Slot, Timeline } from "../types";

import { Reference } from "../stages/Reference";
import { RecipeStage } from "../stages/RecipeStage";
import { Script } from "../stages/Script";
import { Storyboard } from "../stages/Storyboard";
import { Cover } from "../stages/Cover";

export interface EditorProps {
  projectId: string;
  projectName: string;
  /** when launched from the library, the recipe to seed (skips analyse). */
  seedRecipe?: Recipe | null;
  exit: () => void;
}

export function Editor({
  projectId,
  projectName,
  seedRecipe,
  exit,
}: EditorProps) {
  const [stage, setStage] = useState(seedRecipe ? 1 : 0);
  const [recipe, setRecipe] = useState<Recipe | null>(seedRecipe ?? null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [generating, setGenerating] = useState(false);

  const saveStatus = useAutosave(timeline, setTimeline, stage >= 3);

  // try to resume an existing timeline on mount
  useEffect(() => {
    (async () => {
      try {
        const tl = await api.getTimeline(projectId);
        if (tl) {
          setTimeline(tl);
          setDrafted(true);
        }
      } catch {
        /* no timeline yet */
      }
    })();
  }, [projectId]);

  const totalDur = timeline
    ? timeline.slots.reduce((a, s) => a + s.duration_s, 0)
    : recipe
      ? recipe.duration_s
      : 0;

  const onAnalyse = async (assetId: string | null) => {
    setAnalysing(true);
    try {
      let r: Recipe;
      if (assetId) {
        try {
          r = await api.analyse(projectId, assetId);
        } catch {
          r = DEMO_RECIPE;
        }
      } else {
        r = DEMO_RECIPE;
      }
      setRecipe(r);
      setStage(1);
    } finally {
      setAnalysing(false);
    }
  };

  const ensureTimeline = (r: Recipe): Timeline => {
    if (timeline) return timeline;
    const tl = demoBaseCut(projectId, r);
    setTimeline(tl);
    return tl;
  };

  // entering Script: make sure a timeline exists so beats are editable
  useEffect(() => {
    if (stage === 2 && recipe && !timeline) {
      ensureTimeline(recipe);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, recipe]);

  const patchSlot = (slotId: string, patch: Partial<Slot>) => {
    setTimeline((t) => {
      if (!t) return t;
      const slots = t.slots.map((s) =>
        s.id === slotId ? { ...s, ...patch } : s,
      );
      return { ...t, slots, token_ledger: recomputeLedger(slots) };
    });
  };

  const generate = async () => {
    if (!recipe) return;
    setGenerating(true);
    try {
      let tl: Timeline;
      try {
        tl = await api.baseCut(projectId, recipe.recipe_id);
      } catch {
        tl = timeline ?? demoBaseCut(projectId, recipe);
      }
      setTimeline(tl);
      setStage(3);
    } finally {
      setGenerating(false);
    }
  };

  const reachable = (i: number) => {
    if (i === 0) return true;
    if (i === 1) return !!recipe;
    if (i === 2) return !!recipe;
    if (i === 3) return !!timeline && stage >= 3;
    if (i === 4) return !!timeline && stage >= 3;
    return false;
  };

  return (
    <>
      <header className="rc-top">
        <div className="rc-brand">
          <button className="rc-exit" onClick={exit} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <span className="rc-mark">
            <Clapperboard size={15} strokeWidth={2.4} />
          </span>
          <span className="rc-name">Recut</span>
          <span className="rc-proj">/ {projectName || "Untitled"}</span>
        </div>
        <div className="rc-meta">
          {stage >= 3 && saveStatus === "saving" && (
            <span className="rc-saving">saving…</span>
          )}
          {stage >= 3 && saveStatus === "saved" && <span>saved</span>}
          <span className="rc-ratio">9:16</span>
          <span className="rc-dur">{Math.round(totalDur)}s</span>
        </div>
      </header>

      <div className="rc-bodywrap">
        <nav className="rc-rail" aria-label="Stages">
          {STAGES.map((s, i) => {
            const can = reachable(i) || i <= stage;
            return (
              <button
                key={s}
                disabled={!can}
                className={
                  "rc-step" +
                  (i === stage ? " is-active" : "") +
                  (i < stage ? " is-done" : "")
                }
                onClick={() => can && setStage(i)}
              >
                <span className="rc-num">
                  {i < stage ? (
                    <Check size={13} strokeWidth={3} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <span className="rc-steplabel">{s}</span>
              </button>
            );
          })}
          <div className="rc-railfoot">
            Borrow the format.
            <br />
            Tell your story.
          </div>
        </nav>

        <main className="rc-canvas" key={stage}>
          {stage === 0 && (
            <Reference
              projectId={projectId}
              onAnalyse={onAnalyse}
              analysing={analysing}
            />
          )}
          {stage === 1 && recipe && (
            <RecipeStage
              recipe={recipe}
              next={() => setStage(2)}
              back={() => setStage(0)}
            />
          )}
          {stage === 2 && recipe && timeline && (
            <Script
              projectId={projectId}
              recipe={recipe}
              timeline={timeline}
              patchSlot={patchSlot}
              drafted={drafted}
              setDrafted={setDrafted}
              generate={generate}
              generating={generating}
              back={() => setStage(1)}
            />
          )}
          {stage === 3 && timeline && (
            <Storyboard
              projectId={projectId}
              timeline={timeline}
              setTimeline={(updater) =>
                setTimeline((t) => (t ? updater(t) : t))
              }
              next={() => setStage(4)}
              back={() => setStage(2)}
            />
          )}
          {stage === 4 && timeline && (
            <Cover timeline={timeline} back={() => setStage(3)} />
          )}
        </main>
      </div>

      {generating && (
        <div className="rc-overlay">
          <div className="rc-gencard">
            <div className="rc-genspin" />
            <h3>Building your base cut</h3>
            <p className="rc-genstep">
              Assigning slots · generating stand-ins · stitching the timeline
            </p>
          </div>
        </div>
      )}
    </>
  );
}
