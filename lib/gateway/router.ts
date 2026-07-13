import type { Capability, ModelManifest } from './types';
import { MANIFESTS } from '../../manifests/index';

export type Preference = 'quality' | 'speed' | 'cost';

export interface Constraints {
  minRefImages?: number;
  needsSeed?: boolean;
  needsNegativePrompt?: boolean;
}

export class NoModelForCapability extends Error {
  constructor(readonly capability: Capability) {
    super(`no manifest satisfies capability ${capability} under the given constraints`);
    this.name = 'NoModelForCapability';
  }
}

function satisfies(m: ModelManifest, c: Constraints): boolean {
  if (c.minRefImages !== undefined && (m.supports.maxRefImages ?? 0) < c.minRefImages) return false;
  if (c.needsSeed && !m.supports.seed) return false;
  if (c.needsNegativePrompt && !m.supports.negativePrompt) return false;
  return true;
}

/**
 * selectModel: filter by capability + supports satisfaction, then rank by preference.
 * quality = richest supports; speed = lowest p50 latency; cost = cheapest per unit.
 */
export function selectModel(
  capability: Capability,
  preference: Preference = 'quality',
  constraints: Constraints = {},
  pool: ModelManifest[] = MANIFESTS,
): ModelManifest {
  const candidates = pool.filter((m) => m.capability === capability && satisfies(m, constraints));
  if (candidates.length === 0) throw new NoModelForCapability(capability);
  const ranked = [...candidates].sort((a, b) => {
    if (preference === 'cost') return a.cost.amount - b.cost.amount;
    if (preference === 'speed') return a.latencyP50Sec - b.latencyP50Sec;
    // quality: most reference images, then most outputs, then lower latency as a tiebreak
    const refs = (b.supports.maxRefImages ?? 0) - (a.supports.maxRefImages ?? 0);
    if (refs !== 0) return refs;
    return a.latencyP50Sec - b.latencyP50Sec;
  });
  return ranked[0]!;
}
