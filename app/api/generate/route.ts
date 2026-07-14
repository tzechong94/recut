import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BudgetGovernor } from '../../../lib/gateway/budget';
import { dashscopeImageCall } from '../../../adapters/dashscope';
import { selectModel } from '../../../lib/gateway/router';
import { CRITIC_MODEL_ID } from '../../../manifests/qwen-vl-critic';
import { buildCritiquePayload, parseVerdict, continuityScore } from '../../../lib/agent/critic';
import { buildKenBurnsArgs } from '../../../lib/post/export';
import { submitI2V, pollI2V } from '../../../adapters/dashscope-video';
import { WAN_I2V, I2V_MODEL_ID } from '../../../manifests/wan-i2v';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  kind: 'text2image' | 'edit' | 'video' | 'critique';
  prompt?: string;
  image?: string; // data URI or http(s) url — the primary input
  refs?: string[]; // reference images for critique
  negative?: string;
}

const NEGATIVE = 'lowres, deformed, extra fingers, watermark, text';

/** Materialise a data-URI or remote url to a local temp file (for ffmpeg). */
async function toLocalFile(image: string): Promise<string> {
  const dir = mkdtemp();
  const out = join(dir, `in-${randomUUID()}.png`);
  if (image.startsWith('data:')) {
    writeFileSync(out, Buffer.from(image.split(',')[1] ?? '', 'base64'));
  } else {
    const r = await fetch(image);
    writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  }
  return out;
}
function mkdtemp(): string {
  const d = join(tmpdir(), `recut-gen-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

export async function POST(req: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  if (!process.env.RECUT_DASHSCOPE_API_KEY) {
    return Response.json({ error: 'server not in live mode (RECUT_DASHSCOPE_API_KEY unset)' }, { status: 501 });
  }
  const gov = new BudgetGovernor();

  try {
    if (body.kind === 'text2image') {
      const model = selectModel('image.generate').id;
      const cost = selectModel('image.generate').cost.amount;
      gov.assertCanSpend(cost);
      const payload = { messages: [{ role: 'user', content: [{ text: `${body.prompt ?? ''}. Avoid: ${body.negative ?? NEGATIVE}.` }] }] };
      const r = await dashscopeImageCall(model, payload);
      gov.record(cost);
      return Response.json({ imageUrl: r.imageUrl, spentUsd: gov.spent() });
    }

    if (body.kind === 'edit') {
      if (!body.image) return Response.json({ error: 'edit needs an input image' }, { status: 400 });
      const model = selectModel('image.edit', 'quality', { minRefImages: 1 }).id;
      const cost = selectModel('image.edit', 'quality', { minRefImages: 1 }).cost.amount;
      gov.assertCanSpend(cost);
      const payload = { messages: [{ role: 'user', content: [{ image: body.image }, { text: body.prompt ?? 'edit the image' }] }] };
      const r = await dashscopeImageCall(model, payload);
      gov.record(cost);
      return Response.json({ imageUrl: r.imageUrl, spentUsd: gov.spent() });
    }

    if (body.kind === 'video') {
      if (!body.image) return Response.json({ error: 'video needs an input image' }, { status: 400 });
      const genDir = resolve(process.cwd(), 'public/generated');
      mkdirSync(genDir, { recursive: true });
      const name = `${randomUUID()}.mp4`;
      const outPath = join(genDir, name);

      // True image-to-video (wan2.6-i2v) when the input is a fetchable URL (generated nodes
      // produce OSS urls). Uploaded data-URIs can't be fetched by the model → Ken Burns fallback.
      if (/^https?:\/\//.test(body.image)) {
        const durationSec = 3;
        const cost = WAN_I2V.cost.amount * durationSec;
        gov.assertCanSpend(cost);
        const prompt = body.prompt?.trim() || 'subtle natural motion, gentle camera push-in, cinematic, vertical 9:16';
        const taskId = await submitI2V(I2V_MODEL_ID, body.image, prompt, { durationSec, resolution: '720P' });
        const remoteUrl = await pollI2V(taskId);
        gov.record(cost);
        const dl = await fetch(remoteUrl);
        writeFileSync(outPath, Buffer.from(await dl.arrayBuffer()));
        return Response.json({ videoUrl: `/generated/${name}`, spentUsd: gov.spent() });
      }

      if (spawnSync('ffmpeg', ['-version']).status !== 0) return Response.json({ error: 'ffmpeg unavailable' }, { status: 501 });
      const local = await toLocalFile(body.image);
      const rc = spawnSync('ffmpeg', buildKenBurnsArgs(local, outPath, 3), { stdio: 'ignore' });
      if (rc.status !== 0 || !existsSync(outPath)) return Response.json({ error: 'ffmpeg failed' }, { status: 500 });
      return Response.json({ videoUrl: `/generated/${name}`, spentUsd: gov.spent() });
    }

    if (body.kind === 'critique') {
      if (!body.image) return Response.json({ error: 'critique needs an image' }, { status: 400 });
      const refs = body.refs?.length ? body.refs : [body.image];
      const payload = buildCritiquePayload(body.image, refs, body.prompt ?? 'the shot');
      gov.assertCanSpend(0.005);
      // the critic returns JSON text (not an image), so call the VL endpoint directly
      const res = await fetch(`${(process.env.RECUT_DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/$/, '')}/services/aigc/multimodal-generation/generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RECUT_DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: CRITIC_MODEL_ID, input: payload }),
      });
      const j = (await res.json()) as { output?: { choices?: Array<{ message?: { content?: unknown } }> } };
      gov.record(0.005);
      const content = j.output?.choices?.[0]?.message?.content;
      const text = Array.isArray(content) ? content.map((p) => (p as { text?: string }).text ?? '').join(' ') : String(content ?? '');
      const verdict = parseVerdict(text);
      return Response.json({ verdict, score: continuityScore(verdict), spentUsd: gov.spent() });
    }

    return Response.json({ error: 'unknown kind' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
