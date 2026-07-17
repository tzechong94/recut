// Server-side pipeline document storage. Same pattern as projectStore: file-backed under
// .recut/pipeline/<id>.json, RECUT_DATA_DIR-aware so e2e stays isolated.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { emptyPipeline, type PipelineDoc } from '../pipeline/doc';

function dir(): string {
  const base = process.env.RECUT_DATA_DIR
    ? resolve(process.env.RECUT_DATA_DIR, '../pipeline')
    : resolve(process.cwd(), '.recut/pipeline');
  mkdirSync(base, { recursive: true });
  return base;
}

function pathOf(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('bad pipeline id');
  return join(dir(), `${id}.json`);
}

/** Showcase projects (RECUT_SHOWCASE_IDS, comma-separated) are read-only: judges can explore,
 *  nothing they do persists. Set on the deployed instance, unset locally. */
export function isShowcase(id: string): boolean {
  return (process.env.RECUT_SHOWCASE_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean).includes(id);
}

export function getPipeline(id: string): PipelineDoc {
  const p = pathOf(id);
  const doc = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as PipelineDoc) : emptyPipeline(id);
  return isShowcase(id) ? { ...doc, readOnly: true } : doc;
}

/** Save with optimistic concurrency. If the caller's rev is stale, the stored doc's takes are
 *  UNION-merged in (takes are the expensive artifacts; losing one is never acceptable) and the
 *  caller's view wins for everything else. Returns the saved doc (with its new rev). */
export function savePipeline(doc: PipelineDoc): PipelineDoc {
  const p = pathOf(doc.projectId);
  mkdirSync(dirname(p), { recursive: true });
  const stored = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as PipelineDoc) : null;
  let next = { ...doc };
  if (stored && (stored.rev ?? 0) !== (doc.rev ?? 0)) {
    const have = new Set(next.takes.map((t) => t.id));
    const missing = stored.takes.filter((t) => !have.has(t.id));
    next = { ...next, takes: [...next.takes, ...missing] };
  }
  next.rev = (stored?.rev ?? 0) + 1;
  writeFileSync(p, JSON.stringify(next, null, 2));
  return next;
}
