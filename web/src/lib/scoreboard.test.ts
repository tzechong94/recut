import { describe, expect, it } from "vitest";
import {
  deriveScoreboard,
  fmtConsistency,
  fmtDuration,
  fmtPct,
  fmtTokens,
} from "./scoreboard";
import { makeScoreboard } from "./fixtures";

describe("scoreboard formatting", () => {
  it("formats token counts compactly", () => {
    expect(fmtTokens(950)).toBe("950");
    expect(fmtTokens(1500)).toBe("1.5k");
    expect(fmtTokens(2_500_000)).toBe("2.5M");
    expect(fmtTokens(NaN)).toBe("0");
  });

  it("formats percentages and consistency", () => {
    expect(fmtPct(66.8)).toBe("67%");
    expect(fmtConsistency(0.912)).toBe("0.91");
    expect(fmtConsistency(null)).toBe("—");
    expect(fmtConsistency(undefined)).toBe("—");
  });

  it("formats durations as m:ss", () => {
    expect(fmtDuration(42)).toBe("0:42");
    expect(fmtDuration(90)).toBe("1:30");
    expect(fmtDuration(-5)).toBe("0:00");
  });
});

describe("deriveScoreboard", () => {
  it("returns zeros for a null scoreboard", () => {
    const v = deriveScoreboard(null);
    expect(v.total).toBe(0);
    expect(v.shotsPct).toBe(0);
    expect(v.avgConsistency).toBeNull();
    expect(v.fractions.video).toBe(0);
  });

  it("recomputes total from parts and derives fractions", () => {
    const v = deriveScoreboard(makeScoreboard());
    expect(v.total).toBe(4000 + 6000 + 120000 + 3000);
    // fractions sum to ~1
    const sum =
      v.fractions.text +
      v.fractions.image +
      v.fractions.video +
      v.fractions.voice;
    expect(sum).toBeCloseTo(1, 5);
    expect(v.shotsPct).toBe(50); // 3/6
  });

  it("falls back to deriving savings_pct when backend left it 0", () => {
    const v = deriveScoreboard(
      makeScoreboard({
        savings_pct: 0,
        naive_baseline_tokens: 400000,
        tokens_saved: 267000,
      }),
    );
    expect(v.savingsPct).toBeGreaterThan(60);
    expect(v.savingsPct).toBeLessThan(70);
  });

  it("derives tokens_saved when omitted", () => {
    const sb = makeScoreboard();
    // simulate a backend that omits tokens_saved
    const partial = { ...sb } as Record<string, unknown>;
    delete partial.tokens_saved;
    const v = deriveScoreboard(partial as never);
    expect(v.tokensSaved).toBe(400000 - 133000);
  });
});
