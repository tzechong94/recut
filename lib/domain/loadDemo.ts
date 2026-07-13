// Server-only: reads the repo fixtures dir. Import only from server components/routes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Project } from './types';

/** Loads the committed demo project. Server-only (reads the repo fixtures dir). */
export function loadDemoProject(): Project {
  const path = resolve(process.env.RECUT_FIXTURES_DIR ?? 'fixtures', 'demo-project.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Project;
}
