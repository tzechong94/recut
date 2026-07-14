// The showrunner planner: a premise → a structured story plan (characters + shots). The plan is
// deterministically compiled into a node graph by build-graph.ts. qwen3-max returns strict JSON.

export interface StoryPlan {
  title: string;
  style: string;
  characters: { name: string; description: string }[];
  shots: { description: string; characters: string[]; animate: boolean; dialogue?: string }[];
}

export function planSystem(): string {
  return (
    'You are a film showrunner. Given a premise, break it into a shootable plan: ONE consistent visual ' +
    'style for the whole film (medium, palette, lighting mood — e.g. "soft Studio Ghibli watercolor, warm ' +
    'palette"), a small cast of characters (each with a vivid, specific visual description), and an ordered ' +
    'list of shots. Each shot has a cinematic description (shot size, angle, action), the names of ' +
    'characters featured (subset of the cast), whether to animate it, and an optional spoken line. Keep it ' +
    'tight: 1-3 characters, 3-6 shots. Return STRICT JSON only, no prose:\n' +
    '{"title": str, "style": str, "characters": [{"name": str, "description": str}], ' +
    '"shots": [{"description": str, "characters": [str], "animate": bool, "dialogue": str|null}]}'
  );
}

export function planUser(premise: string): string {
  return `Premise: ${premise}\n\nReturn the JSON plan.`;
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
        }))
    : [];
  if (shots.length === 0) throw new Error('plan has no shots');
  return { title: String(raw.title ?? 'Untitled'), style: String(raw.style ?? ''), characters, shots };
}
