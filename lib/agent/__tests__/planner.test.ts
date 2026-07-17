import { describe, it, expect } from 'vitest';
import { parsePlan } from '../planner';
import { buildGraphFromPlan } from '../build-graph';

const SAMPLE = `Here is the plan:
{"title":"The Letter","characters":[{"name":"Mei","description":"30yo woman, red scarf"},{"name":"Jun","description":"older man"}],
"shots":[
 {"description":"Mei reads a letter, MS","characters":["Mei"],"animate":true,"dialogue":"So this is what it meant."},
 {"description":"Establishing wide of the cafe","characters":[],"animate":false,"dialogue":null},
 {"description":"Mei and Jun face off","characters":["Mei","Jun"],"animate":false}
]}`;

describe('planner parse', () => {
  it('extracts a valid plan from a fenced/garnished reply', () => {
    const plan = parsePlan(SAMPLE);
    expect(plan.title).toBe('The Letter');
    expect(plan.characters).toHaveLength(2);
    expect(plan.shots).toHaveLength(3);
    expect(plan.shots[0]!.dialogue).toContain('meant');
  });
  it('throws when there is no shot list', () => {
    expect(() => parsePlan('{"title":"x","characters":[],"shots":[]}')).toThrow();
  });
});

describe('build graph from plan', () => {
  it('compiles characters, shots, video and dialogue into a wired graph', () => {
    const g = buildGraphFromPlan(parsePlan(SAMPLE));
    const byKind = (k: string) => g.nodes.filter((n) => n.kind === k);
    expect(byKind('text2image').length).toBe(2 + 1); // 2 characters + 1 no-character shot
    expect(byKind('edit').length).toBe(1); // shot with 1 character
    expect(byKind('compose').length).toBe(1); // shot with 2 characters
    expect(byKind('video').length).toBe(1); // the one animated shot
    expect(byKind('dialogue').length).toBe(1);

    // the 1-character shot is wired from Mei's node
    const meiKey = g.nodes.find((n) => n.name === 'Mei')!.key;
    const editNode = g.nodes.find((n) => n.kind === 'edit')!;
    expect(editNode.inputs).toContain(meiKey);
    expect(g.edges).toContainEqual({ from: meiKey, to: editNode.key });

    // the 2-character shot composes both characters
    const composeNode = g.nodes.find((n) => n.kind === 'compose')!;
    expect(composeNode.inputs).toHaveLength(2);
  });
});

describe('camera preset hints (seedance skill vocabulary)', () => {
  it('parses exact preset strings and fuzzy-matches near misses', () => {
    const p = parsePlan(JSON.stringify({
      title: 'T', style: 's',
      characters: [{ name: 'a', description: 'd' }],
      shots: [{ description: 'x', characters: [], animate: true, shotSize: 'Close-Up', angle: 'low', lens: '85mm', light: 'golden hour' }],
    }));
    expect(p.shots[0]!.shotSize).toBe('close-up');
    expect(p.shots[0]!.angle).toBe('low angle');
    expect(p.shots[0]!.lens).toBe('85mm portrait lens');
    expect(p.shots[0]!.light).toBe('golden hour');
  });
  it('garbage presets are dropped, not passed through', () => {
    const p = parsePlan(JSON.stringify({ title: 'T', style: 's', characters: [], shots: [{ description: 'x', characters: [], animate: false, shotSize: 'dutch zoom crash' }] }));
    expect(p.shots[0]!.shotSize).toBeUndefined();
  });
});
