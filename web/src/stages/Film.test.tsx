import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FilmStage } from "./Film";
import { api, API_BASE } from "../api/client";
import { makeProduction } from "../lib/fixtures";
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

describe("FilmStage · download button", () => {
  beforeEach(() => {
    // The stage hydrates scoreboard/timeline/eval on mount; keep those inert so
    // the test is deterministic and doesn't touch the network.
    vi.spyOn(api, "getScoreboard").mockResolvedValue(null as never);
    vi.spyOn(api, "getTimeline").mockResolvedValue(null as never);
    vi.spyOn(api, "getEval").mockResolvedValue(null as never);
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a Download button with the correct href when the produce job returns an export asset", () => {
    const prod = makeProduction({ stage: "export" });
    render(<FilmStage ctl={ctlFor(prod)} exportAssetId="asset_export_99" />);
    const link = screen.getByTestId("download-film");
    expect(link).toHaveAttribute(
      "href",
      `${API_BASE}/api/assets/asset_export_99/raw`,
    );
    expect(link).toHaveAttribute("download", "The Last Case.mp4");
  });

  it("falls back to production.export_asset_id when no live export id is passed", () => {
    const prod = makeProduction({
      stage: "export",
      export_asset_id: "asset_persisted_7",
    });
    render(<FilmStage ctl={ctlFor(prod)} exportAssetId={null} />);
    const link = screen.getByTestId("download-film");
    expect(link).toHaveAttribute(
      "href",
      `${API_BASE}/api/assets/asset_persisted_7/raw`,
    );
  });

  it("hides the Download button when there is no export asset anywhere", () => {
    const prod = makeProduction({ stage: "export", export_asset_id: null });
    render(<FilmStage ctl={ctlFor(prod)} exportAssetId={null} />);
    expect(screen.queryByTestId("download-film")).not.toBeInTheDocument();
  });
});
