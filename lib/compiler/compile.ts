// lib/compiler — PURE. No network, no React, no I/O, no imports from app/ or components/.
// Sprint 1 is deliberately crude: it produces a VALID CompiledPrompt so the seams hold.
// Sprint 2 replaces the interim mappings below with real cinematography math
// (camera.ts / lighting.ts / lens.ts) behind the same CompiledPrompt shape.

import type { CameraRigState, LightRigState, SeriesBible, Shot } from '../domain/types.js';
import type { CompiledPrompt } from '../gateway/types.js';
import { injectRefs, subjectDescription } from '../bible/inject.js';

function shotSizeFromDistance(distanceM: number): CompiledPrompt['camera']['shotSize'] {
  // interim: distance buckets. Sprint 2 does vertical-FOV coverage from focal+subject height.
  if (distanceM < 0.8) return 'ECU';
  if (distanceM < 1.4) return 'CU';
  if (distanceM < 2.0) return 'MCU';
  if (distanceM < 3.0) return 'MS';
  if (distanceM < 5.0) return 'MLS';
  if (distanceM < 9.0) return 'WS';
  return 'EWS';
}

function elevationName(deg: number): CompiledPrompt['camera']['angle']['elevation'] {
  if (deg <= -10) return 'low';
  if (deg >= 55) return 'overhead';
  if (deg >= 10) return 'high';
  return 'eye';
}

function azimuthName(deg: number): CompiledPrompt['camera']['angle']['azimuth'] {
  const a = ((deg % 360) + 360) % 360;
  if (a < 22.5 || a >= 337.5) return 'frontal';
  if (a < 67.5 || a >= 292.5) return 'three-quarter';
  if (a < 112.5 || a >= 247.5) return 'profile';
  if (a < 157.5 || a >= 202.5) return 'rear-three-quarter';
  return 'rear';
}

function lensCharacter(focalMm: number): string {
  if (focalMm <= 24) return 'wide-angle with edge distortion';
  if (focalMm <= 35) return 'natural field of view';
  if (focalMm <= 55) return 'neutral perspective';
  if (focalMm <= 100) return 'portrait compression';
  return 'heavy telephoto compression';
}

function dofFromAperture(aperture: number): CompiledPrompt['camera']['dof'] {
  if (aperture <= 2.0) return 'shallow';
  if (aperture <= 5.6) return 'medium';
  return 'deep';
}

function lighting(light: LightRigState): CompiledPrompt['lighting'] {
  const key = light.lights.find((l) => l.role === 'key') ?? light.lights[0];
  const fill = light.lights.find((l) => l.role === 'fill');
  const rim = light.lights.find((l) => l.role === 'rim');
  const keyK = key?.kelvin ?? 5600;
  return {
    setup: 'natural', // Sprint 2: detect rembrandt/split/butterfly/loop/broad/short from geometry
    key: {
      azimuth: key?.azimuthDeg ?? 30,
      elevation: key?.elevationDeg ?? 25,
      hardness: key?.hardness ?? 'soft',
      kelvin: keyK,
    },
    ...(fill ? { fill: { ratio: (key?.intensity ?? 1) / Math.max(0.01, fill.intensity) } } : {}),
    ...(rim ? { rim: { azimuth: rim.azimuthDeg, kelvin: rim.kelvin } } : {}),
    mood: 'neutral',
  };
}

export interface CompileInput {
  shot: Shot;
  bible: SeriesBible;
  camera?: CameraRigState;
  light?: LightRigState;
  style?: string;
  palette?: CompiledPrompt['palette'];
  seed?: number;
}

/** Deterministic: identical input → byte-identical CompiledPrompt (asserted in a test). */
export function compile(input: CompileInput): CompiledPrompt {
  const camera = input.camera ?? input.shot.camera;
  const light = input.light ?? input.shot.light;
  return {
    subject: {
      entityIds: [...input.shot.entityIds],
      description: subjectDescription(input.shot, input.bible),
    },
    action: input.shot.action,
    camera: {
      shotSize: shotSizeFromDistance(camera.distanceM),
      angle: {
        elevation: elevationName(camera.elevationDeg),
        azimuth: azimuthName(camera.azimuthDeg),
        degrees: [camera.azimuthDeg, camera.elevationDeg],
      },
      lens: { focalMm: camera.focalMm, aperture: camera.aperture, character: lensCharacter(camera.focalMm) },
      dof: dofFromAperture(camera.aperture),
      move: camera.move,
    },
    lighting: lighting(light),
    palette: input.palette ?? { name: 'neutral', hexes: ['#1a1a1a', '#8a8a8a', '#e7e7e7'] },
    style: input.style ?? 'photorealistic cinematic still',
    negative: 'lowres, deformed, extra fingers, watermark, text',
    refs: injectRefs(input.shot, input.bible),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
}
