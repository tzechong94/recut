// ============================================================================================
// ALIBABA CLOUD SERVICE INTEGRATION
// Recut's backend calls Alibaba Cloud Model Studio (DashScope) over HTTPS at
// https://dashscope-intl.aliyuncs.com (region ap-southeast-1, Singapore). Every AI capability in
// the product is an Alibaba Cloud model: qwen-image / qwen-image-edit (image), wan2.7-r2v /
// wan2.6-i2v (video), qwen-max (director), qwen3-vl-plus (continuity judge), qwen3-tts-flash
// (voice). Companion adapters: dashscope-text.ts (qwen-max) and dashscope-video.ts (Wan video +
// DashScope OSS upload). Model ids live in ../manifests/. Backend deployment: docs/DEPLOYMENT.md.
// ============================================================================================
//
// DashScope image adapter. The ONLY module that talks to the DashScope image endpoint over the
// wire. Invoked by the Gateway's `live` thunk. Sync image path (multimodal-generation): the
// endpoint returns the image url directly in output.choices[0].message.content.

import type { ProviderPayload } from '../lib/gateway/types';

export interface ImageResult {
  imageUrl: string;
  raw: unknown;
}

function base(): string {
  return (process.env.RECUT_DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/$/, '');
}

export class DashScopeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`dashscope ${status} ${code}: ${message}`);
    this.name = 'DashScopeError';
  }
}

export async function dashscopeImageCall(modelId: string, payload: ProviderPayload): Promise<ImageResult> {
  const key = process.env.RECUT_DASHSCOPE_API_KEY ?? '';
  if (!key) throw new DashScopeError(0, 'NoKey', 'RECUT_DASHSCOPE_API_KEY unset');
  const res = await fetch(`${base()}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, input: payload }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    output?: { choices?: Array<{ message?: { content?: unknown } }> };
  };
  if (!res.ok || body.code) {
    throw new DashScopeError(res.status, body.code ?? 'Unknown', String(body.message ?? '').slice(0, 200));
  }
  const content = body.output?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      const url = part && typeof part === 'object' ? (part as { image?: string }).image : undefined;
      if (typeof url === 'string') return { imageUrl: url, raw: body };
    }
  }
  throw new DashScopeError(res.status, 'NoImage', 'no image in response');
}
