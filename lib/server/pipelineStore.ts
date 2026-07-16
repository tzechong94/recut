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

export function getPipeline(id: string): PipelineDoc {
  const p = pathOf(id);
  if (!existsSync(p)) return emptyPipeline(id);
  return JSON.parse(readFileSync(p, 'utf8')) as PipelineDoc;
}

export function savePipeline(doc: PipelineDoc): void {
  const p = pathOf(doc.projectId);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(doc, null, 2));
}
