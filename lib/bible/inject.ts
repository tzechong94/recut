import type { SeriesBible, Shot } from '../domain/types.js';
import type { AssetRef } from '../gateway/types.js';

/**
 * Entities are referenced, never copied. At compile time a shot's entityIds resolve to
 * their locked reference images, ordered by importance (weight asc). Edit an entity in
 * the bible and every shot that references it inherits the change with no user action —
 * this function is the single injection point (asserted in a test).
 */
export function injectRefs(shot: Shot, bible: SeriesBible): AssetRef[] {
  const byId = new Map(bible.entities.map((e) => [e.id, e]));
  const refs: AssetRef[] = [];
  for (const id of shot.entityIds) {
    const entity = byId.get(id);
    if (!entity) continue; // a dangling reference injects nothing, never throws
    for (const ref of entity.refs) refs.push({ ...ref, entityId: entity.id });
  }
  return refs.sort((a, b) => a.weight - b.weight);
}

/** Compact identity anchors from an entity's attribute block, for the prompt subject line. */
export function subjectDescription(shot: Shot, bible: SeriesBible): string {
  const byId = new Map(bible.entities.map((e) => [e.id, e]));
  const parts: string[] = [];
  for (const id of shot.entityIds) {
    const e = byId.get(id);
    if (!e) continue;
    const attrs = Object.entries(e.attributes)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    parts.push(attrs ? `${e.name} (${attrs})` : e.name);
  }
  return parts.join('; ');
}
