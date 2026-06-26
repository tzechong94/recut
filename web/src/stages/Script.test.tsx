import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ScriptStage } from "./Script";
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

describe("ScriptStage", () => {
  afterEach(cleanup);

  it("surfaces the dramatic question near the logline", () => {
    const prod = makeProduction();
    render(<ScriptStage ctl={ctlFor(prod)} onAdvance={vi.fn()} />);
    const q = screen.getByTestId("dramatic-question");
    expect(q).toBeInTheDocument();
    expect(
      within(q).getByLabelText("Dramatic question"),
    ).toHaveValue("Will Vance solve the case before it solves him?");
    expect(within(q).getByText(/redemption/i)).toBeInTheDocument();
  });

  it("renders the writers' room as an alternating transcript with a climbing critic score", () => {
    const prod = makeProduction();
    render(<ScriptStage ctl={ctlFor(prod)} onAdvance={vi.fn()} />);
    const room = screen.getByTestId("writers-room");

    // alternating roles present
    expect(within(room).getAllByText("Writer").length).toBeGreaterThan(0);
    expect(within(room).getAllByText("Critic").length).toBe(2);

    // both critic score chips shown, climbing 0.70 -> 0.86
    expect(within(room).getByText("0.70")).toBeInTheDocument();
    expect(within(room).getByText("0.86")).toBeInTheDocument();

    // a positive delta chip appears on the second critic pass
    expect(within(room).getByText(/▲/)).toBeInTheDocument();

    // header carries the final score
    expect(screen.getByTestId("room-final-score").textContent).toContain("0.86");
  });

  it("renders the written dialogue as a screenplay block under the scene", () => {
    const prod = makeProduction();
    render(<ScriptStage ctl={ctlFor(prod)} onAdvance={vi.fn()} />);
    const block = screen.getByTestId("script-block");
    expect(block).toBeInTheDocument();
    // character cue + the actual editable line that gets spoken/burned
    expect(within(block).getAllByText("Detective Vance").length).toBe(2);
    expect(
      within(block).getByLabelText("Line 1 for Detective Vance"),
    ).toHaveValue("Some cases don't want to be solved.");
  });

  it("folds dialogue-role transcript turns (with scores) into the writers' room", () => {
    const prod = makeProduction();
    render(<ScriptStage ctl={ctlFor(prod)} onAdvance={vi.fn()} />);
    const room = screen.getByTestId("writers-room");
    expect(within(room).getByText("Dialogue")).toBeInTheDocument();
    expect(within(room).getByText("0.82")).toBeInTheDocument();
  });
});
