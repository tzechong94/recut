import { Coins, Gauge, RotateCw, Sparkles, TrendingDown } from "lucide-react";
import type { Scoreboard } from "../types";
import {
  deriveScoreboard,
  fmtConsistency,
  fmtPct,
  fmtTokens,
} from "../lib/scoreboard";

/** Quality-per-token scoreboard — the live production showpiece. */
export function ScoreboardPanel({
  scoreboard,
  live,
}: {
  scoreboard: Scoreboard | null;
  live?: boolean;
}) {
  const v = deriveScoreboard(scoreboard);
  const bar = [
    { key: "text", color: "#0FB5A6", frac: v.fractions.text },
    { key: "image", color: "#F5A524", frac: v.fractions.image },
    { key: "video", color: "#7B5CFF", frac: v.fractions.video },
    { key: "voice", color: "#5B3DF5", frac: v.fractions.voice },
  ];

  return (
    <div className="sr-board" data-testid="scoreboard">
      <div className="sr-board-top">
        <div className="sr-board-title">
          <Gauge size={15} /> Quality / token
        </div>
        {live && (
          <span className="sr-live">
            <i /> LIVE
          </span>
        )}
      </div>

      <div className="sr-board-hero">
        <div className="sr-board-saved" data-testid="tokens-saved">
          {fmtTokens(v.tokensSaved)}
        </div>
        <div className="sr-board-savedsub">
          tokens saved · <b>{fmtPct(v.savingsPct)}</b> under the naive baseline
        </div>
      </div>

      <div className="sr-board-bar">
        {bar.map((b) => (
          <i
            key={b.key}
            style={{ flex: Math.max(b.frac, 0.001), background: b.color }}
            title={`${b.key}: ${fmtTokens(
              v[b.key as "text" | "image" | "video" | "voice"],
            )}`}
          />
        ))}
      </div>
      <div className="sr-board-legend">
        <span><i style={{ background: "#0FB5A6" }} /> text {fmtTokens(v.text)}</span>
        <span><i style={{ background: "#F5A524" }} /> image {fmtTokens(v.image)}</span>
        <span><i style={{ background: "#7B5CFF" }} /> video {fmtTokens(v.video)}</span>
        <span><i style={{ background: "#5B3DF5" }} /> voice {fmtTokens(v.voice)}</span>
      </div>

      <div className="sr-board-stats">
        <Stat
          icon={<Sparkles size={13} />}
          label="shots ready"
          value={`${v.shotsReady}/${v.shotsTotal}`}
          sub={`${v.shotsPct}%`}
        />
        <Stat
          icon={<Gauge size={13} />}
          label="avg consistency"
          value={fmtConsistency(v.avgConsistency)}
        />
        <Stat
          icon={<RotateCw size={13} />}
          label="critic rerolls"
          value={String(v.rerolls)}
          sub={
            (scoreboard?.still_rerolls ?? 0) > 0
              ? `+${scoreboard!.still_rerolls} caught on stills`
              : undefined
          }
        />
        <Stat
          icon={<Coins size={13} />}
          label="tokens spent"
          value={fmtTokens(v.total)}
        />
      </div>

      <div className="sr-board-baseline">
        <TrendingDown size={13} />
        <span>
          Plan-first + consistency critic vs naive 3× re-gen:{" "}
          <b>{fmtTokens(v.naiveBaseline)}</b> baseline
        </span>
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="sr-stat">
      <div className="sr-stat-label">
        {icon} {label}
      </div>
      <div className="sr-stat-value">
        {value}
        {sub && <span className="sr-stat-sub">{sub}</span>}
      </div>
    </div>
  );
}
