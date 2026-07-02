import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProduceStage, effectiveStatus } from "./Produce";
import { ScoreboardPanel } from "../components/Scoreboard";
import { makeProduction, makeScoreboard } from "../lib/fixtures";
import type { UseProduction } from "../lib/useProduction";
import type { Production } from "../types";

function ctlFor(production: Production): UseProduction {
  return {
    production,
    loading: false,
    error: null,
    saveStatus: "idle",
    update: vi.fn(),
    set: vi.fn(),
    refetch: vi.fn(async () => production),
  };
}

describe("ProduceStage", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the run-sheet gate — the human approves the exact plan", () => {
    const prod = makeProduction({ stage: "storyboard" });
    render(<ProduceStage ctl={ctlFor(prod)} onAdvance={vi.fn()} />);
    const sheet = screen.getByTestId("run-sheet");
    expect(sheet).toHaveTextContent(/1 × Wan i2v/i);
    expect(sheet).toHaveTextContent(/video tokens \(est\.\)/i);
    expect(sheet).toHaveTextContent(/0 model tokens/i);
    expect(
      screen.getByRole("button", { name: /Action — approve the plan/i }),
    ).toBeInTheDocument();
  });

  it("renders the live shot-status list when revisiting a finished production", () => {
    const prod = makeProduction({
      stage: "export",
      scenes: [
        {
          id: "scene_1",
          index: 0,
          heading: "EXT. ALLEY - NIGHT",
          summary: "Vance finds the clue.",
          shots: [
            {
              id: "shot_1",
              index: 0,
              shot_type: "wide",
              camera: "static",
              action: "Vance steps into the alley.",
              dialogue: [],
              narration: "",
              character_ids: [],
              location_id: "loc_1",
              duration_s: 4,
              source: "generated",
              asset_id: "asset_clip_1",
              status: "ready",
              reroll_count: 1,
              critic_score: 0.94,
            },
          ],
        },
      ],
    });
    render(<ProduceStage ctl={ctlFor(prod)} onAdvance={vi.fn()} />);
    const list = screen.getByTestId("shot-status-list");
    expect(list).toBeInTheDocument();
    expect(screen.getByText(/Vance steps into the alley/)).toBeInTheDocument();
    // status chip shows "ready" since the shot has an asset
    expect(screen.getAllByText(/ready/i).length).toBeGreaterThan(0);
  });

  it("effectiveStatus treats any shot with an asset as ready", () => {
    expect(
      effectiveStatus({ asset_id: "a1", status: "planned" } as never),
    ).toBe("ready");
    expect(
      effectiveStatus({ asset_id: null, status: "generating" } as never),
    ).toBe("generating");
  });
});

describe("ScoreboardPanel", () => {
  afterEach(cleanup);

  it("renders saved tokens and shots-ready from the scoreboard", () => {
    render(<ScoreboardPanel scoreboard={makeScoreboard()} live />);
    expect(screen.getByTestId("scoreboard")).toBeInTheDocument();
    // 267000 saved -> "267.0k"
    expect(screen.getByTestId("tokens-saved").textContent).toBe("267.0k");
    expect(screen.getByText("3/6")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("degrades gracefully when the scoreboard is null", () => {
    render(<ScoreboardPanel scoreboard={null} />);
    expect(screen.getByTestId("tokens-saved").textContent).toBe("0");
  });
});
