import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project, Shot } from '../../domain/types';
import { defaultCamera, defaultLight } from '../../domain/defaults';
import { compile } from '../../compiler/compile';
import { injectRefs } from '../../bible/inject';
import { selectModel, NoModelForCapability } from '../../gateway/router';
import { Gateway } from '../../gateway/jobs';
import { jobHash } from '../../gateway/hash';
import { generateKeyframes, acceptTake } from '../keyframes';

function demoProject(): Project {
  const shot: Shot = {
    id: 'shot1',
    sceneId: 'scene1',
    action: 'Mei looks up from the letter',
    entityIds: ['mei'],
    camera: defaultCamera(),
    light: defaultLight(),
    takeIds: [],
  };
  return {
    id: 'p1',
    title: 'demo',
    bible: {
      version: 1,
      entities: [
        {
          id: 'mei',
          kind: 'character',
          name: 'Mei',
          description: 'a woman in a red scarf',
          attributes: { hair: 'black bob', wardrobe: 'red scarf, charcoal jacket' },
          refs: [
            { id: 'r2', url: 'https://x/2.png', weight: 2 },
            { id: 'r1', url: 'https://x/1.png', weight: 1 },
          ],
        },
      ],
    },
    scenes: [{ id: 'scene1', title: 'Scene 1', shotIds: ['shot1'] }],
    shots: [shot],
    takes: [],
  };
}

describe('bible injection', () => {
  it('injects an entity\'s refs, ordered by weight, tagged with entityId', () => {
    const p = demoProject();
    const refs = injectRefs(p.shots[0]!, p.bible);
    expect(refs.map((r) => r.id)).toEqual(['r1', 'r2']); // weight asc
    expect(refs.every((r) => r.entityId === 'mei')).toBe(true);
  });
  it('ignores dangling entity references without throwing', () => {
    const p = demoProject();
    p.shots[0]!.entityIds = ['ghost'];
    expect(injectRefs(p.shots[0]!, p.bible)).toEqual([]);
  });
});

describe('compiler', () => {
  it('is byte-deterministic for identical input', () => {
    const p = demoProject();
    const a = compile({ shot: p.shots[0]!, bible: p.bible, seed: 7 });
    const b = compile({ shot: p.shots[0]!, bible: p.bible, seed: 7 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('injects bible refs into the compiled prompt with zero user action', () => {
    const p = demoProject();
    const c = compile({ shot: p.shots[0]!, bible: p.bible });
    expect(c.refs.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(c.subject.entityIds).toEqual(['mei']);
  });
});

describe('router', () => {
  it('selects the image.edit manifest', () => {
    expect(selectModel('image.edit').id).toBe('qwen-image-edit');
  });
  it('throws for an unsatisfiable capability', () => {
    expect(() => selectModel('audio.asr')).toThrow(NoModelForCapability);
  });
});

describe('keyframe pipeline (replay, zero network)', () => {
  let dir: string;
  let fixturesDir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'recut-slice-'));
    fixturesDir = join(dir, 'fixtures');
    mkdirSync(fixturesDir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('produces 4 candidate takes with complete provenance, no network', async () => {
    const p = demoProject();
    const manifest = selectModel('image.edit', 'quality', { minRefImages: 1 });
    // seed the 4 fixtures the pipeline will ask for
    for (let i = 0; i < 4; i++) {
      const seed = 1000 + i;
      const compiled = compile({ shot: p.shots[0]!, bible: p.bible, seed });
      const payload = manifest.serializer(compiled);
      const hash = jobHash(manifest.id, payload, seed);
      writeFileSync(
        join(fixturesDir, `${hash}.json`),
        JSON.stringify({ hash, modelId: manifest.id, seed, costUsd: 0.05, latencyMs: 11, payload: { imageUrl: `https://cache/${seed}.png` } }),
      );
    }
    const gw = new Gateway({ mode: 'replay', fixturesDir });
    const takes = await generateKeyframes(p, p.shots[0]!, { gateway: gw });

    expect(takes).toHaveLength(4);
    for (const t of takes) {
      expect(t.assetUrl).toMatch(/^https:\/\/cache\//);
      const pv = t.provenance;
      // complete provenance (hard rule 7)
      expect(pv.modelId).toBe('qwen-image-edit');
      expect(pv.capability).toBe('image.edit');
      expect(typeof pv.seed).toBe('number');
      expect(pv.compiledPrompt.subject.entityIds).toEqual(['mei']);
      expect(pv.serializedPayload).toBeTruthy();
      expect(pv.cacheHash).toHaveLength(64);
      expect(pv.costUsd).toBe(0.05);
      expect(pv.bibleVersion).toBe(1);
    }
  });

  it('acceptTake marks one accepted and never drops the others', () => {
    const p = demoProject();
    p.takes = [
      { id: 'shot1-take-1000', shotId: 'shot1', assetUrl: 'a', accepted: false, provenance: {} as never },
      { id: 'shot1-take-1001', shotId: 'shot1', assetUrl: 'b', accepted: false, provenance: {} as never },
    ];
    const next = acceptTake(p, p.shots[0]!, 'shot1-take-1001');
    expect(next.takes).toHaveLength(2); // none deleted
    expect(next.takes.find((t) => t.id === 'shot1-take-1001')!.accepted).toBe(true);
    expect(next.takes.find((t) => t.id === 'shot1-take-1000')!.accepted).toBe(false);
    expect(next.shots[0]!.acceptedTakeId).toBe('shot1-take-1001');
  });
});
