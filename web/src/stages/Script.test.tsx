import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScriptStage } from "./Script";
import { api } from "../api/client";
import { makeProduction } from "../lib/fixtures";
import type { UseProduction } from "../lib/useProduction";
import type { Production } from "../types";

function ctlFor(
  production: Production,
  over: Partial<UseProduction> = {},
): UseProduction {
  return {
    production,
    loading: false,
    error: null,
    saveStatus: "idle",
    update: vi.fn(),
    set: vi.fn(),
    refetch: vi.fn(async () => production),
    ...over,
  };
}

describe("ScriptStage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

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

  it("editing a character name calls renameCharacter and reflects the propagated production", async () => {
    const prod = makeProduction();
    // The rename endpoint propagates the new name across the whole script.
    const renamed = makeProduction({
      characters: [{ ...prod.characters[0], name: "Detective Mara" }],
      logline: "Mara takes one last case before the rain washes it all away.",
    });
    const renameSpy = vi
      .spyOn(api, "renameCharacter")
      .mockResolvedValue(renamed);
    const set = vi.fn();
    render(<ScriptStage ctl={ctlFor(prod, { set })} onAdvance={vi.fn()} />);

    const nameField = screen.getByLabelText("Character name");
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "Detective Mara");
    await userEvent.tab(); // blur → commit

    await waitFor(() => expect(renameSpy).toHaveBeenCalledTimes(1));
    expect(renameSpy).toHaveBeenCalledWith("prod_1", "char_1", "Detective Mara");
    // Local production state is replaced with the propagated response.
    expect(set).toHaveBeenCalledWith(renamed);
  });

  it("does not call renameCharacter when the name is unchanged", async () => {
    const prod = makeProduction();
    const renameSpy = vi.spyOn(api, "renameCharacter");
    render(<ScriptStage ctl={ctlFor(prod)} onAdvance={vi.fn()} />);

    const nameField = screen.getByLabelText("Character name");
    await userEvent.click(nameField);
    await userEvent.tab(); // blur without editing
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it("submitting a note calls reviseProduction and updates the treatment", async () => {
    const prod = makeProduction();
    const revised = makeProduction({
      logline: "A noir reckoning under endless rain.",
    });
    const reviseSpy = vi
      .spyOn(api, "reviseProduction")
      .mockResolvedValue(revised);
    const set = vi.fn();
    render(<ScriptStage ctl={ctlFor(prod, { set })} onAdvance={vi.fn()} />);

    const input = screen.getByLabelText("Notes to the writers' room");
    const send = screen.getByLabelText("Send note to writers' room");
    // Send is disabled while empty.
    expect(send).toBeDisabled();

    await userEvent.type(input, "make it noir");
    expect(send).toBeEnabled();
    await userEvent.click(send);

    await waitFor(() => expect(reviseSpy).toHaveBeenCalledTimes(1));
    expect(reviseSpy).toHaveBeenCalledWith("prod_1", "make it noir");
    expect(set).toHaveBeenCalledWith(revised);
    // Input clears after a successful revision.
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("keeps the note in the box and does not crash when revise fails (offline)", async () => {
    const prod = makeProduction();
    const reviseSpy = vi
      .spyOn(api, "reviseProduction")
      .mockRejectedValue(new Error("offline"));
    const set = vi.fn();
    render(<ScriptStage ctl={ctlFor(prod, { set })} onAdvance={vi.fn()} />);

    const input = screen.getByLabelText("Notes to the writers' room");
    await userEvent.type(input, "cut the rival");
    await userEvent.click(screen.getByLabelText("Send note to writers' room"));

    await waitFor(() => expect(reviseSpy).toHaveBeenCalledTimes(1));
    expect(set).not.toHaveBeenCalled();
    expect(input).toHaveValue("cut the rival");
  });
});
