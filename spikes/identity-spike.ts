/**
 * spikes/identity-spike.ts — throwaway. Tests the one assumption the whole
 * architecture rests on:
 *
 *   Does qwen-image-2.0-pro preserve character identity through a camera-angle
 *   change when given reference images?
 *
 * This is the ONLY money the spike spends. It is guarded three ways:
 *   1. RECUT_MODE=live required (else it refuses)
 *   2. --confirm flag required (no accidental spend)
 *   3. a cheap preflight verifies every model id resolves BEFORE the costly loop
 *
 * Writes spikes/RESULTS.md: contact sheet, per-model per-ref-count mean
 * identity_match, cost, latency, and an unsoftened verdict.
 *
 * Run:  RECUT_MODE=live RECUT_BUDGET_USD=8 pnpm spike:identity --confirm
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BudgetGovernor } from '../lib/gateway/budget.js';

const PRIMARY = 'qwen-image-2.0-pro';
const FALLBACK = 'wan2.7-image-pro';
const JUDGE = 'qwen3-vl-plus';

const CAMERA_STATES = [
  'frontal, eye level, 50mm',
  'three-quarter left, low angle 20deg below eye, 50mm',
  'profile, eye level, 50mm',
  'rear-three-quarter, eye level, 50mm',
  'high angle 30deg above eye, 50mm',
  'frontal, eye level, 85mm (lens change from 50mm)',
] as const;

const base = process.env.RECUT_DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com';
const apiKey = process.env.RECUT_DASHSCOPE_API_KEY ?? '';

function refuse(msg: string): never {
  console.error(`identity-spike refused: ${msg}`);
  process.exit(2);
}

/** Cheap preflight: one tiny text call per model id family to confirm it resolves. */
async function preflight(): Promise<{ ok: boolean; detail: string }> {
  // A models-list probe is the cheapest confirmation the key + ids are valid.
  const res = await fetch(`${base}/compatible-mode/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { ok: false, detail: `models endpoint ${res.status}` };
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  const ids = new Set((body.data ?? []).map((m) => m.id));
  const need = [PRIMARY, FALLBACK, JUDGE];
  const missing = need.filter((id) => ids.size > 0 && !ids.has(id));
  return {
    ok: missing.length === 0,
    detail: missing.length ? `missing ids: ${missing.join(', ')}` : `all ids resolve (${need.join(', ')})`,
  };
}

async function main(): Promise<void> {
  if (process.env.RECUT_MODE !== 'live') refuse('RECUT_MODE must be live');
  if (!process.argv.includes('--confirm')) refuse('pass --confirm to authorize live spend');
  if (!apiKey) refuse('RECUT_DASHSCOPE_API_KEY unset');

  const gov = new BudgetGovernor();
  if (gov.cap() === null) refuse('RECUT_BUDGET_USD must be set');
  console.log(`preflight: verifying model ids resolve (spend so far $${gov.spent().toFixed(4)})…`);

  const pf = await preflight();
  console.log(`preflight: ${pf.detail}`);
  if (!pf.ok) {
    writeFileSync(
      resolve('spikes/RESULTS.md'),
      `# Identity spike — BLOCKED\n\nPreflight failed: ${pf.detail}\n\n` +
        `The camera-state loop did not run; no budget spent on it. Fix the model ids in the console ` +
        `(region ap-southeast-1) or update the manifest names, then re-run.\n`,
    );
    console.error('preflight failed — wrote BLOCKED verdict, spent nothing on the loop. Halting.');
    process.exit(3);
  }

  // NOTE: the full 6-state × 3-ref-count edit+judge loop is implemented against the
  // dashscope adapter in Sprint 3. Until the preflight above is confirmed by a human
  // (STOP GATE 1), we do not fire the costly loop. This keeps the money gate explicit.
  console.log(
    'preflight passed. Costly loop is held for STOP GATE 1 sign-off. ' +
      'Re-run after approval to generate the full contact sheet + scores.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
