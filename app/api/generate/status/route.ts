import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { checkI2V } from '../../../../adapters/dashscope-video';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Poll an async i2v job. On success, download the clip locally and return its path. */
export async function GET(req: Request): Promise<Response> {
  const taskId = new URL(req.url).searchParams.get('taskId');
  if (!taskId) return Response.json({ error: 'taskId required' }, { status: 400 });
  if (!process.env.RECUT_DASHSCOPE_API_KEY) return Response.json({ error: 'not live' }, { status: 501 });

  const s = await checkI2V(taskId);
  if (s.status === 'running') return Response.json({ status: 'running' });
  if (s.status === 'failed' || !s.videoUrl) return Response.json({ status: 'failed', error: s.message ?? 'i2v failed' }, { status: 500 });

  const genDir = resolve(process.cwd(), 'public/generated');
  mkdirSync(genDir, { recursive: true });
  const name = `${randomUUID()}.mp4`;
  const dl = await fetch(s.videoUrl);
  writeFileSync(join(genDir, name), Buffer.from(await dl.arrayBuffer()));
  return Response.json({ status: 'done', videoUrl: `/generated/${name}` });
}
