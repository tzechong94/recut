import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `pnpm eval:ui` — screenshots every key screen, judges each against the UI rubric
 * with qwen3-vl-plus, prints a score per axis. Runs LIVE but costs pennies (one VLM
 * call per screenshot).
 *
 * Sprint 0 status: the harness exists and runs. Screens don't exist yet (Sprint 1+),
 * so with no screenshots this reports STAGED and exits 0. Once screens exist, a
 * Playwright pass writes PNGs to test-results/screens/ and this scores them.
 */
const RUBRIC = [
  'visual_hierarchy',
  'density',
  'typography',
  'node_legibility',
  'state_clarity',
  'craft',
  'professional_trust',
] as const;

const screensDir = resolve(process.env.RECUT_SCREENS_DIR ?? 'test-results/screens');
const shots = existsSync(screensDir) ? readdirSync(screensDir).filter((f) => f.endsWith('.png')) : [];

if (shots.length === 0) {
  console.log('eval:ui — STAGED (no screenshots yet). Rubric axes:', RUBRIC.join(', '));
  console.log('Will score live once screens exist (Sprint 1+). Exiting 0.');
  process.exit(0);
}

// Live scoring path is wired in Sprint 2 when the first real screens land.
console.log(`eval:ui — ${shots.length} screen(s) found. Live VLM scoring not yet enabled in Sprint 0.`);
process.exit(0);
