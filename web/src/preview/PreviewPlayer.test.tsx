import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PreviewPlayer } from "./PreviewPlayer";
import { makeTimeline } from "../lib/fixtures";

afterEach(cleanup);

describe("PreviewPlayer", () => {
  beforeEach(() => {
    // jsdom lacks ResizeObserver
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders the first slot's caption from the timeline", () => {
    const tl = makeTimeline();
    render(<PreviewPlayer timeline={tl} />);
    const caption = screen.getByTestId("preview-caption");
    expect(caption.textContent).toBe(tl.slots[0].text);
  });

  it("advances to the next slot when play is pressed and time elapses", () => {
    vi.useFakeTimers();
    let now = 0;
    const rafCbs: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCbs.push(cb);
      return rafCbs.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const tl = makeTimeline();
    const onChange = vi.fn();
    render(<PreviewPlayer timeline={tl} onActiveSlotChange={onChange} />);

    expect(screen.getByTestId("preview-caption").textContent).toBe(
      tl.slots[0].text,
    );

    const playBtn = screen.getByLabelText("Play");
    act(() => {
      playBtn.click();
    });

    const step = (ms: number) => {
      now += ms;
      const cbs = rafCbs.splice(0, rafCbs.length);
      act(() => {
        cbs.forEach((cb) => cb(now));
      });
    };
    step(0);
    for (let i = 0; i < 8; i++) step(500); // 4s elapsed; slot 0 lasts 3s

    expect(screen.getByTestId("preview-caption").textContent).toBe(
      tl.slots[1].text,
    );
    expect(onChange).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("renders one scrubber segment per slot", () => {
    const tl = makeTimeline();
    render(<PreviewPlayer timeline={tl} />);
    const segs = screen.getAllByLabelText(/^Go to /);
    expect(segs.length).toBe(tl.slots.length);
  });

  it("shows the empty state for a timeline with no slots", () => {
    render(<PreviewPlayer timeline={makeTimeline([])} />);
    expect(screen.getByTestId("preview-empty")).toBeInTheDocument();
  });
});
