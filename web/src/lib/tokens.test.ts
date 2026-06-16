import { describe, expect, it } from "vitest";
import { deriveLedger, fmtTokens, pct } from "./tokens";
import type { TokenLedger } from "../types";

describe("deriveLedger", () => {
  it("computes total, shares, and tokens_saved", () => {
    const ledger: TokenLedger = {
      real_footage_s: 6,
      generated_s: 3,
      standin_s: 1,
      tokens_spent: 3600,
      naive_baseline_tokens: 12000,
    };
    const d = deriveLedger(ledger);
    expect(d.total_s).toBe(10);
    expect(d.real_footage_share).toBeCloseTo(0.6, 6);
    expect(d.generated_share).toBeCloseTo(0.3, 6);
    expect(d.standin_share).toBeCloseTo(0.1, 6);
    expect(d.tokens_saved).toBe(8400);
  });

  it("does not divide by zero for an empty timeline", () => {
    const ledger: TokenLedger = {
      real_footage_s: 0,
      generated_s: 0,
      standin_s: 0,
      tokens_spent: 0,
      naive_baseline_tokens: 0,
    };
    const d = deriveLedger(ledger);
    expect(d.total_s).toBe(0);
    expect(d.real_footage_share).toBe(0);
    expect(Number.isFinite(d.real_footage_share)).toBe(true);
    expect(d.tokens_saved).toBe(0);
  });

  it("shares sum to 1 when there is footage", () => {
    const ledger: TokenLedger = {
      real_footage_s: 2,
      generated_s: 5,
      standin_s: 3,
      tokens_spent: 6000,
      naive_baseline_tokens: 12000,
    };
    const d = deriveLedger(ledger);
    expect(
      d.real_footage_share + d.generated_share + d.standin_share,
    ).toBeCloseTo(1, 6);
  });
});

describe("formatters", () => {
  it("pct rounds to whole percent", () => {
    expect(pct(0.6)).toBe("60%");
    expect(pct(0.555)).toBe("56%");
    expect(pct(0)).toBe("0%");
  });

  it("fmtTokens abbreviates thousands", () => {
    expect(fmtTokens(8400)).toBe("8.4k");
    expect(fmtTokens(950)).toBe("950");
    expect(fmtTokens(-1200)).toBe("-1.2k");
  });
});
