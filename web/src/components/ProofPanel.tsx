import { Award, Coins, Gauge, RotateCw, ShieldCheck, TrendingDown } from "lucide-react";
import type { ProductionEval } from "../types";
import { fmtConsistency, fmtPct, fmtTokens } from "../lib/scoreboard";

/**
 * The demo's closer: a results-slide "proof" card built from GET /eval.
 * Shows the narrative rubric (overall + sub-scores), avg consistency, and the
 * honest token facts — including that 0 video tokens were spent before approval.
 */
export function ProofPanel({ ev }: { ev: ProductionEval | null }) {
  if (!ev) return null;
  const { narrative, tokens, avg_consistency } = ev;
  const subs = Object.entries(narrative.scores ?? {});
  const savedPct =
    tokens.baseline_estimate > 0
      ? (tokens.estimated_saved / tokens.baseline_estimate) * 100
      : 0;

  return (
    <div className="sr-proof" data-testid="proof-panel">
      <div className="sr-proof-head">
        <Award size={16} /> The proof
      </div>

      <div className="sr-proof-hero">
        <div className="sr-proof-overall">
          <div className="sr-proof-overall-num">
            {narrative.overall.toFixed(2)}
          </div>
          <div className="sr-proof-overall-label">narrative rubric</div>
        </div>
        <div className="sr-proof-consistency">
          <div className="sr-proof-stat-label">
            <Gauge size={12} /> avg consistency
          </div>
          <div className="sr-proof-stat-value">
            {fmtConsistency(avg_consistency)}
          </div>
        </div>
      </div>

      {subs.length > 0 && (
        <div className="sr-proof-rubric" data-testid="proof-rubric">
          {subs.map(([key, val]) => (
            <div className="sr-proof-rubric-row" key={key}>
              <span className="sr-proof-rubric-label">
                {key.replace(/_/g, " ")}
              </span>
              <span className="sr-proof-rubric-bar">
                <i style={{ width: `${Math.max(0, Math.min(1, val)) * 100}%` }} />
              </span>
              <span className="sr-proof-rubric-num">{val.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {narrative.notes && (
        <p className="sr-proof-notes">{narrative.notes}</p>
      )}

      <div className="sr-proof-facts">
        <div className="sr-proof-fact pre-approval">
          <ShieldCheck size={13} />
          <span>
            <b>{fmtTokens(tokens.video_tokens_pre_approval)}</b> video tokens
            before you approved
          </span>
        </div>
        <div className="sr-proof-fact">
          <Coins size={13} />
          <span>
            <b>{fmtTokens(tokens.video_tokens)}</b> video ·{" "}
            <b>{fmtTokens(tokens.total)}</b> total
          </span>
        </div>
        <div className="sr-proof-fact">
          <RotateCw size={13} />
          <span>
            <b>{tokens.rerolls}</b> critic re-roll{tokens.rerolls === 1 ? "" : "s"}
          </span>
        </div>
        <div className="sr-proof-fact saved">
          <TrendingDown size={13} />
          <span>
            <b>{fmtTokens(tokens.estimated_saved)}</b> est. saved ·{" "}
            {fmtPct(savedPct)} under{" "}
            <b>{fmtTokens(tokens.baseline_estimate)}</b> baseline
          </span>
        </div>
      </div>
    </div>
  );
}
