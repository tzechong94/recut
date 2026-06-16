import { describe, expect, it } from "vitest";
import captionStyle from "../../../shared/caption-style.json";
import { CAPTION_STYLE, captionGeometry, canvasPx, previewPx } from "./captionGeometry";

/**
 * Caption-parity mirror test (the anti-drift keystone).
 * Reads shared/caption-style.json directly and pins the invariant that the
 * Python render also enforces: canvas_px === px * scale_factor for every size.
 */
describe("caption-style.json parity invariant", () => {
  it("uses the real shared spec (not a copy)", () => {
    expect(CAPTION_STYLE).toBe(captionStyle);
  });

  it("canvas_px === px * scale_factor for every size", () => {
    const sf = captionStyle.scale_factor;
    for (const key of Object.keys(captionStyle.sizes) as Array<
      keyof typeof captionStyle.sizes
    >) {
      const s = captionStyle.sizes[key];
      expect(s.canvas_px).toBe(s.px * sf);
    }
  });

  it("scale_factor matches canvas width / preview phone width", () => {
    expect(captionStyle.scale_factor).toBe(
      captionStyle.canvas.width / captionStyle.preview_phone_width,
    );
  });

  it("helper canvasPx / previewPx mirror the spec", () => {
    for (const key of ["s", "m", "l"] as const) {
      expect(canvasPx(key)).toBe(captionStyle.sizes[key].canvas_px);
      expect(previewPx(key)).toBe(captionStyle.sizes[key].px);
      expect(canvasPx(key)).toBe(previewPx(key) * captionStyle.scale_factor);
    }
  });
});

describe("captionGeometry helper", () => {
  it("returns expected alignment + size for a text card", () => {
    const g = captionGeometry("l", "center", "display", "text_card");
    expect(g.textAlign).toBe("center");
    expect(g.assAlign).toBe(captionStyle.align_map.center.ass);
    expect(g.anchorXFrac).toBe(captionStyle.align_map.center.anchor_x_frac);
    // at the reference phone width, preview px equals the spec px exactly
    expect(g.fontSizePx).toBe(captionStyle.sizes.l.px);
    expect(g.fontSizeCanvasPx).toBe(captionStyle.sizes.l.canvas_px);
    expect(g.vertical).toBe(captionStyle.layout.text_card.vertical);
    expect(g.lowerThirdYFrac).toBeNull();
    expect(g.fontFamily).toContain(captionStyle.fonts.display.family);
    expect(g.fontWeight).toBe(captionStyle.fonts.display.weight);
  });

  it("returns lower-third geometry + left align for a caption", () => {
    const g = captionGeometry("m", "left", "clean", "caption");
    expect(g.textAlign).toBe("left");
    expect(g.assAlign).toBe(captionStyle.align_map.left.ass);
    expect(g.vertical).toBe("lower_third");
    expect(g.lowerThirdYFrac).toBe(
      captionStyle.layout.caption.lower_third_y_frac,
    );
    expect(g.fontSizePx).toBe(captionStyle.sizes.m.px);
  });

  it("scales preview px linearly with the on-screen phone width", () => {
    const refW = captionStyle.preview_phone_width;
    const g1 = captionGeometry("m", "center", "clean", "caption", refW);
    const g2 = captionGeometry("m", "center", "clean", "caption", refW * 2);
    expect(g2.fontSizePx).toBeCloseTo(g1.fontSizePx * 2, 5);
    // but the canvas px (export side) is invariant to preview width
    expect(g2.fontSizeCanvasPx).toBe(g1.fontSizeCanvasPx);
  });
});
