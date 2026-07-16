import { describe, it, expect } from 'vitest';
import { buildGraphFromPlan } from '../build-graph';
import type { StoryPlan } from '../planner';

const basePlan: StoryPlan = {
  title: 'Test',
  style: 'soft Studio Ghibli watercolor, warm palette',
  characters: [{ name: 'Mei', description: 'a girl in a red scarf' }],
  shots: [
    { description: 'Mei walks home', characters: ['Mei'], animate: false },
    { description: 'a wide empty street', characters: [], animate: false },
  ],
};

describe('build-graph style anchor', () => {
  it('prepends a Style plate flagged as the style anchor when the plan has a style', () => {
    const g = buildGraphFromPlan(basePlan);
    const plate = g.nodes[0]!;
    expect(plate.key).toBe('style');
    expect(plate.styleAnchor).toBe(true);
    expect(plate.kind).toBe('text2image');
    // exactly one anchor in the whole graph
    expect(g.nodes.filter((n) => n.styleAnchor).length).toBe(1);
  });

  it('omits the Style plate when the plan has no style', () => {
    const g = buildGraphFromPlan({ ...basePlan, style: '' });
    expect(g.nodes.some((n) => n.styleAnchor)).toBe(false);
    expect(g.nodes.some((n) => n.key === 'style')).toBe(false);
  });

  it('still casts characters and shots alongside the anchor', () => {
    const g = buildGraphFromPlan(basePlan);
    expect(g.nodes.some((n) => n.name === 'Mei')).toBe(true);
    // 2 shots present (one single-character edit, one background text2image)
    expect(g.nodes.filter((n) => /^s\d+$/.test(n.key)).length).toBe(2);
  });
});
