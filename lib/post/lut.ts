// The LookBook. Each look has a committed .cube (baked on export via ffmpeg lut3d) and a CSS
// filter approximation for INSTANT, zero-network preview on the timeline — changing the series
// LUT restyles every clip with no API call (a demo beat). Colour grading never touches a model.

export interface Lut {
  name: string;
  label: string;
  cube: string; // public path to the .cube
  css: string; // CSS filter for preview
}

export const LUTS: Lut[] = [
  { name: 'identity', label: 'None', cube: '/luts/identity.cube', css: 'none' },
  { name: 'teal-orange', label: 'Teal / Orange', cube: '/luts/teal-orange.cube', css: 'saturate(1.2) contrast(1.05) hue-rotate(-8deg) sepia(0.15)' },
  { name: 'bleach-bypass', label: 'Bleach Bypass', cube: '/luts/bleach-bypass.cube', css: 'saturate(0.5) contrast(1.22) brightness(1.05)' },
  { name: 'warm-film', label: 'Warm Film', cube: '/luts/warm-film.cube', css: 'sepia(0.28) saturate(1.12) brightness(1.03)' },
  { name: 'cold-noir', label: 'Cold Noir', cube: '/luts/cold-noir.cube', css: 'grayscale(0.4) brightness(0.95) contrast(1.12) hue-rotate(180deg)' },
  { name: 'kodak-2383', label: 'Kodak 2383', cube: '/luts/kodak-2383.cube', css: 'contrast(1.16) saturate(1.12)' },
  { name: 'sepia', label: 'Sepia', cube: '/luts/sepia.cube', css: 'sepia(0.8) contrast(1.05)' },
  { name: 'high-key', label: 'High Key', cube: '/luts/high-key.cube', css: 'brightness(1.15) contrast(0.9)' },
];

export function lutByName(name: string): Lut {
  return LUTS.find((l) => l.name === name) ?? LUTS[0]!;
}
