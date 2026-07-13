/**
 * Generates the golden fixture set for the Sprint 1 demo shot — ONCE, live, committed.
 * After this, the app + e2e run in replay (zero network) forever.
 *
 *   RECUT_MODE=live RECUT_BUDGET_USD=8 tsx scripts/gen-demo-fixtures.ts --confirm
 *
 * Produces: public/refs/mei.png, public/takes/<seed>.png, fixtures/<hash>.json (×4),
 * fixtures/demo-project.json. Rewrites each fixture's result imageUrl to the LOCAL take path
 * (the imageUrl is the cached RESULT, not part of the cache key) so replay renders offline.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Project, Shot } from '../lib/domain/types';
import { defaultCamera, defaultLight } from '../lib/domain/defaults';
import { compile } from '../lib/compiler/compile';
import { selectModel } from '../lib/gateway/router';
import { Gateway } from '../lib/gateway/jobs';
import { jobHash } from '../lib/gateway/hash';
import { BudgetGovernor } from '../lib/gateway/budget';
import { serializeImageGenerate } from '../serializers/dashscope';
import { dashscopeImageCall } from '../adapters/dashscope';
import { generateKeyframes } from '../lib/pipeline/keyframes';

const MEI = 'A 30-year-old East Asian woman, shoulder-length straight black hair, bright red wool scarf over a charcoal jacket, calm expression, photorealistic';

async function download(url: string, to: string): Promise<void> {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(to, buf);
}

async function main(): Promise<void> {
  if (process.env.RECUT_MODE !== 'live') throw new Error('RECUT_MODE must be live');
  if (!process.argv.includes('--confirm')) throw new Error('pass --confirm');
  const gov = new BudgetGovernor();
  if (gov.cap() === null) throw new Error('RECUT_BUDGET_USD must be set');

  mkdirSync(resolve('public/refs'), { recursive: true });
  mkdirSync(resolve('public/takes'), { recursive: true });
  mkdirSync(resolve('fixtures'), { recursive: true });

  // 1) canonical portrait via image.generate (qwen-image-plus)
  console.log('generating Mei portrait…');
  const genManifest = selectModel('image.generate');
  const portraitPayload = serializeImageGenerate(
    compile({
      shot: { id: 's', sceneId: 'sc', action: '', entityIds: [], camera: defaultCamera(), light: defaultLight(), takeIds: [] },
      bible: { version: 1, entities: [] },
      style: MEI,
    }),
  );
  gov.assertCanSpend(genManifest.cost.amount);
  const portrait = await dashscopeImageCall(genManifest.id, portraitPayload);
  gov.record(genManifest.cost.amount);
  await download(portrait.imageUrl, resolve('public/refs/mei.png'));
  console.log('  portrait saved to public/refs/mei.png');

  // 2) demo project — Mei's ref url is the live OSS portrait url (cache-key material; the
  //    committed take images are local, so replay never needs this url to be live).
  const shot: Shot = {
    id: 'shot1', sceneId: 'scene1', action: 'Mei looks up from the letter, catching the light',
    entityIds: ['mei'], camera: defaultCamera(), light: defaultLight(), takeIds: [],
  };
  const project: Project = {
    id: 'demo', title: 'The Letter',
    bible: {
      version: 1,
      entities: [{
        id: 'mei', kind: 'character', name: 'Mei', description: 'a woman in a red scarf',
        attributes: { hair: 'black bob', wardrobe: 'red wool scarf, charcoal jacket' },
        refs: [{ id: 'mei-front', url: portrait.imageUrl, weight: 1 }],
      }],
    },
    scenes: [{ id: 'scene1', title: 'Scene 1', shotIds: ['shot1'] }],
    shots: [shot], takes: [],
  };

  // 3) 4 keyframe candidates, live, captured as fixtures
  console.log('generating 4 keyframe candidates…');
  const gw = new Gateway({ mode: 'live', fixturesDir: resolve('fixtures'), governor: gov, captureFixtures: true });
  const takes = await generateKeyframes(project, shot, { gateway: gw });

  // 4) download each take locally + rewrite the fixture result imageUrl to the local path
  const manifest = selectModel('image.edit', 'quality', { minRefImages: 1 });
  for (const t of takes) {
    const seed = t.provenance.seed!;
    const local = `/takes/${seed}.png`;
    await download(t.assetUrl, resolve(`public${local}`));
    const compiled = compile({ shot, bible: project.bible, seed });
    const payload = manifest.serializer(compiled);
    const hash = jobHash(manifest.id, payload, seed);
    writeFileSync(
      join(resolve('fixtures'), `${hash}.json`),
      JSON.stringify({ hash, modelId: manifest.id, seed, costUsd: manifest.cost.amount, latencyMs: t.provenance.latencyMs, payload: { imageUrl: local } }, null, 2),
    );
    console.log(`  take seed ${seed} → public${local}`);
  }

  writeFileSync(resolve('fixtures/demo-project.json'), JSON.stringify(project, null, 2));
  console.log(`\ndone. spend $${gov.spent().toFixed(4)} / cap $${gov.cap()!.toFixed(2)}. fixtures + demo-project.json committed-ready.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
