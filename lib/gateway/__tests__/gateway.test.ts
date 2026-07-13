import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { selectModel } from '../router';
import { MANIFESTS } from '../../../manifests/index';
import { EXAMPLE_KLING } from '../../../manifests/_example-kling';
import type { CompiledPrompt } from '../types';
import { featherComposite, crop, padBBox, type RgbaImage, type BBox } from '../../../polyfills/inpaint';
import { expandCanvas } from '../../../polyfills/outpaint';

describe('abstraction proof: Kling stub', () => {
  it('routes to a brand-new provider with zero changes outside its manifest + serializer', () => {
    // kling is not in the default registry (disabled). Adding it to a pool is enough.
    const pool = [...MANIFESTS, EXAMPLE_KLING];
    const picked = selectModel('video.t2v', 'quality', {}, pool);
    expect(picked.id).toBe('kling-v1');
    expect(picked.provider).toBe('kling');
    // its serializer produces a provider payload from a CompiledPrompt with no special-casing
    const cp = { negative: 'x', seed: 5, camera: { shotSize: 'MS', angle: { azimuth: 'frontal', elevation: 'eye' }, lens: { focalMm: 50, aperture: 2.8, character: 'neutral' }, dof: 'medium' }, lighting: { setup: 'natural', key: { kelvin: 5600, hardness: 'soft' }, mood: 'neutral' }, subject: { description: '' }, action: '', style: 's' } as unknown as CompiledPrompt;
    expect(picked.serializer(cp)).toHaveProperty('prompt');
  });

  it('the default registry does NOT include the disabled stub', () => {
    expect(MANIFESTS.find((m) => m.id === 'kling-v1')).toBeUndefined();
  });
});

describe('model-ids live only in manifests/', () => {
  const MODEL_ID = /\b(qwen-image-edit|qwen-image-plus|qwen3-vl-plus|qwen-plus|wan[\d.]+[a-z-]*|kling-v\d)\b/;
  const PRODUCT_DIRS = ['lib', 'app', 'components', 'serializers', 'adapters'];

  function walk(dir: string): string[] {
    const abs = resolve(dir);
    let out: string[] = [];
    for (const name of readdirSync(abs)) {
      const p = join(abs, name);
      if (statSync(p).isDirectory()) {
        if (name === '__tests__' || name === 'node_modules') continue;
        out = out.concat(walk(join(dir, name)));
      } else if (/\.(ts|tsx)$/.test(name)) {
        out.push(p);
      }
    }
    return out;
  }

  it('no model-id string appears in product code outside manifests/', () => {
    const offenders: string[] = [];
    for (const dir of PRODUCT_DIRS) {
      for (const file of walk(dir)) {
        // strip line comments so doc references to ids in comments don't count
        const code = readFileSync(file, 'utf8')
          .split('\n')
          .map((l) => l.replace(/\/\/.*$/, ''))
          .join('\n');
        if (MODEL_ID.test(code)) offenders.push(file.replace(resolve('.') + '/', ''));
      }
    }
    expect(offenders, `model-ids leaked outside manifests/: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('inpaint polyfill — outside-mask pixels bit-identical', () => {
  function solid(w: number, h: number, rgba: [number, number, number, number]): RgbaImage {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
    return { width: w, height: h, data };
  }

  it('featherComposite leaves every pixel outside the bbox byte-identical to base', () => {
    const base = solid(20, 20, [10, 20, 30, 255]);
    const bbox: BBox = { x: 6, y: 6, w: 8, h: 8 };
    const patch = solid(8, 8, [200, 100, 50, 255]);
    const out = featherComposite(base, patch, bbox, 2);

    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const inside = x >= bbox.x && x < bbox.x + bbox.w && y >= bbox.y && y < bbox.y + bbox.h;
        const i = (y * 20 + x) * 4;
        if (!inside) {
          expect([out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]]).toEqual([10, 20, 30, 255]);
        }
      }
    }
    // hard core (center, past the feather) equals the patch
    const ci = ((bbox.y + 4) * 20 + (bbox.x + 4)) * 4;
    expect([out.data[ci], out.data[ci + 1], out.data[ci + 2]]).toEqual([200, 100, 50]);
  });

  it('padBBox + crop stay in bounds', () => {
    const padded = padBBox({ x: 5, y: 5, w: 4, h: 4 }, 0.25, 20, 20);
    expect(padded.x).toBeGreaterThanOrEqual(0);
    expect(padded.x + padded.w).toBeLessThanOrEqual(20);
    const c = crop(solid(20, 20, [1, 2, 3, 255]), padded);
    expect(c.width).toBe(padded.w);
    expect(c.data.length).toBe(padded.w * padded.h * 4);
  });
});

describe('outpaint polyfill — expandCanvas', () => {
  it('preserves the original block and greys the new border', () => {
    const img: RgbaImage = { width: 2, height: 2, data: new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255]) };
    const out = expandCanvas(img, { top: 1, right: 1, bottom: 1, left: 1 });
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    // corner (0,0) is grey
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([128, 128, 128]);
    // original top-left pixel now at (1,1)
    const i = (1 * 4 + 1) * 4;
    expect([out.data[i], out.data[i + 1], out.data[i + 2]]).toEqual([1, 1, 1]);
  });
});
