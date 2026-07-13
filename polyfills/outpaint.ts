// Outpaint polyfill: expand the canvas, neutral-grey fill the new border, instruction-edit
// ("extend the scene naturally into the grey borders, matching lighting and perspective"),
// then recrop to the target. The original pixels sit unchanged inside the expanded canvas.

import type { RgbaImage } from './inpaint';

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const NEUTRAL_GREY: [number, number, number, number] = [128, 128, 128, 255];

/** Place `img` on a larger neutral-grey canvas grown by `margins`. Original pixels preserved. */
export function expandCanvas(img: RgbaImage, margins: Margins): RgbaImage {
  const width = img.width + margins.left + margins.right;
  const height = img.height + margins.top + margins.bottom;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = NEUTRAL_GREY[0];
    data[i * 4 + 1] = NEUTRAL_GREY[1];
    data[i * 4 + 2] = NEUTRAL_GREY[2];
    data[i * 4 + 3] = NEUTRAL_GREY[3];
  }
  for (let row = 0; row < img.height; row++) {
    const srcStart = row * img.width * 4;
    const dstStart = ((row + margins.top) * width + margins.left) * 4;
    data.set(img.data.subarray(srcStart, srcStart + img.width * 4), dstStart);
  }
  return { width, height, data };
}

export const OUTPAINT_INSTRUCTION =
  'Extend the scene naturally into the grey border regions, matching the existing lighting, ' +
  'perspective, colour, and content. Do not alter the original central image.';

/** Async orchestrator: expand→edit→(caller recrops as needed). */
export async function outpaint(
  img: RgbaImage,
  margins: Margins,
  editFn: (expanded: RgbaImage, instruction: string) => Promise<RgbaImage>,
): Promise<RgbaImage> {
  const expanded = expandCanvas(img, margins);
  return editFn(expanded, OUTPAINT_INSTRUCTION);
}
