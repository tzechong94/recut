// lib/compiler/lighting — PURE. Names the lighting setup from key geometry, derives contrast
// from the key:fill ratio, and colour temperature language from kelvin.

import type { LightRigState } from '../domain/types';
import type { CompiledPrompt } from '../gateway/types';

export type LightingSetup = CompiledPrompt['lighting']['setup'];

/** Named portrait setup from the key's azimuth (0 = camera axis) and elevation. */
export function detectSetup(keyAzimuthDeg: number, keyElevationDeg: number): LightingSetup {
  // angular deviation from the camera axis, folded to [0, 180]
  const norm = ((keyAzimuthDeg % 360) + 360) % 360;
  const a = norm > 180 ? 360 - norm : norm;
  const elev = keyElevationDeg;
  if (a < 15) return elev >= 40 ? 'butterfly' : 'broad';
  if (a < 40) return elev >= 40 ? 'rembrandt' : 'loop';
  if (a < 75) return 'rembrandt';
  if (a <= 115) return 'split';
  return 'short';
}

/** key:fill intensity ratio → mood. 1:1 flat/high-key … 8:1+ dramatic/low-key. */
export function contrastMood(ratio: number): CompiledPrompt['lighting']['mood'] {
  if (ratio < 2) return 'high-key';
  if (ratio < 4) return 'neutral';
  return 'low-key';
}

export function kelvinLanguage(kelvin: number): string {
  if (kelvin <= 3400) return 'warm tungsten';
  if (kelvin <= 5000) return 'warm white';
  if (kelvin <= 6000) return 'neutral daylight';
  return 'cool daylight';
}

export function deriveLighting(light: LightRigState): CompiledPrompt['lighting'] {
  const key = light.lights.find((l) => l.role === 'key') ?? light.lights[0];
  const fill = light.lights.find((l) => l.role === 'fill');
  const rim = light.lights.find((l) => l.role === 'rim');
  const keyIntensity = key?.intensity ?? 1;
  const fillIntensity = fill?.intensity ?? 0;
  const ratio = fillIntensity > 0 ? keyIntensity / fillIntensity : 8; // no fill = high contrast
  return {
    setup: key ? detectSetup(key.azimuthDeg, key.elevationDeg) : 'natural',
    key: {
      azimuth: key?.azimuthDeg ?? 0,
      elevation: key?.elevationDeg ?? 20,
      hardness: key?.hardness ?? 'soft',
      kelvin: key?.kelvin ?? 5600,
    },
    ...(fill ? { fill: { ratio: Number(ratio.toFixed(2)) } } : {}),
    ...(rim ? { rim: { azimuth: rim.azimuthDeg, kelvin: rim.kelvin } } : {}),
    mood: contrastMood(ratio),
  };
}
