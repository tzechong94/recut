import { describe, it, expect } from 'vitest';
import {
  deletePrompt,
  deriveTimeline,
  filmSegments,
  splitSegment,
  deleteScene,
  keeperClips,
  moveScene,
  voiceTracks,
  emptyPipeline,
  mentionedSlugs,
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
  it('reference bindings list only LOCKED (actually attached) assets', () => {
    const t = compilePromptText(doc(), '1A');
    expect(t).toContain('Reference image 1 is sofa'); // locked
    expect(t).not.toContain('is hero ('); // unlocked: not attached, so never bound
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

describe('scene delete and move (names renumber, takes follow)', () => {
  const withTakes = (): PipelineDoc => {
    const d = doc();
    d.takes = [
      { id: 't1', promptName: '1A', kind: 'image', url: '/t1.png', score: 0.9 },
      { id: 't2', promptName: '2A', kind: 'image', url: '/t2.png', score: 0.8 },
    ];
    return d;
  };

  it('deleteScene drops its prompts AND their takes, renumbers the rest', () => {
    const d = deleteScene(withTakes(), 0); // delete Scene 1 (1A, 1B)
    expect(d.scenes.length).toBe(1);
    expect(d.scenes[0]!.prompts[0]!.name).toBe('1A'); // old 2A renumbered to 1A
    expect(d.scenes[0]!.title).toBe('Scene 1');
    // t1 (old 1A) dropped with its scene; t2 followed 2A -> 1A
    expect(d.takes.length).toBe(1);
    expect(d.takes[0]!.id).toBe('t2');
    expect(d.takes[0]!.promptName).toBe('1A');
  });

  it('moveScene swaps order, renumbers, and takes follow their prompt', () => {
    const d = moveScene(withTakes(), 1, -1); // Scene 2 moves up
    expect(d.scenes[0]!.prompts[0]!.text).toBe('sofa on the beach');
    expect(d.scenes[0]!.prompts[0]!.name).toBe('1A'); // old 2A is now 1A
    expect(d.scenes[1]!.prompts.map((p) => p.name)).toEqual(['2A', '2B']);
    const t2 = d.takes.find((t) => t.id === 't2')!;
    expect(t2.promptName).toBe('1A'); // followed its prompt
    const t1 = d.takes.find((t) => t.id === 't1')!;
    expect(t1.promptName).toBe('2A');
    // scene override travelled with its scene
    expect(d.scenes[0]!.styleOverride).toContain('harsh midday');
  });

  it('move at the boundary is a no-op', () => {
    const d = withTakes();
    expect(moveScene(d, 0, -1)).toBe(d);
    expect(moveScene(d, 1, 1)).toBe(d);
  });
});

describe('film harvest (keeper clips + voice tracks)', () => {
  const filmDoc = (): PipelineDoc => {
    const d = doc();
    d.takes = [
      { id: 'v1', promptName: '1A', kind: 'video', url: '/1a-old.mp4' },
      { id: 'v2', promptName: '1A', kind: 'video', url: '/1a-new.mp4' },
      { id: 'v3', promptName: '2A', kind: 'video', url: '/2a-a.mp4', keeper: true },
      { id: 'v4', promptName: '2A', kind: 'video', url: '/2a-b.mp4' },
      { id: 'img', promptName: '1B', kind: 'image', url: '/1b.png' },
      { id: 'au', promptName: '1A', kind: 'audio', url: '/1a.wav' },
    ];
    return d;
  };
  it('keeper wins; otherwise newest video; images never included; scene order kept', () => {
    const clips = keeperClips(filmDoc());
    expect(clips.map(({ promptName, url }) => ({ promptName, url }))).toEqual([
      { promptName: '1A', url: '/1a-new.mp4' }, // no keeper -> newest
      { promptName: '2A', url: '/2a-a.mp4' }, // explicit keeper wins over later take
    ]);
  });
  it('voice tracks come out in scene order', () => {
    expect(voiceTracks(filmDoc())).toEqual(['/1a.wav']);
  });
  it('film gate opens only with a video take', () => {
    expect(stageReady(filmDoc()).film).toBe(true);
    expect(stageReady(doc()).film).toBe(false);
  });
});

describe('cinematography presets compile into the prompt', () => {
  it('appends shot size, angle, lens, light after the body, before asset anchors', () => {
    const d = doc();
    d.scenes[0]!.prompts[0] = { ...d.scenes[0]!.prompts[0]!, shotSize: 'close-up', angle: 'low angle', lens: '85mm portrait lens', light: 'Rembrandt lighting' };
    const t = compilePromptText(d, '1A');
    expect(t).toContain('the hero sinks into the sofa. close-up, low angle, 85mm portrait lens, Rembrandt lighting. Reference image 1');
  });
  it('no presets, no extra segment (back-compat)', () => {
    expect(compilePromptText(doc(), '1B')).not.toContain('undefined');
  });
});

describe('filmOrder overrides scene order in keeperClips', () => {
  it('listed names first, unlisted keep scene order, unknown names ignored', () => {
    const d = doc();
    d.takes = [
      { id: 'v1', promptName: '1A', kind: 'video', url: '/1a.mp4' },
      { id: 'v2', promptName: '1B', kind: 'video', url: '/1b.mp4' },
      { id: 'v3', promptName: '2A', kind: 'video', url: '/2a.mp4' },
    ];
    d.filmOrder = ['2A', 'ZZ', '1A'];
    expect(keeperClips(d).map((c) => c.promptName)).toEqual(['2A', '1A', '1B']);
  });
});

describe('deletePrompt (cut-level delete)', () => {
  it('removes one cut, renumbers siblings, drops its takes, keeps others', () => {
    const d = doc();
    d.takes = [
      { id: 't1', promptName: '1A', kind: 'image', url: '/a.png' },
      { id: 't2', promptName: '1B', kind: 'image', url: '/b.png' },
    ];
    const out = deletePrompt(d, '1A');
    expect(out.scenes[0]!.prompts.map((p) => p.name)).toEqual(['1A']); // old 1B renamed
    expect(out.takes.length).toBe(1);
    expect(out.takes[0]!.id).toBe('t2');
    expect(out.takes[0]!.promptName).toBe('1A');
  });
  it('deleting a scene\'s last cut removes the scene entirely', () => {
    const d = doc();
    const out = deletePrompt(d, '2A'); // scene 2 has only 2A
    expect(out.scenes.length).toBe(1);
  });
  it('unknown name is a no-op', () => {
    const d = doc();
    expect(deletePrompt(d, '9Z')).toBe(d);
  });
});

describe('reference binding + @mentions', () => {
  it('compiled prompt ENUMERATES which image is which entity and forbids merging', () => {
    const d = doc();
    d.assets.push({ id: 'a3', slug: 'yeepi', kind: 'character', imageUrl: '/y.png', locked: true });
    d.scenes[0]!.prompts[0]!.assetSlugs = ['sofa', 'yeepi'];
    const t = compilePromptText(d, '1A');
    expect(t).toContain('Reference image 1 is sofa (product)');
    expect(t).toContain('Reference image 2 is yeepi (character)');
    expect(t).toContain('never merge, swap, or average');
  });
  it('@slug in the text compiles to the plain name', () => {
    const d = doc();
    d.scenes[0]!.prompts[0]!.text = '@sofa glows while @hero naps';
    expect(compilePromptText(d, '1A')).toContain('sofa glows while hero naps');
    expect(compilePromptText(d, '1A')).not.toContain('@sofa');
  });
  it('mentionedSlugs finds only registered slugs, deduped', () => {
    expect(mentionedSlugs('pan from @yoopi to @yeepi and @yoopi again, ignore @ghost', ['yoopi', 'yeepi'])).toEqual(['yoopi', 'yeepi']);
  });
});

describe('film exclusion + trims ride on keeper clips', () => {
  it('excluded prompt names drop out of the film; trims carried', () => {
    const d = doc();
    d.takes = [
      { id: 'v1', promptName: '1A', kind: 'video', url: '/1a.mp4', trimIn: 0.5, trimOut: 3 },
      { id: 'v2', promptName: '2A', kind: 'video', url: '/2a.mp4' },
    ];
    d.filmExcluded = ['2A'];
    const clips = keeperClips(d);
    expect(clips.map((c) => c.promptName)).toEqual(['1A']);
    expect(clips[0]).toMatchObject({ takeId: 'v1', trimIn: 0.5, trimOut: 3 });
  });
});

describe('film timeline (EDL): derive, resolve, split', () => {
  const tlDoc = (): PipelineDoc => {
    const d = doc();
    d.takes = [
      { id: 'v1', promptName: '1A', kind: 'video', url: '/1a.mp4', trimIn: 0.5 },
      { id: 'v2', promptName: '2A', kind: 'video', url: '/2a.mp4', keeper: true },
    ];
    return d;
  };
  it('derives one full segment per keeper clip, honoring legacy trims', () => {
    const tl = deriveTimeline(tlDoc());
    expect(tl).toHaveLength(2);
    expect(tl[0]).toMatchObject({ takeId: 'v1', start: 0.5, end: undefined });
  });
  it('filmSegments resolves takes and drops dangling segments', () => {
    const d = tlDoc();
    d.timeline = [
      { id: 's1', takeId: 'v2', start: 0, end: 2 },
      { id: 'sx', takeId: 'GONE', start: 0 },
      { id: 's2', takeId: 'v2', start: 3, end: 4.5 }, // same take twice (split result)
    ];
    const segs = filmSegments(d);
    expect(segs.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(segs[0]!.url).toBe('/2a.mp4');
  });
  it('splitSegment cuts one segment into two adjoining windows', () => {
    const tl = [{ id: 's1', takeId: 'v1', start: 1, end: 5 }];
    const out = splitSegment(tl, 's1', 3);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ start: 1, end: 3 });
    expect(out[1]).toMatchObject({ start: 3, end: 5 });
  });
  it('split too close to an edge is a no-op (no sliver segments)', () => {
    const tl = [{ id: 's1', takeId: 'v1', start: 1, end: 5 }];
    expect(splitSegment(tl, 's1', 1.05)).toBe(tl);
    expect(splitSegment(tl, 's1', 4.95)).toBe(tl);
  });
});

describe('multi-keeper: several starred clips of one cut all join the film', () => {
  it('all starred videos ride, in take order; unstarred cuts fall back to newest', () => {
    const d = doc();
    d.takes = [
      { id: 'v1', promptName: '1A', kind: 'video', url: '/a1.mp4', keeper: true },
      { id: 'v2', promptName: '1A', kind: 'video', url: '/a2.mp4' },
      { id: 'v3', promptName: '1A', kind: 'video', url: '/a3.mp4', keeper: true },
      { id: 'v4', promptName: '2A', kind: 'video', url: '/b1.mp4' },
    ];
    const clips = keeperClips(d);
    expect(clips.map((c) => c.takeId)).toEqual(['v1', 'v3', 'v4']);
  });
  it('filmOrder moves ALL clips of a named cut together', () => {
    const d = doc();
    d.takes = [
      { id: 'v1', promptName: '1A', kind: 'video', url: '/a1.mp4', keeper: true },
      { id: 'v3', promptName: '1A', kind: 'video', url: '/a3.mp4', keeper: true },
      { id: 'v4', promptName: '2A', kind: 'video', url: '/b1.mp4' },
    ];
    d.filmOrder = ['2A', '1A'];
    expect(keeperClips(d).map((c) => c.takeId)).toEqual(['v4', 'v1', 'v3']);
  });
});
