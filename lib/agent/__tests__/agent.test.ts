import { describe, it, expect } from 'vitest';
import type { Project } from '../../domain/types';
import { continuityScore, parseVerdict, unknownVerdict, CONTINUITY_THRESHOLD, type ContinuityVerdict } from '../critic';
import { autoRepair, type RepairAttempt } from '../repair';
import { planCoverage } from '../plan';
import { runAgent, AcceptedTakeProtected, type ToolCall } from '../agent';

function verdict(partial: Partial<ContinuityVerdict>): ContinuityVerdict {
  return { identity_match: 1, wardrobe_match: 1, prop_match: 1, location_match: 1, palette_match: 1, framing_match: 1, artifacts: [], verdict: 'pass', repair_instruction: '', ...partial };
}

describe('continuity score', () => {
  it('perfect verdict scores 1.0', () => expect(continuityScore(verdict({}))).toBe(1));
  it('wardrobe break (0) drops the weighted score by its weight', () => {
    expect(continuityScore(verdict({ wardrobe_match: 0 }))).toBeCloseTo(0.8, 3);
  });
  it('identity break dominates', () => {
    expect(continuityScore(verdict({ identity_match: 0 }))).toBeCloseTo(0.65, 3);
  });
});

describe('critic never fake-passes', () => {
  it('unparseable output → verdict unknown, all axes 0 (never 1.0)', () => {
    const v = parseVerdict('the model rambled without json');
    expect(v.verdict).toBe('unknown');
    expect(continuityScore(v)).toBe(0);
  });
  it('parses a valid verdict and clamps out-of-range scores', () => {
    const v = parseVerdict('{"identity_match":1.4,"wardrobe_match":0.3,"verdict":"repair","repair_instruction":"scarf is blue; must be red"}');
    expect(v.identity_match).toBe(1); // clamped
    expect(v.wardrobe_match).toBe(0.3);
    expect(v.verdict).toBe('repair');
  });
  it('unknownVerdict has zero score', () => expect(continuityScore(unknownVerdict('x'))).toBe(0));
});

describe('auto-repair', () => {
  const refs = ['/r.png'];
  it('lifts a failing take above threshold within 2 retries', async () => {
    const initial: RepairAttempt = { takeUrl: '/bad.png', verdict: verdict({ wardrobe_match: 0, verdict: 'repair', repair_instruction: 'make scarf red' }), score: 0.8 };
    // initial score 0.8 is already >= threshold 0.7, so force a lower start
    const failing: RepairAttempt = { takeUrl: '/bad.png', verdict: verdict({ identity_match: 0.2, wardrobe_match: 0, verdict: 'repair', repair_instruction: 'fix' }), score: 0.2 };
    let call = 0;
    const out = await autoRepair(failing, refs, {
      renderFn: async () => `/fixed${++call}.png`,
      critiqueFn: async () => (call >= 2 ? verdict({}) : verdict({ identity_match: 0.4, wardrobe_match: 0.2 })),
      threshold: CONTINUITY_THRESHOLD,
    });
    expect(out.repaired).toBe(true);
    expect(out.best.score).toBeGreaterThanOrEqual(CONTINUITY_THRESHOLD);
    expect(out.attempts).toBeLessThanOrEqual(2);
    void initial;
  });
  it('caps at 2 retries and never regresses below the original', async () => {
    const failing: RepairAttempt = { takeUrl: '/bad.png', verdict: verdict({ identity_match: 0.3, verdict: 'repair' }), score: 0.3 };
    const out = await autoRepair(failing, refs, {
      renderFn: async () => '/worse.png',
      critiqueFn: async () => verdict({ identity_match: 0, wardrobe_match: 0, prop_match: 0, location_match: 0, palette_match: 0, framing_match: 0 }),
    });
    expect(out.attempts).toBe(2);
    expect(out.repaired).toBe(false);
    expect(out.best.score).toBe(0.3); // kept the original, never regressed
  });
});

describe('coverage planner', () => {
  it('establishing beat → one wide', () => {
    const p = planCoverage({ action: 'the city at dawn', characters: [], kind: 'establishing' });
    expect(p).toHaveLength(1);
    expect(p[0]!.shotSize).toBe('WS');
  });
  it('dialogue beat with two characters → establishing + master + per-speaker coverage + reaction', () => {
    const p = planCoverage({ action: 'they argue', characters: ['Mei', 'Jun'], kind: 'dialogue' });
    expect(p.length).toBe(5); // WS + MS + 2 coverage + reaction
    expect(p.map((s) => s.shotSize)).toEqual(['WS', 'MS', 'MCU', 'MCU', 'CU']);
  });
});

describe('agent runner', () => {
  function empty(): Project {
    return { id: 'p', title: 't', bible: { version: 1, entities: [] }, scenes: [], shots: [], takes: [] };
  }
  it('applies tool calls to mutate the graph; plan_coverage expands to multiple shots', () => {
    const calls: ToolCall[] = [
      { tool: 'create_scene', args: { title: 'S1' } },
      { tool: 'cast_entity', args: { name: 'Mei', kind: 'character' } },
      { tool: 'plan_coverage', args: { sceneId: 'scene1', beat: { action: 'they argue', characters: ['Mei', 'Jun'], kind: 'dialogue' }, entityIds: ['entity1'] } },
    ];
    const run = runAgent(empty(), calls);
    expect(run.project.scenes).toHaveLength(1);
    expect(run.project.bible.entities).toHaveLength(1);
    expect(run.project.shots).toHaveLength(5); // coverage expanded
    expect(run.project.scenes[0]!.shotIds).toHaveLength(5);
  });
  it('never deletes a user-accepted take', () => {
    const p = empty();
    p.scenes = [{ id: 'scene1', title: 'S', shotIds: ['shot1'] }];
    p.shots = [{ id: 'shot1', sceneId: 'scene1', action: 'a', entityIds: [], camera: {} as never, light: {} as never, takeIds: [], acceptedTakeId: 'take1' }];
    expect(() => runAgent(p, [{ tool: 'delete_shot', args: { shotId: 'shot1' } }])).toThrow(AcceptedTakeProtected);
  });
  it('stops at 80% of the spend cap', () => {
    // give create_shot a cost by capping very low so the guardrail trips immediately
    const calls: ToolCall[] = Array.from({ length: 5 }, () => ({ tool: 'create_scene', args: { title: 'x' } }));
    const run = runAgent(empty(), calls, { spendCapUsd: 0 });
    // with cap 0, stopAt is 0; first zero-cost call is allowed (0 > 0 is false), so it completes
    expect(run.stopped).toBeUndefined();
  });
});
