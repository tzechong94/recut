import {
  Bot,
  Brain,
  Clapperboard,
  Eye,
  Image as ImageIcon,
  Mic,
  Scissors,
} from "lucide-react";
import type { Production, Scoreboard } from "../types";

/**
 * The multimodal orchestration, rendered from the run's OWN data: which model did
 * what, with real counts from the production doc + ledger. Pure telemetry — zero spend.
 */
export function OrchestrationMap({
  production: p,
  scoreboard,
}: {
  production: Production;
  scoreboard: Scoreboard | null;
}) {
  const shots = p.scenes.flatMap((s) => s.shots);
  const stills = shots.filter((s) => s.keyframe_asset_id || s.keyframe_url).length;
  const gated = shots.filter((s) => s.keyframe_score != null).length;
  const ready = shots.filter((s) => s.asset_id).length;
  const spoken = shots.filter((s) => s.dialogue.length > 0 || s.narration).length;
  const castLocked = p.characters.filter((c) => c.reference_url).length;
  const setsLocked = p.locations.filter((l) => l.reference_url).length;
  const rows = [
    {
      icon: <Brain size={13} />,
      stage: "Writers' room",
      model: "qwen-max",
      note: `${p.writers_room.length} exchanges · ${p.scenes.length} scenes written + critiqued`,
    },
    {
      icon: <ImageIcon size={13} />,
      stage: "Casting",
      model: "wan t2i · qwen-vl anchors",
      note: `${castLocked}/${p.characters.length} cast · ${setsLocked}/${p.locations.length} sets locked`,
    },
    {
      icon: <Eye size={13} />,
      stage: "Shot board",
      model: "qwen-image-edit · qwen-vl gate",
      note:
        `${stills}/${shots.length} stills composed · ${gated} gated` +
        ((scoreboard?.still_rerolls ?? 0) > 0
          ? ` · ${scoreboard!.still_rerolls} drift caught at image price`
          : ""),
    },
    {
      icon: <Clapperboard size={13} />,
      stage: "Film",
      model: "wan i2v · qwen-vl critic",
      note: `${ready}/${shots.length} shots · ${scoreboard?.rerolls ?? 0} video re-roll${(scoreboard?.rerolls ?? 0) === 1 ? "" : "s"}`,
    },
    {
      icon: <Mic size={13} />,
      stage: "Voice",
      model: "qwen3-tts",
      note: `${spoken} spoken shot${spoken === 1 ? "" : "s"}`,
    },
    {
      icon: <Scissors size={13} />,
      stage: "Edit",
      model: "ffmpeg",
      note: `render v${p.version} · 0 model tokens`,
    },
  ];

  return (
    <div className="sr-board sr-orchmap" data-testid="orchestration-map">
      <div className="sr-board-title">
        <Bot size={15} /> Orchestration — one production, six models
      </div>
      {rows.map((r) => (
        <div className="sr-orch-row" key={r.stage}>
          <span className="sr-orch-icon">{r.icon}</span>
          <div className="sr-orch-body">
            <div className="sr-orch-stage">{r.stage}</div>
            <div className="sr-orch-note">{r.note}</div>
          </div>
          <span className="sr-orch-model">{r.model}</span>
        </div>
      ))}
    </div>
  );
}
