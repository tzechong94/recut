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
import { submitI2V } from '../../../adapters/dashscope-video';
import { WAN_I2V, I2V_MODEL_ID } from '../../../manifests/wan-i2v';
import { TTS_MODEL_ID } from '../../../manifests/qwen-tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  kind: 'text2image' | 'edit' | 'compose' | 'inpaint' | 'video' | 'critique' | 'dialogue';
  prompt?: string;
  image?: string; // data URI or http(s) url — the primary input
  images?: string[]; // multiple inputs (compose)
  refs?: string[]; // reference images for critique
  styleRef?: string; // the project's Style Anchor — injected so every shot shares one look
  negative?: string;
  seed?: number;
  aspect?: string;
  voice?: string;
  /** i2v clip length in seconds (clamped 3-10); billed per second */
  duration?: number;
}

const NEGATIVE = 'lowres, deformed, extra fingers, watermark, text';
const STYLE_MATCH = 'Match the EXACT art style, rendering technique, colour palette, and lighting of the STYLE reference image.';

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
      const aspectHint = body.aspect === '9:16' ? ' vertical 9:16 composition,' : body.aspect === '16:9' ? ' widescreen 16:9 composition,' : '';
      // With a Style Anchor, render THROUGH the edit model so the new scene actually inherits the
      // reference's look (a text style description alone drifts shot-to-shot).
      if (body.styleRef) {
        const manifest = selectModel('image.edit', 'quality', { minRefImages: 1 });
        gov.assertCanSpend(manifest.cost.amount);
        const instruction = `${STYLE_MATCH} Do NOT copy the reference's subject or composition — render a completely NEW image of: ${body.prompt ?? ''}.${aspectHint} Avoid: ${body.negative ?? NEGATIVE}.`;
        const payload = { messages: [{ role: 'user', content: [{ image: body.styleRef }, { text: instruction }] }] };
        const r = await dashscopeImageCall(manifest.id, payload);
        gov.record(manifest.cost.amount);
        return Response.json({ imageUrl: r.imageUrl, spentUsd: gov.spent(), capUsd: gov.cap() });
      }
      const manifest = selectModel('image.generate');
      gov.assertCanSpend(manifest.cost.amount);
      const payload = { messages: [{ role: 'user', content: [{ text: `${body.prompt ?? ''}.${aspectHint} Avoid: ${body.negative ?? NEGATIVE}.` }] }] };
      const r = await dashscopeImageCall(manifest.id, payload);
      gov.record(manifest.cost.amount);
      return Response.json({ imageUrl: r.imageUrl, spentUsd: gov.spent(), capUsd: gov.cap() });
    }

    // Consistency directive: the #1 lever for character/style consistency across shots is telling
    // the edit model to PRESERVE the reference exactly and only change what's asked.
    const KEEP = 'CRITICAL: keep the character(s) from the reference image(s) EXACTLY — identical face, ' +
      'body proportions, colours, wardrobe, and art style. Do not restyle or redraw them.';

    if (body.kind === 'edit' || body.kind === 'inpaint') {
      if (!body.image) return Response.json({ error: `${body.kind} needs an input image` }, { status: 400 });
      // edit inherits the Style Anchor as a second reference (inpaint stays a local region edit)
      const useStyle = body.kind === 'edit' && !!body.styleRef && body.styleRef !== body.image;
      const manifest = selectModel('image.edit', 'quality', { minRefImages: useStyle ? 2 : 1 });
      gov.assertCanSpend(manifest.cost.amount);
      const instruction = body.kind === 'inpaint'
        ? `In the described region only, ${body.prompt ?? 'edit'}. Leave the rest of the image unchanged. ${KEEP}`
        : `${KEEP} Change only the scene, pose, and framing as follows: ${body.prompt ?? 'edit the image'}.${useStyle ? ` ${STYLE_MATCH} (The style reference is the LAST image.)` : ''}`;
      const content = useStyle
        ? [{ image: body.image }, { image: body.styleRef! }, { text: instruction }]
        : [{ image: body.image }, { text: instruction }];
      const payload = { messages: [{ role: 'user', content }] };
      const r = await dashscopeImageCall(manifest.id, payload);
      gov.record(manifest.cost.amount);
      return Response.json({ imageUrl: r.imageUrl, spentUsd: gov.spent(), capUsd: gov.cap() });
    }

    if (body.kind === 'compose') {
      const allImgs = body.images ?? [];
      if (allImgs.length < 2) return Response.json({ error: 'compose needs 2+ connected image inputs' }, { status: 400 });
      // reserve one of the 3 ref slots for the Style Anchor when present (cap characters at 2)
      const useStyle = !!body.styleRef && !allImgs.includes(body.styleRef);
      const chars = useStyle ? allImgs.slice(0, 2) : allImgs.slice(0, 3);
      const refImgs = useStyle ? [...chars, body.styleRef!] : chars;
      const manifest = selectModel('image.edit', 'quality', { minRefImages: refImgs.length });
      gov.assertCanSpend(manifest.cost.amount);
      const instruction = `Compose the characters from the reference images into ONE coherent scene. ${KEEP} ${useStyle ? `${STYLE_MATCH} (The LAST image is the style reference.) ` : ''}Scene: ${body.prompt ?? 'the characters together in one scene'}`;
      const payload = { messages: [{ role: 'user', content: [...refImgs.map((i) => ({ image: i })), { text: instruction }] }] };
      const r = await dashscopeImageCall(manifest.id, payload);
      gov.record(manifest.cost.amount);
      return Response.json({ imageUrl: r.imageUrl, spentUsd: gov.spent(), capUsd: gov.cap() });
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
        // async job: submit now, charge on submit, return the task id — the client polls
        // /api/generate/status so the 1-3 min render never blocks the request.
        const durationSec = Math.max(3, Math.min(10, Math.round(body.duration ?? 3)));
        const cost = WAN_I2V.cost.amount * durationSec;
        gov.assertCanSpend(cost);
        const prompt = body.prompt?.trim() || 'subtle natural motion, gentle camera push-in, cinematic, vertical 9:16';
        const taskId = await submitI2V(I2V_MODEL_ID, body.image, prompt, { durationSec, resolution: '720P' });
        gov.record(cost);
        return Response.json({ taskId, spentUsd: gov.spent(), capUsd: gov.cap() });
      }

      if (spawnSync('ffmpeg', ['-version']).status !== 0) return Response.json({ error: 'ffmpeg unavailable' }, { status: 501 });
      const local = await toLocalFile(body.image);
      const rc = spawnSync('ffmpeg', buildKenBurnsArgs(local, outPath, 3), { stdio: 'ignore' });
      if (rc.status !== 0 || !existsSync(outPath)) return Response.json({ error: 'ffmpeg failed' }, { status: 500 });
      return Response.json({ videoUrl: `/generated/${name}`, spentUsd: gov.spent(), capUsd: gov.cap() });
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
      return Response.json({ verdict, score: continuityScore(verdict), spentUsd: gov.spent(), capUsd: gov.cap() });
    }

    if (body.kind === 'dialogue') {
      const text = body.prompt?.trim();
      if (!text) return Response.json({ error: 'dialogue needs a line of text' }, { status: 400 });
      const voice = body.voice || 'Cherry';
      gov.assertCanSpend(0.002);
      const res = await fetch(`${(process.env.RECUT_DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/$/, '')}/services/aigc/multimodal-generation/generation`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RECUT_DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: TTS_MODEL_ID, input: { text, voice } }),
      });
      const j = (await res.json()) as { code?: string; message?: string; output?: { audio?: { url?: string } } };
      if (!res.ok || j.code || !j.output?.audio?.url) {
        return Response.json({ error: `tts ${res.status} ${j.code ?? ''}: ${String(j.message ?? 'no audio').slice(0, 120)}` }, { status: 500 });
      }
      gov.record(0.002);
      // download for durability (the hosted url is short-lived)
      const genDir = resolve(process.cwd(), 'public/generated');
      mkdirSync(genDir, { recursive: true });
      const name = `${randomUUID()}.wav`;
      const dl = await fetch(j.output.audio.url);
      writeFileSync(join(genDir, name), Buffer.from(await dl.arrayBuffer()));
      return Response.json({ audioUrl: `/generated/${name}`, spentUsd: gov.spent(), capUsd: gov.cap() });
    }

    return Response.json({ error: 'unknown kind' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e).slice(0, 200) }, { status: 500 });
  }
}
