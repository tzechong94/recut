import type { Shot } from "../types";

/** Human label + class for the generator tool that produced a shot. */
const GEN_TOOL_META: Record<string, { label: string; cls: string }> = {
  i2v: { label: "i2v", cls: "i2v" },
  t2v: { label: "t2v", cls: "t2v" },
  continuity: { label: "continuity", cls: "continuity" },
};

/**
 * Orchestration badges shown on a shot once the agent has touched it:
 *  - which generator tool ran (i2v / t2v / continuity)
 *  - the consistency critic's 0–1 score as a green/red dot
 *  - how many times it was re-rolled (only if > 0)
 */
export function ShotBadges({ shot }: { shot: Shot }) {
  const tool = shot.gen_tool ? GEN_TOOL_META[shot.gen_tool] : undefined;
  const hasScore = typeof shot.critic_score === "number";
  const score = shot.critic_score as number;
  const reroll = shot.reroll_count ?? 0;

  if (!tool && !hasScore && reroll <= 0) return null;

  return (
    <div className="sr-shot-badges" data-testid="shot-badges">
      {tool && (
        <span className={"sr-badge sr-badge-tool " + tool.cls} title="Generator tool">
          {tool.label}
        </span>
      )}
      {!tool && shot.gen_tool && (
        <span className="sr-badge sr-badge-tool" title="Generator tool">
          {shot.gen_tool}
        </span>
      )}
      {hasScore && (
        <span
          className="sr-badge sr-badge-score"
          title="Consistency critic score (0–1)"
          data-testid="shot-critic-score"
        >
          <i
            className="sr-score-dot"
            style={{ background: scoreColor(score) }}
          />
          {score.toFixed(2)}
        </span>
      )}
      {reroll > 0 && (
        <span className="sr-badge sr-badge-reroll" title="Critic re-rolls">
          re-rolled ×{reroll}
        </span>
      )}
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 0.85) return "#0FB5A6";
  if (score >= 0.7) return "#F5A524";
  return "#ff5c49";
}
