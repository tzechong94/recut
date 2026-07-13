/**
 * Generates continuity-critic fixtures — ONCE, live, committed. Proves the critic discriminates
 * on REAL images and that auto-repair works:
 *   good    = the accepted take (red scarf) vs the red-scarf reference   → high, pass
 *   break   = the same take with scarf edited to BLUE  vs red reference  → wardrobe_match < 0.5
 *   repaired= the blue take repaired back to red        vs red reference → high, pass
 *
 * Local image PATHS are the cache keys (stable, committed); the live calls send base64, so
 * eval:continuity replays fully offline.
 *
 *   RECUT_MODE=live RECUT_BUDGET_USD=8 tsx scripts/gen-continuity-fixtures.ts --confirm
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BudgetGovernor } from '../lib/gateway/budget';
import { Gateway } from '../lib/gateway/jobs';
import { critique } from '../lib/agent/critic';

const base = (process.env.RECUT_DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/$/, '');
const key = process.env.RECUT_DASHSCOPE_API_KEY ?? '';
const MM = `${base}/services/aigc/multimodal-generation/generation`;

function dataUri(localPath: string): string {
  const bytes = readFileSync(resolve('public', localPath.replace(/^\//, '')));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/** image.edit with local images sent as base64. Returns the produced image URL. */
async function edit(localImages: string[], instruction: string, gov: BudgetGovernor): Promise<string> {
  gov.assertCanSpend(0.05);
  const content = [...localImages.map((p) => ({ image: dataUri(p) })), { text: instruction }];
  const res = await fetch(MM, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'qwen-image-edit', input: { messages: [{ role: 'user', content }] } }) });
  const body = (await res.json()) as { code?: string; message?: string; output?: { choices?: Array<{ message?: { content?: unknown } }> } };
  if (!res.ok || body.code) throw new Error(`edit ${res.status} ${body.code}: ${String(body.message).slice(0, 120)}`);
  gov.record(0.05);
  const parts = body.output?.choices?.[0]?.message?.content;
  const url = Array.isArray(parts) ? (parts.find((p) => (p as { image?: string }).image) as { image?: string })?.image : undefined;
  if (!url) throw new Error('edit returned no image');
  return url;
}

async function download(url: string, toLocal: string): Promise<void> {
  const r = await fetch(url);
  writeFileSync(resolve('public', toLocal.replace(/^\//, '')), Buffer.from(await r.arrayBuffer()));
}

/** VL call that turns local-path image parts into base64 before sending. Returns raw text. */
async function vlFn(payload: Record<string, unknown>, gov: BudgetGovernor): Promise<string> {
  const messages = (payload.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>).map((m) => ({
    role: m.role,
    content: m.content.map((part) => (typeof part.image === 'string' ? { image: dataUri(part.image) } : part)),
  }));
  gov.assertCanSpend(0.005);
  const res = await fetch(MM, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'qwen3-vl-plus', input: { messages } }) });
  const body = (await res.json()) as { code?: string; message?: string; output?: { choices?: Array<{ message?: { content?: unknown } }> } };
  if (!res.ok || body.code) throw new Error(`vl ${res.status} ${body.code}: ${String(body.message).slice(0, 120)}`);
  gov.record(0.005);
  const c = body.output?.choices?.[0]?.message?.content;
  return Array.isArray(c) ? c.map((p) => (p as { text?: string }).text ?? '').join(' ') : String(c ?? '');
}

async function main(): Promise<void> {
  if (process.env.RECUT_MODE !== 'live' || !process.argv.includes('--confirm')) throw new Error('need RECUT_MODE=live --confirm');
  const gov = new BudgetGovernor();
  if (gov.cap() === null) throw new Error('set RECUT_BUDGET_USD');
  mkdirSync(resolve('fixtures/critic'), { recursive: true });

  const REF = '/refs/mei.png';
  const GOOD = '/takes/1000.png';
  const intent = 'Mei looks up from the letter — same identity, red scarf, charcoal jacket';

  console.log('1/3 editing the good take → BLUE scarf (deliberate wardrobe break)…');
  const blueUrl = await edit([GOOD], 'Change ONLY the scarf colour from red to BLUE. Keep the same person, face, pose, jacket, and background identical.', gov);
  await download(blueUrl, '/takes/blue.png');

  console.log('2/3 repairing the blue take → back to RED…');
  const repairedUrl = await edit(['/takes/blue.png'], 'Change ONLY the scarf colour from blue back to RED wool. Keep the same person, face, pose, jacket, and background identical.', gov);
  await download(repairedUrl, '/takes/repaired.png');

  const cases = [
    { name: 'good', takeUrl: GOOD, refUrls: [REF], intent, expect: 'pass' },
    { name: 'break-wardrobe', takeUrl: '/takes/blue.png', refUrls: [REF], intent, expect: 'wardrobe<0.5' },
    { name: 'repaired', takeUrl: '/takes/repaired.png', refUrls: [REF], intent, expect: 'pass' },
  ];

  console.log('3/3 critiquing all three (captured as fixtures)…');
  const gw = new Gateway({ mode: 'live', fixturesDir: resolve('fixtures'), governor: gov, captureFixtures: true });
  for (const c of cases) {
    const r = await critique(c.takeUrl, c.refUrls, c.intent, { gateway: gw, vlFn: (p) => vlFn(p, gov) });
    console.log(`  ${c.name}: score ${r.score.toFixed(2)} wardrobe ${r.verdict.wardrobe_match.toFixed(2)} verdict ${r.verdict.verdict}`);
  }

  writeFileSync(resolve('fixtures/continuity-cases.json'), JSON.stringify(cases, null, 2));
  console.log(`\ndone. spend $${gov.spent().toFixed(4)}/$${gov.cap()!.toFixed(2)}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
