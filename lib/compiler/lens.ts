// lib/compiler/lens — PURE. Body × lens-family × stock preset table, set at series level and
// overridable per shot. Anamorphic contributes an aspect hint. Feeds the style string.

export type CameraBody = 'ARRI ALEXA 35' | 'Sony VENICE' | 'RED Komodo' | 'Bolex 16mm' | 'iPhone';
export type LensFamily = 'spherical' | 'anamorphic' | 'vintage' | 'macro';
export type FilmStock = 'Kodak 2383' | 'Fuji 3510' | 'Ektachrome' | 'digital clean';

export interface LensPreset {
  body: CameraBody;
  family: LensFamily;
  stock: FilmStock;
}

const BODY_LOOK: Record<CameraBody, string> = {
  'ARRI ALEXA 35': 'ARRI ALEXA 35 sensor, high dynamic range, filmic highlight rolloff',
  'Sony VENICE': 'Sony VENICE full-frame, clean shadows, wide latitude',
  'RED Komodo': 'RED Komodo, crisp digital detail',
  'Bolex 16mm': '16mm Bolex, heavy grain, gate weave, vignetting',
  iPhone: 'smartphone capture, deep depth of field, computational HDR',
};

const FAMILY_LOOK: Record<LensFamily, string> = {
  spherical: 'spherical lens rendering',
  anamorphic: 'anamorphic lens, oval bokeh, horizontal blue flares',
  vintage: 'vintage uncoated glass, low contrast, gentle halation',
  macro: 'macro optics, extreme close focus',
};

const STOCK_LOOK: Record<FilmStock, string> = {
  'Kodak 2383': 'Kodak 2383 print emulation, rich saturated contrast',
  'Fuji 3510': 'Fuji 3510, cooler greens, soft contrast',
  Ektachrome: 'Ektachrome reversal, punchy saturation, cyan shadows',
  'digital clean': 'clean digital grade',
};

export function isAnamorphic(preset: LensPreset): boolean {
  return preset.family === 'anamorphic';
}

/** Comma-delimited look descriptor for the style string. */
export function lensDescriptor(preset: LensPreset): string {
  return [BODY_LOOK[preset.body], FAMILY_LOOK[preset.family], STOCK_LOOK[preset.stock]].join(', ');
}

export const DEFAULT_LENS_PRESET: LensPreset = {
  body: 'ARRI ALEXA 35',
  family: 'spherical',
  stock: 'Kodak 2383',
};
