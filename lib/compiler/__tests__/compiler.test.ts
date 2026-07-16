import { describe, it, expect } from 'vitest';
import type { CameraRigState, LightRigState, Shot, SeriesBible } from '../../domain/types';
import { compile } from '../compile';
import { deriveCamera, shotSize, elevationName, azimuthName, lensCharacter } from '../camera';
import { deriveLighting, detectSetup, contrastMood, kelvinLanguage } from '../lighting';
import { lensDescriptor, isAnamorphic, DEFAULT_LENS_PRESET } from '../lens';

function cam(partial: Partial<CameraRigState> = {}): CameraRigState {
  return {
    azimuthDeg: 0,
    elevationDeg: 0,
    distanceM: 2.2,
    rollDeg: 0,
    focalMm: 50,
    aperture: 2.8,
    subjectHeightM: 1.7,
    move: 'static',
    ...partial,
  };
}

describe('shot size — every boundary via vertical-FOV coverage', () => {
  const cases: Array<[string, Partial<CameraRigState>, string]> = [
    ['EWS', { focalMm: 24, distanceM: 12 }, 'EWS'],
    ['WS', { focalMm: 35, distanceM: 6 }, 'WS'],
    ['MLS', { focalMm: 50, distanceM: 4 }, 'MLS'],
    ['MS', { focalMm: 50, distanceM: 2.2 }, 'MS'],
    ['MCU', { focalMm: 85, distanceM: 2.5 }, 'MCU'],
    ['CU', { focalMm: 85, distanceM: 1.6 }, 'CU'],
    ['ECU', { focalMm: 135, distanceM: 1.2 }, 'ECU'],
  ];
  for (const [name, state, expected] of cases) {
    it(`${name} → ${expected}`, () => expect(shotSize(cam(state))).toBe(expected));
  }
});

describe('angle buckets', () => {
  it('elevation low/eye/high/overhead', () => {
    expect(elevationName(-20)).toBe('low');
    expect(elevationName(0)).toBe('eye');
    expect(elevationName(20)).toBe('high');
    expect(elevationName(60)).toBe('overhead');
  });
  it('azimuth frontal/three-quarter/profile/rear-three-quarter/rear', () => {
    expect(azimuthName(0)).toBe('frontal');
    expect(azimuthName(45)).toBe('three-quarter');
    expect(azimuthName(90)).toBe('profile');
    expect(azimuthName(135)).toBe('rear-three-quarter');
    expect(azimuthName(180)).toBe('rear');
  });
});

describe('lens character', () => {
  it('buckets by focal length', () => {
    expect(lensCharacter(18)).toContain('wide-angle');
    expect(lensCharacter(35)).toContain('natural');
    expect(lensCharacter(50)).toContain('neutral');
    expect(lensCharacter(85)).toContain('portrait');
    expect(lensCharacter(135)).toContain('telephoto');
  });
});

describe('lighting — every named setup', () => {
  const cases: Array<[string, number, number, string]> = [
    ['butterfly', 0, 45, 'butterfly'],
    ['broad', 0, 20, 'broad'],
    ['loop', 25, 20, 'loop'],
    ['rembrandt (off-axis high)', 25, 45, 'rembrandt'],
    ['rembrandt (45 off-axis)', 55, 30, 'rembrandt'],
    ['split', 90, 15, 'split'],
    ['short', 130, 20, 'short'],
  ];
  for (const [name, az, elev, expected] of cases) {
    it(`${name} → ${expected}`, () => expect(detectSetup(az, elev)).toBe(expected));
  }
});

describe('lighting — contrast + colour', () => {
  it('key:fill ratio → mood', () => {
    expect(contrastMood(1)).toBe('high-key');
    expect(contrastMood(3)).toBe('neutral');
    expect(contrastMood(8)).toBe('low-key');
  });
  it('kelvin → colour language', () => {
    expect(kelvinLanguage(3200)).toContain('tungsten');
    expect(kelvinLanguage(5600)).toContain('daylight');
    expect(kelvinLanguage(7000)).toContain('cool');
  });
});

describe('lens preset table', () => {
  it('descriptor concatenates body/family/stock', () => {
    const d = lensDescriptor({ body: 'ARRI ALEXA 35', family: 'anamorphic', stock: 'Kodak 2383' });
    expect(d).toContain('ALEXA 35');
    expect(d).toContain('anamorphic');
    expect(d).toContain('2383');
  });
  it('detects anamorphic', () => {
    expect(isAnamorphic({ body: 'Sony VENICE', family: 'anamorphic', stock: 'Fuji 3510' })).toBe(true);
    expect(isAnamorphic(DEFAULT_LENS_PRESET)).toBe(false);
  });
});

describe('determinism + golden shape', () => {
  it('deriveCamera is byte-deterministic', () => {
    expect(JSON.stringify(deriveCamera(cam()))).toBe(JSON.stringify(deriveCamera(cam())));
  });
  it('golden: default rig camera', () => {
    expect(deriveCamera(cam({ focalMm: 85, distanceM: 1.6, aperture: 1.8, elevationDeg: -20, azimuthDeg: 45 }))).toEqual({
      shotSize: 'CU',
      angle: { elevation: 'low', azimuth: 'three-quarter', degrees: [45, -20] },
      lens: { focalMm: 85, aperture: 1.8, character: 'portrait compression, flattering foreshortening' },
      dof: 'shallow',
      move: 'static',
    });
  });
  it('golden: rembrandt key + fill', () => {
    const light: LightRigState = {
      lights: [
        { role: 'key', azimuthDeg: 45, elevationDeg: 45, intensity: 1, kelvin: 3200, hardness: 'hard' },
        { role: 'fill', azimuthDeg: -30, elevationDeg: 10, intensity: 0.2, kelvin: 5600, hardness: 'soft' },
      ],
    };
    expect(deriveLighting(light)).toEqual({
      setup: 'rembrandt',
      key: { azimuth: 45, elevation: 45, hardness: 'hard', kelvin: 3200 },
      fill: { ratio: 5 },
      mood: 'low-key',
    });
  });
});

describe('style prefix merge (spec Stage 2)', () => {
  const lig = (): LightRigState => ({ lights: [{ role: 'key', azimuthDeg: 30, elevationDeg: 25, intensity: 1, kelvin: 5600, hardness: 'soft' }] });
  const demoShot = (): Shot => ({ id: 's1', sceneId: 'sc1', action: 'the hero sits', entityIds: [], camera: cam(), light: lig(), takeIds: [] });
  const demoBible = (): SeriesBible => ({ version: 1, entities: [] });
  const base = () => ({ shot: demoShot(), bible: demoBible() });
  it('project stylePrefix is glued in front of the shot style', () => {
    const p = compile({ ...base(), stylePrefix: 'bright commercial daylight', style: '35mm grain' });
    expect(p.style).toBe('bright commercial daylight, 35mm grain');
  });
  it('scene override REPLACES the project prefix, not appends', () => {
    const p = compile({ ...base(), stylePrefix: 'bright commercial daylight', styleOverride: 'harsh midday sun', style: '35mm grain' });
    expect(p.style).toBe('harsh midday sun, 35mm grain');
    expect(p.style).not.toContain('bright commercial');
  });
  it('no prefix, no style falls back to the historical default (golden tests unchanged)', () => {
    const p = compile(base());
    expect(p.style).toBe('photorealistic cinematic still');
  });
  it('merge is deterministic', () => {
    const a = compile({ ...base(), stylePrefix: 'x', style: 'y' });
    const b = compile({ ...base(), stylePrefix: 'x', style: 'y' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
