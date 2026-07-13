// Qwen has no mask-inpaint image API. Polyfill: crop the mask bbox with ~25% context
// padding, instruction-edit the crop (via any image.edit model), then feather-composite it
// back. Pixels OUTSIDE the feathered region must be bit-identical to the input — this is the
// invariant the gateway guarantees and a test asserts.

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // length = width*height*4
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clone(img: RgbaImage): RgbaImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

/** Expand a bbox by `frac` on each side (context padding), clamped to image bounds. */
export function padBBox(bbox: BBox, frac: number, width: number, height: number): BBox {
  const px = Math.round(bbox.w * frac);
  const py = Math.round(bbox.h * frac);
  const x = Math.max(0, bbox.x - px);
  const y = Math.max(0, bbox.y - py);
  const w = Math.min(width - x, bbox.w + 2 * px);
  const h = Math.min(height - y, bbox.h + 2 * py);
  return { x, y, w, h };
}

export function crop(img: RgbaImage, bbox: BBox): RgbaImage {
  const out = new Uint8ClampedArray(bbox.w * bbox.h * 4);
  for (let row = 0; row < bbox.h; row++) {
    const srcStart = ((bbox.y + row) * img.width + bbox.x) * 4;
    const dstStart = row * bbox.w * 4;
    out.set(img.data.subarray(srcStart, srcStart + bbox.w * 4), dstStart);
  }
  return { width: bbox.w, height: bbox.h, data: out };
}

/**
 * Composite `patch` (same size as bbox) back into a copy of `base` at bbox, blending with a
 * `feather`-px linear ramp INSIDE the bbox edges. Everything outside the bbox is copied
 * byte-for-byte from base (never touched). Returns a new image.
 */
export function featherComposite(base: RgbaImage, patch: RgbaImage, bbox: BBox, feather: number): RgbaImage {
  if (patch.width !== bbox.w || patch.height !== bbox.h) {
    throw new Error(`patch ${patch.width}x${patch.height} does not match bbox ${bbox.w}x${bbox.h}`);
  }
  const out = clone(base); // outside-bbox pixels are now bit-identical to base by construction
  for (let row = 0; row < bbox.h; row++) {
    for (let col = 0; col < bbox.w; col++) {
      // feather weight: 0 at the very edge → 1 at `feather` px inside (hard core = 1)
      const edgeDist = Math.min(col, row, bbox.w - 1 - col, bbox.h - 1 - row);
      const w = feather <= 0 ? 1 : Math.min(1, edgeDist / feather);
      const bx = bbox.x + col;
      const by = bbox.y + row;
      const di = (by * base.width + bx) * 4;
      const pi = (row * bbox.w + col) * 4;
      for (let c = 0; c < 4; c++) {
        out.data[di + c] = Math.round(base.data[di + c]! * (1 - w) + patch.data[pi + c]! * w);
      }
    }
  }
  return out;
}

/** Async orchestrator: crop→edit→composite. editFn is any image.edit call over the crop. */
export async function inpaint(
  base: RgbaImage,
  maskBBox: BBox,
  editFn: (cropped: RgbaImage) => Promise<RgbaImage>,
  opts: { contextFrac?: number; feather?: number } = {},
): Promise<RgbaImage> {
  const padded = padBBox(maskBBox, opts.contextFrac ?? 0.25, base.width, base.height);
  const cropped = crop(base, padded);
  const edited = await editFn(cropped);
  return featherComposite(base, edited, padded, opts.feather ?? 8);
}
