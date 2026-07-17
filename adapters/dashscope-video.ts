// DashScope async image-to-video adapter (submit + poll). The video endpoint is asynchronous:
// submit returns a task_id, then poll /tasks/{id} until SUCCEEDED for the video_url. Model id is
// passed in (it lives in the manifest, never here).

/** Upload a local file to DashScope's hosting; returns an oss:// url the models CAN read
 *  (localhost is unreachable to them; public OSS links expire). Ported from the proven v2 impl. */
export async function uploadToDashscope(modelId: string, bytes: Buffer, filename: string, mime: string): Promise<string> {
  const key = process.env.RECUT_DASHSCOPE_API_KEY ?? '';
  if (!key) throw new VideoGenError('RECUT_DASHSCOPE_API_KEY unset');
  const r = await fetch(`${base()}/uploads?action=getPolicy&model=${encodeURIComponent(modelId)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const d = (await r.json().catch(() => ({}))) as { data?: Record<string, string> };
  const p = d.data;
  if (!r.ok || !p?.upload_host) throw new VideoGenError(`getPolicy failed: ${JSON.stringify(d).slice(0, 160)}`);
  const objKey = `${p.upload_dir}/${filename}`;
  const form = new FormData();
  form.set('OSSAccessKeyId', p.oss_access_key_id!);
  form.set('Signature', p.signature!);
  form.set('policy', p.policy!);
  form.set('x-oss-object-acl', p.x_oss_object_acl!);
  form.set('x-oss-forbid-overwrite', p.x_oss_forbid_overwrite!);
  form.set('key', objKey);
  form.set('success_action_status', '200');
  form.set('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename);
  const up = await fetch(p.upload_host, { method: 'POST', body: form });
  if (!up.ok) throw new VideoGenError(`oss upload failed: ${up.status}`);
  return `oss://${objKey}`;
}

function base(): string {
  return (process.env.RECUT_DASHSCOPE_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/$/, '');
}

export class VideoGenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoGenError';
  }
}

export interface I2VParams {
  durationSec?: number;
  resolution?: '720P' | '1080P';
  seed?: number;
}

/** Submit an i2v job. Returns the task id. */
export async function submitI2V(modelId: string, imgUrl: string, prompt: string, params: I2VParams = {}): Promise<string> {
  const key = process.env.RECUT_DASHSCOPE_API_KEY ?? '';
  if (!key) throw new VideoGenError('RECUT_DASHSCOPE_API_KEY unset');
  const parameters: Record<string, unknown> = {
    duration: Math.max(3, Math.min(15, Math.round(params.durationSec ?? 3))),
    resolution: params.resolution ?? '720P',
    watermark: false,
  };
  if (params.seed) parameters.seed = params.seed % 2147483647;

  const res = await fetch(`${base()}/services/aigc/video-generation/video-synthesis`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({ model: modelId, input: { prompt, img_url: imgUrl }, parameters }),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; output?: { task_id?: string } };
  const taskId = body.output?.task_id;
  if (!res.ok || !taskId) throw new VideoGenError(`submit ${res.status} ${body.code ?? ''}: ${String(body.message ?? '').slice(0, 160)}`);
  return taskId;
}

/** Submit a reference-to-video job: prompt + reference IMAGES as media entries. Refs must be
 *  hosted urls; data URIs are rejected upstream. Model id comes from the manifest (hard rule 1).
 *  Returns the task id (same poll as i2v). */
export async function submitR2V(modelId: string, refUrls: string[], prompt: string, params: I2VParams = {}): Promise<string> {
  const key = process.env.RECUT_DASHSCOPE_API_KEY ?? '';
  if (!key) throw new VideoGenError('RECUT_DASHSCOPE_API_KEY unset');
  const parameters: Record<string, unknown> = {
    duration: Math.max(3, Math.min(15, Math.round(params.durationSec ?? 5))),
    resolution: params.resolution ?? '720P',
    watermark: false,
  };
  if (params.seed) parameters.seed = params.seed % 2147483647;
  const media = refUrls.map((url) => ({ type: 'reference_image', url }));
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' };
  if (refUrls.some((u) => u.startsWith('oss://'))) headers['X-DashScope-OssResourceResolve'] = 'enable';
  const res = await fetch(`${base()}/services/aigc/video-generation/video-synthesis`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: modelId, input: { prompt, media }, parameters }),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string; output?: { task_id?: string } };
  const taskId = body.output?.task_id;
  if (!res.ok || !taskId) throw new VideoGenError(`r2v submit ${res.status} ${body.code ?? ''}: ${String(body.message ?? '').slice(0, 160)}`);
  return taskId;
}

export interface I2VStatus {
  status: 'running' | 'succeeded' | 'failed';
  videoUrl?: string;
  message?: string;
}

/** Single poll of a task — for non-blocking jobs (the client polls repeatedly). */
export async function checkI2V(taskId: string): Promise<I2VStatus> {
  const key = process.env.RECUT_DASHSCOPE_API_KEY ?? '';
  const res = await fetch(`${base()}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
  const body = (await res.json().catch(() => ({}))) as { output?: { task_status?: string; video_url?: string; message?: string } };
  const st = body.output?.task_status;
  if (st === 'SUCCEEDED') return { status: 'succeeded', videoUrl: body.output?.video_url };
  if (st === 'FAILED' || st === 'CANCELED') return { status: 'failed', message: body.output?.message };
  return { status: 'running' };
}

/** Poll a task until it finishes. Returns the video_url on success. */
export async function pollI2V(taskId: string, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<string> {
  const key = process.env.RECUT_DASHSCOPE_API_KEY ?? '';
  const interval = opts.intervalMs ?? 6000;
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  while (Date.now() < deadline) {
    const res = await fetch(`${base()}/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
    const body = (await res.json().catch(() => ({}))) as { output?: { task_status?: string; video_url?: string; message?: string } };
    const status = body.output?.task_status;
    if (status === 'SUCCEEDED') {
      const url = body.output?.video_url;
      if (!url) throw new VideoGenError('succeeded but no video_url');
      return url;
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new VideoGenError(`task ${status}: ${String(body.output?.message ?? '').slice(0, 160)}`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new VideoGenError('i2v task timed out');
}
