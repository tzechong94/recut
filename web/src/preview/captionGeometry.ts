/**
 * Caption geometry — derived ENTIRELY from shared/caption-style.json.
 *
 * This is the anti-drift keystone shared with the Python render. The live
 * preview MUST compute caption geometry from this spec, never hardcoded values,
 * so the in-browser preview and the exported MP4 cannot diverge.
 *
 * Invariant (pinned by captionGeometry.test.ts):
 *   sizes[x].canvas_px === sizes[x].px * scale_factor   for every size.
 */
import captionStyle from "../../../shared/caption-style.json";
import type { SlotAlign, SlotFont, SlotSize } from "../types";

export const CAPTION_STYLE = captionStyle;

export type CaptionKind = "text_card" | "caption";

const FONT_STACK: Record<SlotFont, string> = {
  display: `'${captionStyle.fonts.display.family}', sans-serif`,
  clean: `'${captionStyle.fonts.clean.family}', sans-serif`,
  mono: `'${captionStyle.fonts.mono.family}', monospace`,
};

export interface CaptionGeometry {
  /** font-size in CSS px for the preview phone (caption-style preview scale). */
  fontSizePx: number;
  /** font-size in render-canvas px (1080-wide). preview * scale_factor. */
  fontSizeCanvasPx: number;
  /** CSS font-family stack for the chosen font. */
  fontFamily: string;
  /** numeric font weight. */
  fontWeight: number;
  /** CSS text-align. */
  textAlign: SlotAlign;
  /** libass alignment code for the bottom row. */
  assAlign: number;
  /** horizontal anchor as a fraction of canvas width. */
  anchorXFrac: number;
  /** "center" for text cards, "lower_third" for captions. */
  vertical: string;
  /** for captions: y position as a fraction of canvas height. */
  lowerThirdYFrac: number | null;
  /** max text width as a fraction of canvas width. */
  maxWidthFrac: number;
  /** line spacing multiplier. */
  lineSpacing: number;
  /** scale factor between preview px and canvas px. */
  scaleFactor: number;
}

/**
 * Compute caption geometry for a slot's style + kind.
 *
 * @param size  slot size token (s|m|l)
 * @param align slot alignment
 * @param font  slot font
 * @param kind  text_card (centered) vs caption (lower third)
 * @param previewWidthPx the actual rendered phone width in CSS px. The spec's
 *   sizes are calibrated to `preview_phone_width` (270px); we rescale linearly
 *   so the same numbers drive any phone size while keeping the canvas px stable.
 */
export function captionGeometry(
  size: SlotSize,
  align: SlotAlign,
  font: SlotFont,
  kind: CaptionKind,
  previewWidthPx: number = captionStyle.preview_phone_width,
): CaptionGeometry {
  const sizeSpec = captionStyle.sizes[size];
  const alignSpec = captionStyle.align_map[align];
  const scaleFactor = captionStyle.scale_factor;

  // Rescale the spec preview px to the actual phone width on screen.
  const previewScale = previewWidthPx / captionStyle.preview_phone_width;
  const fontSizePx = sizeSpec.px * previewScale;

  const layout =
    kind === "text_card"
      ? captionStyle.layout.text_card
      : captionStyle.layout.caption;

  return {
    fontSizePx,
    fontSizeCanvasPx: sizeSpec.canvas_px,
    fontFamily: FONT_STACK[font],
    fontWeight: captionStyle.fonts[font].weight,
    textAlign: alignSpec.css as SlotAlign,
    assAlign: alignSpec.ass,
    anchorXFrac: alignSpec.anchor_x_frac,
    vertical: layout.vertical,
    lowerThirdYFrac:
      kind === "caption"
        ? captionStyle.layout.caption.lower_third_y_frac
        : null,
    maxWidthFrac: layout.max_width_frac,
    lineSpacing: layout.line_spacing,
    scaleFactor,
  };
}

/** The on-screen px size at the spec's reference phone width (270px). */
export function previewPx(size: SlotSize): number {
  return captionStyle.sizes[size].px;
}

/** The render-canvas px size at full 1080 width. */
export function canvasPx(size: SlotSize): number {
  return captionStyle.sizes[size].canvas_px;
}
