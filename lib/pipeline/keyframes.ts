import type { Project, Shot, Take } from '../domain/types';
import { compile } from '../compiler/compile';
import { selectModel, type Preference } from '../gateway/router';
import { Gateway } from '../gateway/jobs';
import { jobHash } from '../gateway/hash';
import { dashscopeImageCall } from '../../adapters/dashscope';

export interface KeyframeOptions {
  gateway?: Gateway;
  count?: number; // batch-of-4 selection UI needs 4
  preference?: Preference;
  baseSeed?: number;
}

/**
 * The vertical slice's engine: one shot → N keyframe candidates, each a Take with complete
 * provenance. Model access is only via the manifest/serializer/router/adapter chain, and the
 * Gateway resolves replay|live. In replay every candidate is a fixture hit — zero network.
 */
export async function generateKeyframes(project: Project, shot: Shot, opts: KeyframeOptions = {}): Promise<Take[]> {
  const gateway = opts.gateway ?? new Gateway();
  const count = opts.count ?? 4;
  const preference = opts.preference ?? 'quality';
  const baseSeed = opts.baseSeed ?? 1000;

  const manifest = selectModel('image.edit', preference, { minRefImages: 1 });
  const takes: Take[] = [];

  for (let i = 0; i < count; i++) {
    const seed = baseSeed + i;
    const compiled = compile({ shot, bible: project.bible, seed });
    const payload = manifest.serializer(compiled);
    const result = await gateway.run({
      modelId: manifest.id,
      serializedPayload: payload,
      seed,
      costUsd: manifest.cost.amount,
      live: async () => await dashscopeImageCall(manifest.id, payload),
    });
    const imageUrl = (result.payload as { imageUrl?: string }).imageUrl ?? '';
    takes.push({
      id: `${shot.id}-take-${seed}`,
      shotId: shot.id,
      assetUrl: imageUrl,
      accepted: false,
      provenance: {
        modelId: manifest.id,
        capability: manifest.capability,
        seed,
        compiledPrompt: compiled,
        serializedPayload: payload,
        params: { preference, count },
        latencyMs: result.latencyMs,
        costUsd: result.costUsd,
        cacheHash: jobHash(manifest.id, payload, seed),
        bibleVersion: project.bible.version,
      },
    });
  }
  return takes;
}

/** Accept one candidate as the Shot's Take. Never deletes other takes (hard rule 9). */
export function acceptTake(project: Project, shot: Shot, takeId: string): Project {
  const takes = project.takes.map((t) =>
    t.shotId === shot.id ? { ...t, accepted: t.id === takeId } : t,
  );
  const shots = project.shots.map((s) => (s.id === shot.id ? { ...s, acceptedTakeId: takeId } : s));
  return { ...project, takes, shots };
}
