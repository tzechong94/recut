// lib/compiler/camera — PURE. Derives cinematography vocabulary from typed rig state.
// The shot-size function is the one most likely to be subtly wrong, so it is grounded in
// real optics: vertical FOV from focal length + a full-frame sensor, subject angular height
// from subject height + distance, and shot size from the fraction of frame the subject fills.

import type { CameraRigState } from '../domain/types';
import type { CompiledPrompt } from '../gateway/types';

const FULL_FRAME_SENSOR_HEIGHT_MM = 24;

/** Vertical field of view in degrees for a given focal length on a full-frame sensor. */
export function verticalFovDeg(focalMm: number): number {
  return (2 * Math.atan(FULL_FRAME_SENSOR_HEIGHT_MM / (2 * focalMm)) * 180) / Math.PI;
}

/** Angular height (deg) subtended by the subject at the given distance. */
export function subjectAngularHeightDeg(subjectHeightM: number, distanceM: number): number {
  return (2 * Math.atan(subjectHeightM / (2 * distanceM)) * 180) / Math.PI;
}

/**
 * Fraction of the frame height the subject's FULL height occupies.
 *  < 1  → whole body sits inside the frame with room to spare (wide)
 *  = 1  → head-to-toe exactly fills the frame (full figure)
 *  > 1  → the frame crops the body; larger = tighter (medium → close)
 */
export function framedFraction(state: CameraRigState): number {
  return subjectAngularHeightDeg(state.subjectHeightM, state.distanceM) / verticalFovDeg(state.focalMm);
}

export type ShotSize = CompiledPrompt['camera']['shotSize'];

// Boundaries on framedFraction. Calibrated so a 50mm at ~2.2m of a 1.7m person → MS,
// an 85mm at ~1.2m → CU, a 24mm at ~8m → EWS.
export function shotSize(state: CameraRigState): ShotSize {
  const f = framedFraction(state);
  if (f < 0.25) return 'EWS';
  if (f < 0.6) return 'WS';
  if (f < 1.1) return 'MLS';
  if (f < 1.7) return 'MS';
  if (f < 2.6) return 'MCU';
  if (f < 5.0) return 'CU';
  return 'ECU';
}

export function elevationName(elevationDeg: number): CompiledPrompt['camera']['angle']['elevation'] {
  if (elevationDeg <= -10) return 'low';
  if (elevationDeg >= 55) return 'overhead';
  if (elevationDeg >= 10) return 'high';
  return 'eye';
}

export function azimuthName(azimuthDeg: number): CompiledPrompt['camera']['angle']['azimuth'] {
  const a = ((azimuthDeg % 360) + 360) % 360;
  if (a < 22.5 || a >= 337.5) return 'frontal';
  if (a < 67.5 || a >= 292.5) return 'three-quarter';
  if (a < 112.5 || a >= 247.5) return 'profile';
  if (a < 157.5 || a >= 202.5) return 'rear-three-quarter';
  return 'rear';
}

/** Lens character from focal length, with the language image models respond to. */
export function lensCharacter(focalMm: number): string {
  if (focalMm <= 24) return 'wide-angle lens with visible edge distortion';
  if (focalMm <= 35) return 'natural wide field of view';
  if (focalMm <= 55) return 'neutral perspective, no distortion';
  if (focalMm <= 100) return 'portrait compression, flattering foreshortening';
  return 'heavy telephoto compression, flattened planes';
}

export function depthOfField(state: CameraRigState): CompiledPrompt['camera']['dof'] {
  // aperture dominates; long lenses and short distances shallow it further.
  const f = state.aperture;
  if (f <= 2.0) return 'shallow';
  if (f <= 5.6) return state.focalMm >= 85 && state.distanceM <= 2 ? 'shallow' : 'medium';
  return 'deep';
}

export function deriveCamera(state: CameraRigState): CompiledPrompt['camera'] {
  return {
    shotSize: shotSize(state),
    angle: {
      elevation: elevationName(state.elevationDeg),
      azimuth: azimuthName(state.azimuthDeg),
      degrees: [state.azimuthDeg, state.elevationDeg],
    },
    lens: { focalMm: state.focalMm, aperture: state.aperture, character: lensCharacter(state.focalMm) },
    dof: depthOfField(state),
    move: state.move,
  };
}
