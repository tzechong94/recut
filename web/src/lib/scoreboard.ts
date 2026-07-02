/**
 * Pure helpers for the quality-per-token scoreboard — the live production
 * showpiece. Formatting + a defensive derivation so the UI renders sane numbers
 * even when the backend omits a field or `total` is stale.
 */
import type { Scoreboard } from "../types";

/** Compact token count: 1234 -> "1.2k", 2_500_000 -> "2.5M". */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n)}%`;
}

/** Consistency score 0..1 -> "0.92" or "—" when not yet scored. */
export function fmtConsistency(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "—";
  return score.toFixed(2);
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export interface ScoreboardView {
  total: number;
  text: number;
  image: number;
  video: number;
  voice: number;
  rerolls: number;
  tokensSaved: number;
  savingsPct: number;
  naiveBaseline: number;
  shotsReady: number;
  shotsTotal: number;
  shotsPct: number;
  avgConsistency: number | null;
  durationS: number;
  /** Fractions (0..1) of total tokens by type, for a stacked bar. */
  fractions: { text: number; image: number; video: number; voice: number };
}

/**
 * Derive a render-ready view. Recomputes `total` from parts (the source of truth)
 * and a savings_pct if the backend left it at 0 but tokens were clearly saved.
 */
export function deriveScoreboard(sb: Scoreboard | null): ScoreboardView {
  const t = sb?.tokens ?? { text: 0, image: 0, video: 0, voice: 0, total: 0 };
  const total = t.text + t.image + t.video + t.voice || t.total || 0;
  const naive = sb?.naive_baseline_tokens ?? 0;
  const tokensSaved =
    sb?.tokens_saved ?? Math.max(0, naive - total);
  const savingsPct =
    sb?.savings_pct && sb.savings_pct > 0
      ? sb.savings_pct
      : naive > 0
        ? Math.round((tokensSaved / naive) * 1000) / 10
        : 0;
  const shotsTotal = sb?.shots_total ?? 0;
  const shotsReady = sb?.shots_ready ?? 0;

  const safe = (n: number) => (total > 0 ? n / total : 0);

  return {
    total,
    text: t.text,
    image: t.image,
    video: t.video,
    voice: t.voice,
    rerolls: sb?.rerolls ?? 0,
    tokensSaved,
    savingsPct,
    naiveBaseline: naive,
    shotsReady,
    shotsTotal,
    shotsPct: shotsTotal > 0 ? Math.round((shotsReady / shotsTotal) * 100) : 0,
    avgConsistency: sb?.avg_consistency ?? null,
    durationS: sb?.duration_s ?? 0,
    fractions: {
      text: safe(t.text),
      image: safe(t.image),
      video: safe(t.video),
      voice: safe(t.voice),
    },
  };
}
