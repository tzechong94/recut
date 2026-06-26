import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DirectorLog } from "./DirectorLog";
import { WarningsBanner } from "./WarningsBanner";
import type { DirectorLogEntry } from "../types";

const LOG: DirectorLogEntry[] = [
  {
    shot: "Shot 1",
    decision: "image-to-video from locked reference",
    reason: "consistency 0.94; clean on first pass",
  },
  {
    shot: "Shot 3",
    decision: "image-to-video from locked reference",
    reason: "consistency 0.84; re-rolled ×1 to fix drift",
  },
];

describe("DirectorLog", () => {
  afterEach(cleanup);

  it("renders each decision as shot → decision → reason", () => {
    render(<DirectorLog log={LOG} />);
    const panel = screen.getByTestId("director-log");
    expect(within(panel).getByText("Shot 1")).toBeInTheDocument();
    expect(within(panel).getByText("Shot 3")).toBeInTheDocument();
    expect(
      within(panel).getByText(/re-rolled ×1 to fix drift/),
    ).toBeInTheDocument();
    // two reasons, both visible in the feed
    expect(
      within(panel).getAllByText(/image-to-video from locked reference/).length,
    ).toBe(2);
  });

  it("shows a LIVE indicator while producing", () => {
    render(<DirectorLog log={LOG} live />);
    expect(screen.getByTestId("director-log-live")).toBeInTheDocument();
  });

  it("degrades gracefully with no log yet", () => {
    render(<DirectorLog log={undefined} />);
    expect(screen.getByTestId("director-log")).toBeInTheDocument();
    expect(screen.getByText(/decisions will appear here/i)).toBeInTheDocument();
  });
});

describe("WarningsBanner", () => {
  afterEach(cleanup);

  it("lists non-fatal warnings as a dismissible heads-up", () => {
    render(<WarningsBanner warnings={["Scene 4 dropped to hit target."]} />);
    const banner = screen.getByTestId("warnings-banner");
    expect(
      within(banner).getByText(/Scene 4 dropped to hit target/),
    ).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("warnings-banner")).not.toBeInTheDocument();
  });

  it("renders nothing when there are no warnings", () => {
    render(<WarningsBanner warnings={[]} />);
    expect(screen.queryByTestId("warnings-banner")).not.toBeInTheDocument();
  });
});
