// Series Bible versioning + stale-flag propagation. Entities are referenced, never copied;
// editing an entity attribute bumps the bible version and stamps the entity, which makes every
// take that compiled against an older version of that entity visibly STALE — instantly.

import type { Project, SeriesBible, Take } from '../domain/types';

/** Edit an entity attribute (or any field). Bumps the bible version and stamps the entity. */
export function editEntity(
  bible: SeriesBible,
  entityId: string,
  patch: Partial<{ name: string; description: string; attributes: Record<string, string> }>,
): SeriesBible {
  const nextVersion = bible.version + 1;
  return {
    version: nextVersion,
    entities: bible.entities.map((e) =>
      e.id === entityId
        ? {
            ...e,
            ...('name' in patch ? { name: patch.name! } : {}),
            ...('description' in patch ? { description: patch.description! } : {}),
            ...('attributes' in patch ? { attributes: { ...e.attributes, ...patch.attributes } } : {}),
            version: nextVersion,
          }
        : e,
    ),
  };
}

/**
 * A take is stale if any entity its shot references has changed (entity.version) since the
 * take was compiled (take.provenance.bibleVersion). Entities with no explicit version are
 * treated as version 0 (unchanged since creation).
 */
export function isTakeStale(take: Take, project: Project): boolean {
  const shot = project.shots.find((s) => s.id === take.shotId);
  if (!shot) return false;
  const byId = new Map(project.bible.entities.map((e) => [e.id, e]));
  for (const entityId of shot.entityIds) {
    const entity = byId.get(entityId);
    if (!entity) continue;
    if ((entity.version ?? 0) > take.provenance.bibleVersion) return true;
  }
  return false;
}

/** All takes currently flagged stale — the canvas colours these instantly. */
export function staleTakeIds(project: Project): string[] {
  return project.takes.filter((t) => isTakeStale(t, project)).map((t) => t.id);
}
