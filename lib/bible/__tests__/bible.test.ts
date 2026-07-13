import { describe, it, expect } from 'vitest';
import type { Project, Take } from '../../domain/types';
import { defaultCamera, defaultLight } from '../../domain/defaults';
import { editEntity, isTakeStale, staleTakeIds } from '../version';
import { parseAttributes } from '../extract';
import { switchModel, canConnect, type CanvasNodeState } from '../../canvas/node';
import { compile } from '../../compiler/compile';
import { selectModel } from '../../gateway/router';
import { qwenImagePlus } from '../../../manifests/qwen-image-plus';

function project(): Project {
  const shot = { id: 'shot1', sceneId: 'sc1', action: 'Mei looks up', entityIds: ['mei'], camera: defaultCamera(), light: defaultLight(), takeIds: [] };
  const other = { id: 'shot2', sceneId: 'sc1', action: 'empty room', entityIds: [] as string[], camera: defaultCamera(), light: defaultLight(), takeIds: [] };
  const take = (id: string, shotId: string, bibleVersion: number): Take => ({
    id, shotId, assetUrl: `/x/${id}.png`, accepted: false,
    provenance: { modelId: 'qwen-image-edit', capability: 'image.edit', seed: 1, compiledPrompt: {} as never, serializedPayload: {}, params: {}, latencyMs: 1, costUsd: 0.05, cacheHash: 'h', bibleVersion },
  });
  return {
    id: 'p', title: 't',
    bible: { version: 1, entities: [{ id: 'mei', kind: 'character', name: 'Mei', description: '', attributes: { wardrobe: 'red scarf' }, refs: [{ id: 'r', url: '/r.png', weight: 1 }], version: 1 }] },
    scenes: [{ id: 'sc1', title: 'S1', shotIds: ['shot1', 'shot2'] }],
    shots: [shot, other],
    takes: [take('t-mei', 'shot1', 1), take('t-room', 'shot2', 1)],
  };
}

describe('stale-flag propagation', () => {
  it('editing an entity attribute flags prior takes that reference it — instantly', () => {
    const p = project();
    expect(staleTakeIds(p)).toEqual([]); // nothing stale yet

    p.bible = editEntity(p.bible, 'mei', { attributes: { wardrobe: 'blue scarf' } });
    expect(p.bible.version).toBe(2);
    expect(p.bible.entities[0]!.version).toBe(2);

    // the Mei take (compiled at v1) is now stale; the empty-room take is not
    expect(isTakeStale(p.takes[0]!, p)).toBe(true);
    expect(isTakeStale(p.takes[1]!, p)).toBe(false);
    expect(staleTakeIds(p)).toEqual(['t-mei']);
  });

  it('a take compiled against the NEW version is not stale', () => {
    const p = project();
    p.bible = editEntity(p.bible, 'mei', { attributes: { wardrobe: 'blue scarf' } });
    p.takes[0]!.provenance.bibleVersion = p.bible.version; // recompiled
    expect(isTakeStale(p.takes[0]!, p)).toBe(false);
  });
});

describe('model switch preserves the compiled prompt (not a string)', () => {
  it('switching the model keeps CompiledPrompt byte-identical, only re-serializes', () => {
    const p = project();
    const compiled = compile({ shot: p.shots[0]!, bible: p.bible, seed: 3 });
    const editManifest = selectModel('image.edit');
    const node: CanvasNodeState = {
      id: 'n1', capability: 'image.edit', compiledPrompt: compiled, modelId: editManifest.id,
      payload: editManifest.serializer(compiled), status: 'cached', estCostUsd: editManifest.cost.amount,
    };
    const before = JSON.stringify(node.compiledPrompt);

    // switch to another image.edit-capable manifest (use a second edit manifest via a clone)
    const alt = { ...editManifest, id: 'alt-editor', cost: { unit: 'image' as const, amount: 0.09 } };
    const switched = switchModel(node, alt);

    expect(JSON.stringify(switched.compiledPrompt)).toBe(before); // prompt NOT cleared
    expect(switched.modelId).toBe('alt-editor');
    expect(switched.estCostUsd).toBe(0.09);
    expect(switched.status).toBe('idle');
  });

  it('refuses a manifest of the wrong capability', () => {
    const p = project();
    const compiled = compile({ shot: p.shots[0]!, bible: p.bible });
    const node: CanvasNodeState = { id: 'n', capability: 'image.edit', compiledPrompt: compiled, modelId: 'qwen-image-edit', payload: {}, status: 'idle', estCostUsd: 0 };
    expect(() => switchModel(node, qwenImagePlus)).toThrow(); // image.generate ≠ image.edit
  });
});

describe('typed ports', () => {
  it('image output → image.edit input ok; image → audio.tts refused; text → image.generate ok', () => {
    expect(canConnect('image.generate', 'image.edit').ok).toBe(true);
    const bad = canConnect('image.generate', 'audio.tts');
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('cannot feed');
    expect(canConnect('text.plan', 'image.generate').ok).toBe(true);
  });
});

describe('VL attribute extraction parsing', () => {
  it('parses a strict-JSON attribute block, tolerating code fences', () => {
    const attrs = parseAttributes('```json\n{"attributes":{"hair":"black bob","wardrobe":"red scarf"}}\n```');
    expect(attrs).toEqual({ hair: 'black bob', wardrobe: 'red scarf' });
  });
});
