import { useState } from "react";
import { Check, Clapperboard, Cloud, Loader2, X } from "lucide-react";
import { useProduction } from "./lib/useProduction";
import type { Stage } from "./types";
import { ScriptStage } from "./stages/Script";
import { CastStage } from "./stages/Cast";
import { StoryboardStage } from "./stages/Storyboard";
import { ProduceStage } from "./stages/Produce";
import { FilmStage } from "./stages/Film";

const STEPS: { stage: Stage; label: string }[] = [
  { stage: "script", label: "Script" },
  { stage: "cast_style", label: "Cast & Style" },
  { stage: "storyboard", label: "Storyboard" },
  { stage: "production", label: "Produce" },
  { stage: "export", label: "Film" },
];

const ORDER: Stage[] = [
  "premise",
  "script",
  "cast_style",
  "storyboard",
  "production",
  "export",
];

interface ShowrunnerProps {
  productionId: string;
  exit: () => void;
  /** Jump to another production (the next episode of the serial). */
  open?: (id: string) => void;
}

export function Showrunner({ productionId, exit, open }: ShowrunnerProps) {
  const ctl = useProduction(productionId);
  const { production, loading, error, saveStatus } = ctl;

  // The stage the user is *viewing* (may be earlier than the persisted stage).
  const [view, setView] = useState<Stage | null>(null);
  // The exported MP4 asset id, surfaced by the produce job result.
  const [exportAssetId, setExportAssetId] = useState<string | null>(null);

  if (loading) {
    return (
      <Shell exit={exit} saveStatus="idle">
        <div className="rc-loading">
          <Loader2 size={26} className="rc-spin" />
          <span>Loading production…</span>
        </div>
      </Shell>
    );
  }

  if (error || !production) {
    return (
      <Shell exit={exit} saveStatus="idle">
        <div className="rc-loading">
          <p className="rc-err">{error || "Production not found."}</p>
          <button className="rc-cta sm" onClick={exit}>
            Back to start
          </button>
        </div>
      </Shell>
    );
  }

  const reachedIdx = ORDER.indexOf(production.stage);
  const activeStage: Stage = view ?? mapStageToStep(production.stage);
  const activeIdx = ORDER.indexOf(activeStage);

  return (
    <Shell exit={exit} saveStatus={saveStatus} title={production.title}>
      <div className="rc-bodywrap">
        <nav className="rc-rail" aria-label="Production stages">
          {STEPS.map((step, i) => {
            const stepIdx = ORDER.indexOf(step.stage);
            const reachable = stepIdx <= Math.max(reachedIdx, 0);
            const isActive = step.stage === activeStage;
            const isDone = stepIdx < activeIdx;
            return (
              <button
                key={step.stage}
                className={
                  "rc-step" +
                  (isActive ? " is-active" : "") +
                  (isDone ? " is-done" : "")
                }
                disabled={!reachable}
                onClick={() => reachable && setView(step.stage)}
              >
                <span className="rc-num">{i + 1}</span>
                <span className="rc-steplabel">{step.label}</span>
              </button>
            );
          })}
          <div className="rc-railfoot">
            One premise.
            <br />
            One directed film.
          </div>
        </nav>

        <div className="rc-canvas" key={activeStage}>
          {activeStage === "script" && (
            <ScriptStage ctl={ctl} onAdvance={() => setView("cast_style")} />
          )}
          {activeStage === "cast_style" && (
            <CastStage ctl={ctl} onAdvance={() => setView("storyboard")} />
          )}
          {activeStage === "storyboard" && (
            <StoryboardStage ctl={ctl} onAdvance={() => setView("production")} />
          )}
          {activeStage === "production" && (
            <ProduceStage
              ctl={ctl}
              onAdvance={() => setView("export")}
              onExport={setExportAssetId}
            />
          )}
          {activeStage === "export" && (
            <FilmStage
              ctl={ctl}
              exportAssetId={exportAssetId}
              onOpenProduction={open}
            />
          )}
        </div>
      </div>
    </Shell>
  );
}

/** premise -> show the script stage; otherwise show the persisted stage. */
function mapStageToStep(stage: Stage): Stage {
  return stage === "premise" ? "script" : stage;
}

function Shell({
  children,
  exit,
  saveStatus,
  title,
}: {
  children: React.ReactNode;
  exit: () => void;
  saveStatus: string;
  title?: string;
}) {
  return (
    <>
      <header className="rc-top">
        <div className="rc-brand">
          <button className="rc-exit" onClick={exit} aria-label="Back to start">
            <X size={17} />
          </button>
          <div className="rc-mark">
            <Clapperboard size={15} />
          </div>
          <div className="rc-name">Showrunner</div>
          {title && <div className="rc-proj">· {title}</div>}
        </div>
        <div className="rc-meta">
          <SaveIndicator status={saveStatus} />
        </div>
      </header>
      {children}
    </>
  );
}

function SaveIndicator({ status }: { status: string }) {
  if (status === "saving")
    return (
      <span className="rc-saving">
        <Cloud size={12} /> saving…
      </span>
    );
  if (status === "saved")
    return (
      <span className="rc-saving">
        <Check size={12} /> saved
      </span>
    );
  return null;
}
