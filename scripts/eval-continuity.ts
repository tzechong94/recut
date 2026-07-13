/**
 * `pnpm eval:continuity` — runs the continuity critic over the committed fixtures, prints the
 * score matrix, and asserts: (1) 100% schema-valid verdicts, (2) the deliberate wardrobe break
 * drops wardrobe_match below 0.5, (3) auto-repair lifts the broken take back above threshold.
 * Entirely against fixtures — free, no network.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Gateway } from '../lib/gateway/jobs';
import { critique, CONTINUITY_THRESHOLD } from '../lib/agent/critic';

interface Case { name: string; takeUrl: string; refUrls: string[]; intent: string; expect: string }
const AXES = ['identity_match', 'wardrobe_match', 'prop_match', 'location_match', 'palette_match', 'framing_match'] as const;

async function main(): Promise<void> {
  const path = resolve('fixtures/continuity-cases.json');
  if (!existsSync(path)) {
    console.log('eval:continuity — STAGED (no continuity-cases.json yet).');
    process.exit(0);
  }
  const cases = JSON.parse(readFileSync(path, 'utf8')) as Case[];
  const gw = new Gateway({ mode: 'replay' });

  console.log('case             ' + AXES.map((a) => a.split('_')[0]!.padStart(8)).join('') + '   score verdict');
  const scored: Record<string, { score: number; verdict: string; wardrobe: number; valid: boolean }> = {};
  for (const c of cases) {
    const r = await critique(c.takeUrl, c.refUrls, c.intent, { gateway: gw });
    const row = AXES.map((a) => r.verdict[a].toFixed(2).padStart(8)).join('');
    console.log(c.name.padEnd(17) + row + `   ${r.score.toFixed(2)}  ${r.verdict.verdict}`);
    scored[c.name] = { score: r.score, verdict: r.verdict.verdict, wardrobe: r.verdict.wardrobe_match, valid: r.verdict.verdict !== 'unknown' };
  }

  const failures: string[] = [];
  // 1) 100% schema-valid
  const allValid = Object.values(scored).every((s) => s.valid);
  if (!allValid) failures.push('some verdicts were unparseable (unknown)');
  // 2) deliberate break drops wardrobe < 0.5
  const brk = scored['break-wardrobe'];
  if (!brk || brk.wardrobe >= 0.5) failures.push(`break wardrobe_match ${brk?.wardrobe} not < 0.5`);
  // 3) auto-repair lifts above threshold
  const good = scored['good'];
  const repaired = scored['repaired'];
  if (!good || good.score < CONTINUITY_THRESHOLD) failures.push('good take below threshold');
  if (!repaired || repaired.score < CONTINUITY_THRESHOLD) failures.push('repaired take did not recover above threshold');
  const repairLift = repaired && brk ? repaired.score - brk.score : 0;

  console.log(`\nschema-valid: ${allValid ? '100%' : 'FAIL'} · break wardrobe ${brk?.wardrobe.toFixed(2)} (<0.5) · repair lifted score +${repairLift.toFixed(2)} to ${repaired?.score.toFixed(2)} (≥${CONTINUITY_THRESHOLD})`);
  if (failures.length) {
    console.error('FAIL: ' + failures.join('; '));
    process.exit(1);
  }
  console.log('eval:continuity PASS — critic discriminates + auto-repair recovers.');
}

main().catch((e) => { console.error(e); process.exit(1); });
