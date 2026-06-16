/**
 * Derived token-ledger math for the provenance / token meter panel.
 * Mirrors recut.core.timeline_ops semantics: the panel and eval report read the
 * same numbers off the ledger; here we only compute the *derived* views.
 */
import type { TokenLedger } from "../types";

export interface LedgerDerived {
  total_s: number;
  real_footage_share: number; // 0..1
  generated_share: number;
  standin_share: number;
  tokens_saved: number;
}

export function deriveLedger(l: TokenLedger): LedgerDerived {
  const total_s = l.real_footage_s + l.generated_s + l.standin_s;
  const safe = total_s > 0 ? total_s : 1;
  return {
    total_s,
    real_footage_share: l.real_footage_s / safe,
    generated_share: l.generated_s / safe,
    standin_share: l.standin_s / safe,
    tokens_saved: l.naive_baseline_tokens - l.tokens_spent,
  };
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function fmtTokens(n: number): string {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
