import type { CameraRigState, LightRigState } from './types';

// Neutral rig defaults so a shot compiles before any rig UI exists (Sprint 2 adds the UI).
export function defaultCamera(): CameraRigState {
  return {
    azimuthDeg: 0, // frontal
    elevationDeg: 0, // eye level
    distanceM: 2.2,
    rollDeg: 0,
    focalMm: 50,
    aperture: 2.8,
    subjectHeightM: 1.7,
    move: 'static',
  };
}

export function defaultLight(): LightRigState {
  return {
    lights: [
      { role: 'key', azimuthDeg: 30, elevationDeg: 25, intensity: 1, kelvin: 5600, hardness: 'soft' },
      { role: 'fill', azimuthDeg: -45, elevationDeg: 10, intensity: 0.5, kelvin: 5600, hardness: 'soft' },
    ],
  };
}
