import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ProofPanel } from "./ProofPanel";
import { makeEval } from "../lib/fixtures";

describe("ProofPanel", () => {
  afterEach(cleanup);

  it("renders nothing when there is no eval data yet", () => {
    const { container } = render(<ProofPanel ev={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the narrative overall, sub-scores, consistency and honest token facts", () => {
    render(<ProofPanel ev={makeEval()} />);
    const panel = screen.getByTestId("proof-panel");
    expect(panel).toBeInTheDocument();

    // narrative overall + a rubric sub-score
    expect(screen.getByText("0.88")).toBeInTheDocument();
    const rubric = screen.getByTestId("proof-rubric");
    expect(within(rubric).getByText(/stakes/i)).toBeInTheDocument();
    expect(within(rubric).getByText("0.83")).toBeInTheDocument();

    // avg consistency
    expect(screen.getByText("0.91")).toBeInTheDocument();

    // the honest closer: 0 video tokens before approval
    expect(
      screen.getByText(/video tokens\s*before you approved/i),
    ).toBeInTheDocument();
    // re-rolls + est. saved facts
    expect(screen.getByText(/critic re-roll/i)).toBeInTheDocument();
    expect(screen.getByText(/est\. saved/i)).toBeInTheDocument();
  });
});
