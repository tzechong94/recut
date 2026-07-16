import { describe, it, expect } from 'vitest';
import {
  emptyPipeline,
  promptName,
  compilePromptText,
  resolveAssets,
  stageReady,
  toSlug,
  type PipelineDoc,
} from '../doc';

function doc(): PipelineDoc {
  return {
    projectId: 'p1',
    stylePrefix: 'soft daylight, 35mm, photorealistic commercial',
    assets: [
      { id: 'a1', slug: 'sofa', kind: 'product', imageUrl: '/sofa.png', locked: true },
      { id: 'a2', slug: 'hero', kind: 'character', imageUrl: '/hero.png', locked: false },
    ],
    scenes: [
      {
        title: 'Scene 1',
        prompts: [
          { name: '1A', text: 'the hero sinks into the sofa', assetSlugs: ['sofa', 'hero'] },
          { name: '1B', text: 'closeup of the stitching', assetSlugs: ['sofa'] },
        ],
      },
      {
        title: 'Scene 2',
        styleOverride: 'harsh midday sun, hard shadows',
        prompts: [{ name: '2A', text: 'sofa on the beach', assetSlugs: ['sofa'] }],
      },
    ],
    takes: [],
  };
}

describe('prompt naming', () => {
  it('scene index + letter', () => {
    expect(promptName(0, 0)).toBe('1A');
    expect(promptName(0, 2)).toBe('1C');
    expect(promptName(1, 1)).toBe('2B');
  });
});

describe('compilePromptText merge order', () => {
  it('global prefix glued to every prompt', () => {
    const t = compilePromptText(doc(), '1A');
    expect(t.startsWith('soft daylight')).toBe(true);
    expect(t).toContain('the hero sinks into the sofa');
  });
  it('scene override REPLACES the global prefix, scoped to that scene only', () => {
    const t2 = compilePromptText(doc(), '2A');
    expect(t2.startsWith('harsh midday sun')).toBe(true);
    expect(t2).not.toContain('soft daylight');
    const t1 = compilePromptText(doc(), '1B');
    expect(t1.startsWith('soft daylight')).toBe(true);
  });
  it('asset anchors appended by slug', () => {
    expect(compilePromptText(doc(), '1A')).toContain('sofa, hero');
  });
  it('deterministic: identical input, identical output', () => {
    expect(compilePromptText(doc(), '1A')).toBe(compilePromptText(doc(), '1A'));
  });
});

describe('resolveAssets', () => {
  it('resolves only LOCKED assets, preserving order', () => {
    const assets = resolveAssets(doc(), '1A');
    expect(assets.map((a) => a.slug)).toEqual(['sofa']); // hero is unlocked, skipped
  });
});

describe('stage gating', () => {
  it('empty doc gates both stages', () => {
    const g = stageReady(emptyPipeline('x'));
    expect(g.shotlist).toBe(false);
    expect(g.takes).toBe(false);
  });
  it('locked asset opens shotlist; prompts open takes', () => {
    const g = stageReady(doc());
    expect(g.shotlist).toBe(true);
    expect(g.takes).toBe(true);
  });
});

describe('toSlug', () => {
  it('normalizes display names to registry slugs', () => {
    expect(toSlug('Mr Bean SOY')).toBe('mr_bean_soy');
    expect(toSlug('  Héro!! ')).toBe('h_ro');
    expect(toSlug('')).toBe('asset');
  });
});
