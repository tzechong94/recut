import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Premise } from "./Premise";
import { api } from "../api/client";
import type { ProductionSummary } from "../types";

const SUMMARIES: ProductionSummary[] = [
  {
    id: "prod_a",
    title: "The Last Case",
    stage: "export",
    updated_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(), // 2h ago
  },
  {
    id: "prod_b",
    title: "Lighthouse",
    stage: "production",
    updated_at: new Date(Date.now() - 3 * 86400 * 1000).toISOString(), // 3d ago
  },
];

describe("Premise · productions gallery", () => {
  beforeEach(() => {
    vi.spyOn(api, "listStyles").mockResolvedValue([]);
    vi.spyOn(api, "listProductions").mockResolvedValue(SUMMARIES);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders past productions with stage chips and relative time", async () => {
    render(<Premise open={vi.fn()} />);

    const cards = await screen.findAllByTestId("prod-card");
    expect(cards).toHaveLength(2);

    const first = cards[0];
    expect(within(first).getByText("The Last Case")).toBeInTheDocument();
    const chip = within(first).getByTestId("stage-chip");
    expect(chip).toHaveTextContent(/final film/i);
    expect(chip.className).toMatch(/stage-export/);
    expect(within(first).getByText("2h ago")).toBeInTheDocument();

    const second = cards[1];
    expect(
      within(second).getByTestId("stage-chip"),
    ).toHaveTextContent(/in production/i);
    expect(within(second).getByText("3d ago")).toBeInTheDocument();
  });

  it("wires Resume to open the production", async () => {
    const open = vi.fn();
    render(<Premise open={open} />);

    const cards = await screen.findAllByTestId("prod-card");
    const resume = within(cards[0]).getByRole("button", { name: /resume/i });
    await userEvent.click(resume);
    expect(open).toHaveBeenCalledWith("prod_a");
  });

  it("wires Delete to remove the production", async () => {
    const del = vi.spyOn(api, "deleteProduction").mockResolvedValue(undefined);
    render(<Premise open={vi.fn()} />);

    const cards = await screen.findAllByTestId("prod-card");
    const delBtn = within(cards[1]).getByRole("button", {
      name: /delete production/i,
    });
    await userEvent.click(delBtn);

    expect(del).toHaveBeenCalledWith("prod_b");
    // Optimistically dropped from the shelf.
    await waitFor(() =>
      expect(screen.queryByText("Lighthouse")).not.toBeInTheDocument(),
    );
  });
});
