import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PreviewPlayer } from "./PreviewPlayer";
import { demoBaseCut, DEMO_RECIPE } from "../lib/demo";

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
    const tl = demoBaseCut("p1", DEMO_RECIPE);
    render(<PreviewPlayer timeline={tl} />);
    const caption = screen.getByTestId("preview-caption");
    expect(caption.textContent).toBe(tl.slots[0].text);
  });

  it("derives caption font-size in canvas px from the shared spec", () => {
    const tl = demoBaseCut("p1", DEMO_RECIPE);
    render(<PreviewPlayer timeline={tl} />);
    const caption = screen.getByTestId("preview-caption");
    // first slot is the 'l' display hook -> canvas_px 96 per caption-style.json
    expect(caption.getAttribute("data-canvas-px")).toBe("96");
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

    const tl = demoBaseCut("p1", DEMO_RECIPE);
    const onChange = vi.fn();
    render(<PreviewPlayer timeline={tl} onActiveSlotChange={onChange} />);

    // initially showing slot 0
    expect(screen.getByTestId("preview-caption").textContent).toBe(
      tl.slots[0].text,
    );

    const playBtn = screen.getByLabelText("Play");
    act(() => {
      playBtn.click();
    });

    // pump rAF: first slot lasts 3s, advance ~3.5s of frames
    const step = (ms: number) => {
      now += ms;
      const cbs = rafCbs.splice(0, rafCbs.length);
      act(() => {
        cbs.forEach((cb) => cb(now));
      });
    };
    // prime
    step(0);
    for (let i = 0; i < 8; i++) step(500); // 4s elapsed

    expect(screen.getByTestId("preview-caption").textContent).toBe(
      tl.slots[1].text,
    );
    expect(onChange).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("renders one scrubber segment per slot", () => {
    const tl = demoBaseCut("p1", DEMO_RECIPE);
    render(<PreviewPlayer timeline={tl} />);
    const segs = screen.getAllByLabelText(/^Go to /);
    expect(segs.length).toBe(tl.slots.length);
  });
});
