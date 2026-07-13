import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * `pnpm eval:continuity` — runs the continuity critic over the fixture takes, prints
 * the score matrix, and asserts the deliberate-break tests fail correctly. Runs
 * entirely against committed fixtures — free, no network.
 *
 * Sprint 0 status: fixtures aren't generated until the live spike (0.4). With no
 * critic fixtures this reports STAGED and exits 0. The real score-matrix + break
 * assertions land in Sprint 5.
 */
const fixturesDir = resolve(process.env.RECUT_FIXTURES_DIR ?? 'fixtures');
const criticDir = join(fixturesDir, 'critic');
const critics = existsSync(criticDir) ? readdirSync(criticDir).filter((f) => f.endsWith('.json')) : [];

if (critics.length === 0) {
  console.log('eval:continuity — STAGED (no critic fixtures yet). Will score the matrix in Sprint 5.');
  process.exit(0);
}

let schemaValid = 0;
for (const f of critics) {
  const v = JSON.parse(readFileSync(join(criticDir, f), 'utf8'));
  if (typeof v.identity_match === 'number' && typeof v.verdict === 'string') schemaValid++;
}
console.log(`eval:continuity — ${schemaValid}/${critics.length} critic fixtures schema-valid.`);
process.exit(schemaValid === critics.length ? 0 : 1);
