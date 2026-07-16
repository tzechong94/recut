// lib/compiler — PURE. No network, no React, no I/O, no imports from app/ or components/.
// compile() assembles a CompiledPrompt from typed rig state via the camera/lighting/lens
// modules. Identical input → byte-identical output (asserted).

import type { CameraRigState, LightRigState, SeriesBible, Shot } from '../domain/types';
import type { CompiledPrompt } from '../gateway/types';
import { injectRefs, subjectDescription } from '../bible/inject';
import { deriveCamera } from './camera';
import { deriveLighting } from './lighting';
import { lensDescriptor, type LensPreset } from './lens';

export interface CompileInput {
  shot: Shot;
  bible: SeriesBible;
  camera?: CameraRigState;
  light?: LightRigState;
  lens?: LensPreset;
  style?: string;
  /** global Style Prefix (project-level default, spec Stage 2) */
  stylePrefix?: string;
  /** scoped scene override: replaces stylePrefix for this compile only (spec Stage 2) */
  styleOverride?: string;
  palette?: CompiledPrompt['palette'];
  seed?: number;
}

export function compile(input: CompileInput): CompiledPrompt {
  const cameraState = input.camera ?? input.shot.camera;
  const lightState = input.light ?? input.shot.light;
  const camera = deriveCamera(cameraState);
  if (input.lens) camera.lens = { ...camera.lens, body: input.lens.body };

  // Merge order (spec Stage 2): scene override REPLACES the project prefix; the per-shot
  // style refines whichever won; the lens descriptor is appended last.
  const prefix = input.styleOverride?.trim() || input.stylePrefix?.trim() || '';
  const shotStyle = input.style ?? (prefix ? '' : 'photorealistic cinematic still');
  const merged = [prefix, shotStyle].filter(Boolean).join(', ');
  const style = input.lens ? `${merged}, ${lensDescriptor(input.lens)}` : merged;

  return {
    subject: {
      entityIds: [...input.shot.entityIds],
      description: subjectDescription(input.shot, input.bible),
    },
    action: input.shot.action,
    camera,
    lighting: deriveLighting(lightState),
    palette: input.palette ?? { name: 'neutral', hexes: ['#1a1a1a', '#8a8a8a', '#e7e7e7'] },
    style,
    negative: 'lowres, deformed, extra fingers, watermark, text',
    refs: injectRefs(input.shot, input.bible),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  };
}
