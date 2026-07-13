/**
 * spikes/identity-spike.ts — throwaway. Tests the one assumption the whole
 * architecture rests on:
 *
 *   Does reference-image editing preserve character identity through a
 *   camera-angle change?
 *
 * Preflight (2026-07-13, intl key ap-southeast-1) found the plan's named image
 * models absent: `qwen-image-2.0-pro` and `wan2.7-image-pro` return empty. The
 * CAPABILITY is present via `qwen-image-edit` (validated in the recut Python repo),
 * with `qwen3-vl-plus` as judge. Model ids are a manifest concern (Sprint 3); the
 * spike tests the capability. So: primary path = qwen-image-edit.
 *
 * Guards: RECUT_MODE=live + --confirm + a working key. Spend is tracked through the
 * BudgetGovernor and capped by RECUT_BUDGET_USD (no overrun possible).
 *
 * Run: RECUT_MODE=live RECUT_BUDGET_USD=8 pnpm spike:identity --confirm
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BudgetGovernor } from '../lib/gateway/budget';

const BASE = (process.env.RECUT_DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/$/, '');
const KEY = process.env.RECUT_DASHSCOPE_API_KEY ?? '';
const MM = `${BASE}/services/aigc/multimodal-generation/generation`;

const T2I = 'qwen-image-plus'; // canonical portrait
const EDIT = 'qwen-image-edit'; // identity-preserving re-render (primary path under test)
const JUDGE = 'qwen3-vl-plus';

// cost estimates (USD) — conservative, only for the governor. Real invoice may differ.
const COST = { image: 0.05, judge: 0.005 };

const CHARACTER =
  'A 30-year-old East Asian woman, shoulder-length straight black hair, wearing a bright red wool scarf ' +
  'over a charcoal-grey wool jacket, calm neutral expression, photorealistic studio portrait, even soft ' +
  'lighting, plain light-grey seamless background';

const CAMERA_STATES: { name: string; instruction: string }[] = [
  { name: 'frontal-eye-50mm', instruction: 'medium close-up, frontal view, eye level, 50mm lens' },
  { name: 'three-quarter-left-low-50mm', instruction: 'medium shot, three-quarter left profile, low angle 20 degrees below eye level, 50mm lens' },
  { name: 'profile-eye-50mm', instruction: 'medium close-up, full side profile, eye level, 50mm lens' },
  { name: 'rear-three-quarter-50mm', instruction: 'medium shot, rear three-quarter view from behind the shoulder, eye level, 50mm lens' },
  { name: 'high-angle-30-50mm', instruction: 'medium close-up, high angle 30 degrees above eye level looking down, 50mm lens' },
  { name: 'frontal-85mm-shallow', instruction: 'close-up, frontal view, eye level, 85mm portrait lens, shallow depth of field, background falls into soft bokeh' },
];

const gov = new BudgetGovernor();

function refuse(msg: string): never {
  console.error(`identity-spike refused: ${msg}`);
  process.exit(2);
}

async function mm(model: string, content: unknown[], costUsd: number): Promise<Record<string, unknown>> {
  gov.assertCanSpend(costUsd);
  const res = await fetch(MM, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: { messages: [{ role: 'user', content }] } }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || (body as { code?: string }).code) {
    throw new Error(`${model} ${res.status} ${(body as { code?: string }).code ?? ''}: ${String((body as { message?: string }).message ?? '').slice(0, 160)}`);
  }
  gov.record(costUsd); // only count successful, billable calls
  return body;
}

function imageFromOutput(body: Record<string, unknown>): string {
  const choices = (body.output as { choices?: Array<{ message?: { content?: unknown } }> })?.choices ?? [];
  const content = choices[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as { image?: string }).image === 'string') {
        return (part as { image: string }).image;
      }
    }
  }
  throw new Error('no image in output');
}

function textFromOutput(body: Record<string, unknown>): string {
  const choices = (body.output as { choices?: Array<{ message?: { content?: unknown } }> })?.choices ?? [];
  const content = choices[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && typeof p === 'object' ? String((p as { text?: string }).text ?? '') : '')).join(' ');
  }
  return '';
}

function parseJson(text: string): Record<string, unknown> {
  const t = text.trim().replace(/^```json\s*|^```\s*|```$/g, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`no JSON in judge reply: ${text.slice(0, 80)}`);
  return JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
}

async function genReference(seed: number): Promise<string> {
  const body = await mm(T2I, [{ text: `${CHARACTER}. Frontal passport-style headshot. Seed ${seed}.` }], COST.image);
  return imageFromOutput(body);
}

async function editToState(refs: string[], instruction: string): Promise<string> {
  const content = [
    ...refs.map((u) => ({ image: u })),
    {
      text:
        `Re-render the SAME person from the reference image(s): identical face, identical hairstyle, ` +
        `identical red scarf and charcoal jacket. Change ONLY the camera framing and angle to: ${instruction}. ` +
        `Photorealistic. Do not change identity, wardrobe, or colours.`,
    },
  ];
  const body = await mm(EDIT, content, COST.image);
  return imageFromOutput(body);
}

interface Verdict { identity_match: number; wardrobe_match: number; artifacts: string[]; verdict: string }

async function judge(refUrl: string, candUrl: string): Promise<Verdict> {
  const prompt =
    'Image 1 is a locked character reference. Image 2 is a generated shot meant to be the SAME person from a ' +
    'different camera angle. Return STRICT JSON {"identity_match": 0..1, "wardrobe_match": 0..1, "artifacts": [strings], ' +
    '"verdict": "pass|repair|reject"}. identity_match = how certainly the same individual (face, bone structure, hair); ' +
    'wardrobe_match = same red scarf + charcoal jacket, same colours; artifacts = visible defects. 1 = identical person.';
  const body = await mm(JUDGE, [{ image: refUrl }, { image: candUrl }, { text: prompt }], COST.judge);
  const d = parseJson(textFromOutput(body));
  return {
    identity_match: Number(d.identity_match ?? 0),
    wardrobe_match: Number(d.wardrobe_match ?? 0),
    artifacts: Array.isArray(d.artifacts) ? (d.artifacts as string[]) : [],
    verdict: String(d.verdict ?? 'unknown'),
  };
}

async function main(): Promise<void> {
  if (process.env.RECUT_MODE !== 'live') refuse('RECUT_MODE must be live');
  if (!process.argv.includes('--confirm')) refuse('pass --confirm to authorize live spend');
  if (!KEY) refuse('RECUT_DASHSCOPE_API_KEY unset');
  if (gov.cap() === null) refuse('RECUT_BUDGET_USD must be set');

  const outDir = resolve('spikes/out');
  mkdirSync(outDir, { recursive: true });
  console.log(`spike start — cap $${gov.cap()!.toFixed(2)}, spent so far $${gov.spent().toFixed(4)}`);

  // 3 references of the same character (subsets test whether more refs help identity).
  console.log('generating 3 reference portraits…');
  const refs: string[] = [];
  for (const seed of [11, 22, 33]) {
    const url = await genReference(seed);
    refs.push(url);
    console.log(`  ref${refs.length}: ok`);
  }
  const anchor = refs[0]!;

  const rows: Array<{ state: string; refCount: number; url: string | null; v: Verdict | null; err?: string }> = [];
  for (const refCount of [1, 2, 3]) {
    const useRefs = refs.slice(0, refCount);
    for (const state of CAMERA_STATES) {
      try {
        const out = await editToState(useRefs, state.instruction);
        const v = await judge(anchor, out);
        rows.push({ state: state.name, refCount, url: out, v });
        console.log(`  [${refCount}ref] ${state.name}: id=${v.identity_match.toFixed(2)} wd=${v.wardrobe_match.toFixed(2)} ${v.verdict}`);
      } catch (err) {
        rows.push({ state: state.name, refCount, url: null, v: null, err: String(err).slice(0, 160) });
        console.log(`  [${refCount}ref] ${state.name}: ERROR ${String(err).slice(0, 120)}`);
      }
    }
  }

  // aggregate mean identity_match per ref-count (never fake-pass: nulls excluded, counted as coverage gaps)
  const byRef = [1, 2, 3].map((rc) => {
    const scored = rows.filter((r) => r.refCount === rc && r.v);
    const mean = scored.length ? scored.reduce((a, r) => a + r.v!.identity_match, 0) / scored.length : 0;
    const wd = scored.length ? scored.reduce((a, r) => a + r.v!.wardrobe_match, 0) / scored.length : 0;
    return { rc, n: scored.length, mean, wd };
  });

  const best = byRef.reduce((a, b) => (b.mean > a.mean ? b : a), byRef[0]!);
  const holds = best.mean >= 0.8;
  const verdict = holds
    ? `HOLDS. Best mean identity_match = ${best.mean.toFixed(2)} at ${best.rc} reference image(s) (n=${best.n}/6), ` +
      `at or above the 0.8 bar. Reference-based identity preservation through camera-angle changes is viable on ` +
      `qwen-image-edit. The Series Bible premise stands. Model-id note: the plan's qwen-image-2.0-pro / wan2.7-image-pro ` +
      `are absent on this intl key — use qwen-image-edit in the image.edit manifest (Sprint 3).`
    : `DOES NOT HOLD at the 0.8 bar. Best mean identity_match = ${best.mean.toFixed(2)} at ${best.rc} ref(s) (n=${best.n}/6). ` +
      `Reference-based editing on qwen-image-edit did not preserve identity strongly enough. Before building the Bible on ` +
      `this assumption, revisit: stronger multi-ref conditioning, a dedicated character-consistent model, or a shape change.`;

  const table = byRef.map((b) => `| ${b.rc} | ${b.n}/6 | ${b.mean.toFixed(3)} | ${b.wd.toFixed(3)} |`).join('\n');
  const contact = rows
    .map((r) => `- [${r.refCount}ref] ${r.state}: ${r.url ? `id=${r.v!.identity_match.toFixed(2)} wd=${r.v!.wardrobe_match.toFixed(2)} ${r.v!.verdict} — ${r.url.slice(0, 90)}…` : `ERROR ${r.err}`}`)
    .join('\n');

  const md =
    `# Identity spike — results (live, intl key ap-southeast-1)\n\n` +
    `**Assumption tested:** does reference-image editing preserve character identity through a camera-angle change?\n\n` +
    `**Models:** portrait \`${T2I}\`, edit \`${EDIT}\` (primary path — the plan's \`qwen-image-2.0-pro\`/\`wan2.7-image-pro\` ` +
    `are ABSENT on this key), judge \`${JUDGE}\`.\n\n` +
    `## Mean identity_match by reference count\n\n| refs | scored | mean identity | mean wardrobe |\n|---|---|---|---|\n${table}\n\n` +
    `**Spend this run: ~$${gov.spent().toFixed(4)} (cap $${gov.cap()!.toFixed(2)}).**\n\n` +
    `## Verdict\n\n${verdict}\n\n## Contact sheet (state → score, output url)\n\n${contact}\n`;

  writeFileSync(resolve('spikes/RESULTS.md'), md);
  console.log(`\nWROTE spikes/RESULTS.md — ${holds ? 'HOLDS' : 'DOES NOT HOLD'} (best mean ${best.mean.toFixed(2)}). Spent ~$${gov.spent().toFixed(4)}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
