// Pure: CompiledPrompt → DashScope (Wan/Qwen) request dialect. No network here.
// The adapter wraps this with the model id + endpoint; the serialized output is also the
// cache-key material, so it must be deterministic.

import type { CompiledPrompt, ProviderPayload } from '../lib/gateway/types';

const SHOT_SIZE_WORDS: Record<CompiledPrompt['camera']['shotSize'], string> = {
  ECU: 'extreme close-up',
  CU: 'close-up',
  MCU: 'medium close-up',
  MS: 'medium shot',
  MLS: 'medium long shot',
  WS: 'wide shot',
  EWS: 'extreme wide shot',
};

const AZIMUTH_WORDS: Record<CompiledPrompt['camera']['angle']['azimuth'], string> = {
  frontal: 'frontal view',
  'three-quarter': 'three-quarter view',
  profile: 'profile view',
  'rear-three-quarter': 'rear three-quarter view',
  rear: 'rear view',
};

const ELEVATION_WORDS: Record<CompiledPrompt['camera']['angle']['elevation'], string> = {
  low: 'low angle',
  eye: 'eye level',
  high: 'high angle',
  overhead: 'overhead angle',
};

/** The comma-delimited cinematography sentence: shot size, angle, lens, light, then subject. */
export function promptSentence(p: CompiledPrompt): string {
  const cam = p.camera;
  const clauses: string[] = [
    SHOT_SIZE_WORDS[cam.shotSize],
    AZIMUTH_WORDS[cam.angle.azimuth],
    ELEVATION_WORDS[cam.angle.elevation],
    `${cam.lens.focalMm}mm lens, ${cam.lens.character}`,
    `${cam.dof} depth of field at f/${cam.lens.aperture}`,
    `${p.lighting.setup} lighting, ${p.lighting.key.kelvin}K, ${p.lighting.key.hardness} key`,
    p.lighting.mood !== 'neutral' ? p.lighting.mood : '',
    cam.move && cam.move !== 'static' ? `${cam.move} camera move` : '',
  ].filter(Boolean);
  const subject = p.subject.description ? `${p.subject.description}. ` : '';
  const action = p.action ? `${p.action}. ` : '';
  return `${subject}${action}${clauses.join(', ')}. ${p.style}.`;
}

/** image.edit: refs as image parts + an instruction that changes only framing/angle. */
export function serializeImageEdit(p: CompiledPrompt): ProviderPayload {
  const instruction =
    `Re-render the SAME subject from the reference image(s) with identical identity, wardrobe, ` +
    `and colours. Change only the camera framing and lighting to: ${promptSentence(p)} ` +
    `Avoid: ${p.negative}.`;
  const content = [
    ...p.refs.slice(0, 3).map((r) => ({ image: r.url })),
    { text: instruction },
  ];
  return { messages: [{ role: 'user', content }] };
}

/** image.generate: text-to-image, no refs. */
export function serializeImageGenerate(p: CompiledPrompt): ProviderPayload {
  return { messages: [{ role: 'user', content: [{ text: `${promptSentence(p)} Avoid: ${p.negative}.` }] }] };
}
