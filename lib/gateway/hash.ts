import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted recursively so semantically identical
 * payloads hash identically regardless of key insertion order. Arrays keep
 * order (order is meaningful for refs, frames, etc.).
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalize((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * The one cache key for the whole system: sha256(modelId + serializedPayload + seed).
 * Same key in replay and live, so code proven in replay works live unchanged.
 */
export function jobHash(modelId: string, serializedPayload: unknown, seed?: number): string {
  const canonical = JSON.stringify({
    modelId,
    payload: canonicalize(serializedPayload),
    seed: seed ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
