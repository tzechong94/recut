import { describe, it, expect } from 'vitest';
import { classifyVerdict, primaryLayer } from '../taxonomy';

const verdict = (over: Record<string, number>) => ({
  identity_match: 1, wardrobe_match: 1, prop_match: 1, location_match: 1, palette_match: 1, framing_match: 1,
  verdict: 'repair', repair_instruction: 'fix it', ...over,
});

describe('failure taxonomy classifier', () => {
  it('a clean verdict produces no diagnoses', () => {
    expect(classifyVerdict(verdict({}))).toEqual([]);
  });
  it('identity break maps to the ASSET layer and is not auto-fixable via prompt', () => {
    const d = classifyVerdict(verdict({ identity_match: 0.4 }));
    expect(d).toHaveLength(1);
    expect(d[0]!.layer).toBe('asset');
    expect(d[0]!.autoFixable).toBe(false);
  });
  it('prop break maps to the PROMPT layer (lock line) and is auto-fixable', () => {
    const d = classifyVerdict(verdict({ prop_match: 0.3 }));
    expect(d[0]!.layer).toBe('prompt');
    expect(d[0]!.autoFixable).toBe(true);
  });
  it('palette break maps to scene-style (scoped override, not global rewrite)', () => {
    expect(classifyVerdict(verdict({ palette_match: 0.5 }))[0]!.layer).toBe('scene-style');
  });
  it('multiple failures sort worst-first and primaryLayer follows the worst', () => {
    const d = classifyVerdict(verdict({ framing_match: 0.6, prop_match: 0.2 }));
    expect(d.map((x) => x.axis)).toEqual(['prop_match', 'framing_match']);
    expect(primaryLayer(d)).toBe('prompt');
  });
  it('handles missing/garbage verdicts without throwing', () => {
    expect(classifyVerdict(undefined)).toEqual([]);
    expect(classifyVerdict({ identity_match: 'zebra' } as never)).toEqual([]);
  });
});
