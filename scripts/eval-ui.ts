/**
 * `pnpm eval:ui` — captures screenshots of every key screen (via a Playwright spec that uses
 * the managed webServer — reliable, no server races), judges each against the UI rubric with
 * qwen3-vl-plus, prints per-axis scores + the single highest-leverage fix. Live but pennies.
 *
 *   RECUT_MODE=live RECUT_BUDGET_USD=8 pnpm eval:ui
 *
 * Convergence loop (Sprint 7) reads "single_highest_leverage_fix" from test-results/eval-ui.json.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BudgetGovernor } from '../lib/gateway/budget';

const SCREENS = ['landing', 'produce', 'rig'] as const;
const AXES = ['visual_hierarchy', 'density', 'typography', 'node_legibility', 'state_clarity', 'craft', 'professional_trust'] as const;

const base = (process.env.RECUT_DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/$/, '');
const key = process.env.RECUT_DASHSCOPE_API_KEY ?? '';

type Scored = Record<string, number> & { worst_offender: string; single_highest_leverage_fix: string };

async function scoreScreen(name: string, pngPath: string, gov: BudgetGovernor): Promise<Scored> {
  const b64 = readFileSync(pngPath).toString('base64');
  const prompt =
    `You are a strict senior product designer reviewing a screenshot of the "${name}" screen of a ` +
    `professional AI film-production tool (Linear/Figma density, dark theme). Landing is a marketing page; ` +
    `produce and rig are tool screens. Score each axis 1-10 (for the landing page, judge node_legibility and ` +
    `state_clarity as N/A→8 since a marketing page has no nodes/states):\n` +
    AXES.map((a) => `- ${a}`).join('\n') +
    `\n\nReturn STRICT JSON with each axis as a numeric key plus "worst_offender": str and ` +
    `"single_highest_leverage_fix": str. JSON only, no prose.`;
  gov.assertCanSpend(0.005);
  const res = await fetch(`${base}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen3-vl-plus', input: { messages: [{ role: 'user', content: [{ image: `data:image/png;base64,${b64}` }, { text: prompt }] }] } }),
  });
  const body = (await res.json()) as { code?: string; message?: string; output?: { choices?: Array<{ message?: { content?: unknown } }> } };
  if (!res.ok || body.code) throw new Error(`vl ${res.status} ${body.code}: ${String(body.message).slice(0, 120)}`);
  gov.record(0.005);
  const content = body.output?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((p) => (p as { text?: string }).text ?? '').join(' ') : String(content ?? '');
  return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Scored;
}

async function main(): Promise<void> {
  const gov = new BudgetGovernor();
  if (process.env.RECUT_MODE !== 'live' || !key || gov.cap() === null) {
    console.log('eval:ui — needs RECUT_MODE=live + RECUT_DASHSCOPE_API_KEY + RECUT_BUDGET_USD. Skipping (STAGED).');
    process.exit(0);
  }

  console.log('capturing screenshots via Playwright…');
  const cap = spawnSync('pnpm', ['exec', 'playwright', 'test', 'test/e2e/screens.spec.ts'], { cwd: resolve('.'), stdio: 'inherit', env: { ...process.env, RECUT_MODE: 'replay' } });
  if (cap.status !== 0) throw new Error('screenshot capture failed');

  const results: Record<string, Scored> = {};
  let sum = 0;
  for (const name of SCREENS) {
    const png = resolve('test-results/screens', `${name}.png`);
    if (!existsSync(png)) throw new Error(`missing screenshot ${png}`);
    const r = await scoreScreen(name, png, gov);
    results[name] = r;
    const mean = AXES.reduce((x, a) => x + Number(r[a] ?? 0), 0) / AXES.length;
    sum += mean;
    console.log(`\n[${name}] mean ${mean.toFixed(2)}  ${AXES.map((a) => `${a}=${r[a]}`).join(' ')}`);
    console.log(`  fix: ${r.single_highest_leverage_fix}`);
  }
  const overall = sum / SCREENS.length;
  writeFileSync(resolve('test-results/eval-ui.json'), JSON.stringify({ overall, results }, null, 2));
  console.log(`\n=== overall UI mean ${overall.toFixed(2)} (gate ≥ 7) — ${overall >= 7 ? 'PASS' : 'BELOW'} ===  spend $${gov.spent().toFixed(4)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
