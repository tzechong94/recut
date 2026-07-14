// The showrunner planner: a premise → a structured story plan (characters + shots). The plan is
// deterministically compiled into a node graph by build-graph.ts. qwen3-max returns strict JSON.

export interface StoryPlan {
  title: string;
  characters: { name: string; description: string }[];
  shots: { description: string; characters: string[]; animate: boolean; dialogue?: string }[];
}

export function planSystem(): string {
  return (
    'You are a film showrunner. Given a premise, break it into a shootable plan: a small cast of ' +
    'characters (each with a vivid visual description) and an ordered list of shots. Each shot has a ' +
    'cinematic visual description (shot size, angle, action, lighting), the names of characters featured ' +
    '(subset of the cast), whether it should be animated into video, and an optional spoken line. Keep it ' +
    'tight: 1-3 characters, 3-6 shots. Return STRICT JSON only, no prose:\n' +
    '{"title": str, "characters": [{"name": str, "description": str}], ' +
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
  return { title: String(raw.title ?? 'Untitled'), characters, shots };
}
