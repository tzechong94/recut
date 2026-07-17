// The showrunner planner: a premise/beat sheet → a structured shotlist. Directing discipline
// follows docs/skills/seedance-shotlist-director.md: character anchors with state carry-forward,
// geo-spatial scene blocking, motivated camera, concrete acting beats, one beat per prompt.
// qwen-max returns strict JSON which build code maps onto the pipeline document.

export interface PlannedShot {
  description: string;
  characters: string[];
  animate: boolean;
  dialogue?: string;
  // camera hints constrained to the wizard's preset vocabulary (dropdowns arrive pre-set)
  shotSize?: string;
  angle?: string;
  lens?: string;
  light?: string;
}

export interface StoryPlan {
  title: string;
  style: string;
  characters: { name: string; description: string }[];
  shots: PlannedShot[];
}

// Preset vocabulary shared with the Scenes UI. The planner must pick from these exact strings
// (or omit) so its choices land directly in the per-cut dropdowns.
export const SHOT_SIZES = ['extreme close-up', 'close-up', 'medium close-up', 'medium shot', 'wide shot', 'extreme wide shot'];
export const ANGLES = ['low angle', 'eye level', 'high angle', 'overhead', 'three-quarter view', 'profile view'];
export const LENSES = ['24mm wide-angle lens', '35mm lens', '50mm lens', '85mm portrait lens', '135mm telephoto lens'];
export const LIGHTS = ['Rembrandt lighting', 'split lighting', 'butterfly lighting', 'loop lighting', 'high-key soft light', 'low-key dramatic light', 'natural window light', 'golden hour'];

export function planSystem(): string {
  return (
    'You are a top-tier film director and cinematographer (the seedance-shotlist-director discipline). ' +
    'Given a premise or beat sheet, DIRECT it, do not transcribe it. The craft:\n' +
    '- ONE consistent visual style for the whole film (medium, palette, lighting mood). This becomes the global Style Prefix.\n' +
    '- Cast 1-3 characters, each with a vivid, specific visual anchor (age, hair, wardrobe, one distinguishing detail). ' +
    'Carry state forward between shots: wet stays wet, mud stays mud, the same scar, the same jacket.\n' +
    '- 3-6 shots, one dramatic beat each, each written to fill a 5-10 second clip. Every description must contain: ' +
    'geo-spatial blocking (where each character is relative to the space and to each other), one concrete acting beat ' +
    '(never "she is sad"; write "her eyes drop to the table, jaw tightens, she swallows once before answering"), and a ' +
    'motivated camera move from frame one. Restraint by default; big emotion only when the moment earns it.\n' +
    '- Per shot, choose camera presets from EXACTLY these lists (or omit the field):\n' +
    `  shotSize: ${SHOT_SIZES.join(' | ')}\n` +
    `  angle: ${ANGLES.join(' | ')}\n` +
    `  lens: ${LENSES.join(' | ')}\n` +
    `  light: ${LIGHTS.join(' | ')}\n` +
    '- Optional spoken line per shot (dialogue), only when the beat earns it. English only.\n' +
    'RESPECT THE AUTHOR. If the input is already a written script (named characters, style/setting/lighting ' +
    'blocks, scene descriptions): keep every character name EXACTLY as written, never invent or rename ' +
    'characters; if a registered cast list is provided, the characters arrays MUST use those exact registry ' +
    'names; if the input has an explicit style/setting/lighting/color/camera/motion/audio/technical block, ' +
    'return it VERBATIM (concatenated, unparaphrased) as the style field; adapt the author\'s scenes instead ' +
    'of inventing new ones, adding camera, blocking, and acting detail ONLY where the script is silent.\n' +
    'Return STRICT JSON only, no prose:\n' +
    '{"title": str, "style": str, "characters": [{"name": str, "description": str}], ' +
    '"shots": [{"description": str, "characters": [str], "animate": bool, "dialogue": str|null, ' +
    '"shotSize": str|null, "angle": str|null, "lens": str|null, "light": str|null}]}'
  );
}

export interface CastEntry {
  slug: string;
  kind: string;
}

export function planUser(premise: string, cast: CastEntry[] = []): string {
  const castBlock = cast.length
    ? `Registered cast (use these EXACT names in every shot's characters array; do not rename or invent):\n${cast
        .map((c) => `- ${c.slug} (${c.kind})`)
        .join('\n')}\n\n`
    : '';
  return `${castBlock}Script:\n${premise}\n\nDirect it. Return the JSON plan.`;
}

function pickPreset(value: unknown, vocab: string[]): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const v = value.trim().toLowerCase();
  return vocab.find((x) => x.toLowerCase() === v) ?? vocab.find((x) => x.toLowerCase().includes(v) || v.includes(x.toLowerCase()));
}

export function parsePlan(text: string): StoryPlan {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('planner returned no JSON');
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<StoryPlan>;
  const characters = Array.isArray(raw.characters)
    ? raw.characters.filter((c) => c && typeof c.name === 'string').map((c) => ({ name: String(c.name), description: String(c.description ?? '') }))
    : [];
  const shots = Array.isArray(raw.shots)
    ? raw.shots
        .filter((s) => s && typeof s.description === 'string')
        .map((s) => ({
          description: String(s.description),
          characters: Array.isArray(s.characters) ? s.characters.map(String) : [],
          animate: Boolean(s.animate),
          dialogue: s.dialogue ? String(s.dialogue) : undefined,
          shotSize: pickPreset((s as PlannedShot).shotSize, SHOT_SIZES),
          angle: pickPreset((s as PlannedShot).angle, ANGLES),
          lens: pickPreset((s as PlannedShot).lens, LENSES),
          light: pickPreset((s as PlannedShot).light, LIGHTS),
        }))
    : [];
  if (shots.length === 0) throw new Error('plan has no shots');
  return { title: String(raw.title ?? 'Untitled'), style: String(raw.style ?? ''), characters, shots };
}
