import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Clapperboard } from "lucide-react";
import { TYPES } from "../components/types-map";
import { api } from "../api/client";
import { DEMO_LIBRARY } from "../lib/demo";
import type { Recipe } from "../types";

export interface RecipeLibraryProps {
  exit: () => void;
  startFromRecipe: (recipe: Recipe) => void;
}

export function RecipeLibrary({ exit, startFromRecipe }: RecipeLibraryProps) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const lib = await api.recipeLibrary();
        setRecipes(lib.length ? lib : DEMO_LIBRARY);
      } catch {
        setOffline(true);
        setRecipes(DEMO_LIBRARY);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="rc-lib-page">
      <header className="rc-top">
        <div className="rc-brand">
          <button className="rc-exit" onClick={exit} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <span className="rc-mark">
            <Clapperboard size={15} strokeWidth={2.4} />
          </span>
          <span className="rc-name">Recut</span>
          <span className="rc-proj">/ Recipe library</span>
        </div>
        <span className="rc-acct">jellyfuur</span>
      </header>

      <div className="rc-lib-inner">
        {offline && (
          <div className="rc-banner">
            Backend offline — showing the starter library.
          </div>
        )}
        <div className="rc-proj-head">
          <div>
            <h1>Recipe library</h1>
            <p>
              Saved formats, ready to reuse. Start a fresh project from any
              recipe — same structure, your story.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="rc-loading">
            <div className="rc-genspin" />
            Loading recipes…
          </div>
        ) : (
          <div className="rc-libgrid">
            {recipes.map((r) => (
              <div className="rc-libcard" key={r.recipe_id}>
                <h3>{r.name}</h3>
                <div className="rc-libmeta">
                  <span className="rc-libtag">{r.duration_s}s</span>
                  <span className="rc-libtag">{r.shot_count} shots</span>
                  <span className="rc-libtag">{r.aspect_ratio}</span>
                </div>
                {r.hook_transcript && (
                  <div className="rc-libhook">“{r.hook_transcript}”</div>
                )}
                <div className="rc-libstrip">
                  {r.beats.map((b) => (
                    <i
                      key={b.index}
                      style={{
                        flex: b.duration_s,
                        background: TYPES[b.slot_type].color,
                      }}
                      title={b.label}
                    />
                  ))}
                </div>
                <button
                  className="rc-libstart"
                  onClick={() => startFromRecipe(r)}
                >
                  Start a project <ArrowRight size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
