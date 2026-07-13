// Generates the LookBook's .cube LUTs (17^3) into public/luts/. Analytic looks — committed,
// applied on export via ffmpeg lut3d. Run once: tsx scripts/gen-luts.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

type RGB = [number, number, number];
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const LOOKS: Record<string, (r: number, g: number, b: number) => RGB> = {
  identity: (r, g, b) => [r, g, b],
  'teal-orange': (r, g, b) => {
    const l = lum(r, g, b);
    // shadows toward teal, highlights toward orange
    return [clamp(r + (l - 0.5) * 0.18), clamp(g + (0.5 - Math.abs(l - 0.5)) * 0.04), clamp(b + (0.5 - l) * 0.18)];
  },
  'bleach-bypass': (r, g, b) => {
    const l = lum(r, g, b);
    const s = 0.4; // desaturate
    return [clamp(lerp(l, r, s) * 1.15 - 0.05), clamp(lerp(l, g, s) * 1.15 - 0.05), clamp(lerp(l, b, s) * 1.15 - 0.05)];
  },
  'warm-film': (r, g, b) => [clamp(r * 1.06 + 0.02), clamp(g * 1.01), clamp(b * 0.92)],
  'cold-noir': (r, g, b) => {
    const l = lum(r, g, b);
    return [clamp(lerp(l, r, 0.5) * 0.95), clamp(lerp(l, g, 0.5) * 0.98), clamp(lerp(l, b, 0.5) * 1.08 + 0.02)];
  },
  'kodak-2383': (r, g, b) => [clamp((r - 0.5) * 1.15 + 0.5 + 0.02), clamp((g - 0.5) * 1.12 + 0.5), clamp((b - 0.5) * 1.12 + 0.5 - 0.02)],
  sepia: (r, g, b) => {
    const l = lum(r, g, b);
    return [clamp(l * 1.07 + 0.05), clamp(l * 0.9), clamp(l * 0.7)];
  },
  'high-key': (r, g, b) => [clamp(r * 0.85 + 0.15), clamp(g * 0.85 + 0.15), clamp(b * 0.85 + 0.15)],
};

function cube(name: string, fn: (r: number, g: number, b: number) => RGB): string {
  const N = 17;
  const lines = [`# Recut LookBook — ${name}`, `LUT_3D_SIZE ${N}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1', ''];
  for (let bi = 0; bi < N; bi++)
    for (let gi = 0; gi < N; gi++)
      for (let ri = 0; ri < N; ri++) {
        const [r, g, b] = fn(ri / (N - 1), gi / (N - 1), bi / (N - 1));
        lines.push(`${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
      }
  return lines.join('\n') + '\n';
}

const dir = resolve('public/luts');
mkdirSync(dir, { recursive: true });
for (const [name, fn] of Object.entries(LOOKS)) {
  writeFileSync(resolve(dir, `${name}.cube`), cube(name, fn));
  console.log(`wrote public/luts/${name}.cube`);
}
console.log(`${Object.keys(LOOKS).length} LUTs written.`);
