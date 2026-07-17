import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildAssembleArgs } from '../../../lib/post/export';
import { lutByName } from '../../../lib/post/lut';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ClipIn {
  url: string;
  trimIn?: number;
  trimOut?: number;
}
interface Body {
  /** public paths (/clips/x.mp4, /generated/x.mp4), plain or with trim windows */
  clips?: Array<string | ClipIn>;
  audio?: string[];
  lut?: string;
  vertical?: boolean;
}

/** Probe a clip's duration + audio presence (carries the native bed into the export). */
function probeClip(path: string): { durSec?: number; hasAudio?: boolean } {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'json', path], { encoding: 'utf8' });
  if (r.status !== 0) return {};
  try {
    const j = JSON.parse(r.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
    const durSec = j.format?.duration ? Number(j.format.duration) : undefined;
    const hasAudio = (j.streams ?? []).some((st) => st.codec_type === 'audio');
    return { durSec: Number.isFinite(durSec) ? durSec : undefined, hasAudio };
  } catch {
    return {};
  }
}

/** Map a public URL path to a local file under public/. Rejects anything outside public/. */
function localOf(pub: string): string | null {
  if (!pub.startsWith('/') || pub.includes('..')) return null;
  const p = resolve(process.cwd(), 'public', pub.replace(/^\//, ''));
  return existsSync(p) ? p : null;
}

export async function POST(req: Request): Promise<Response> {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) return Response.json({ error: 'ffmpeg unavailable' }, { status: 501 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400 });
  }
  const norm = (body.clips ?? []).map((c) => (typeof c === 'string' ? { url: c } : c));
  const clips = norm.map((c) => {
    const path = localOf(c.url);
    if (!path) return null;
    const trimIn = typeof c.trimIn === 'number' && c.trimIn > 0 ? c.trimIn : undefined;
    const trimOut = typeof c.trimOut === 'number' && c.trimOut > 0 ? c.trimOut : undefined;
    return { path, trimIn, trimOut, ...probeClip(path) };
  });
  if (clips.length === 0 || clips.some((c) => c === null)) {
    return Response.json({ error: 'need clips that exist under public/' }, { status: 400 });
  }
  const audio = (body.audio ?? []).map(localOf).filter((a): a is string => a !== null);

  // save the finished film under public/ so it gets a durable URL (→ can become a canvas node)
  const genDir = resolve(process.cwd(), 'public/generated');
  mkdirSync(genDir, { recursive: true });
  const name = `film-${randomUUID()}.mp4`;
  const out = join(genDir, name);
  const lut = lutByName(body.lut ?? 'teal-orange');
  const args = buildAssembleArgs({
    clips: clips as Array<{ path: string; trimIn?: number; trimOut?: number; durSec?: number; hasAudio?: boolean }>,
    audio: audio.length ? audio : undefined,
    lutCube: resolve(process.cwd(), 'public', lut.cube.replace(/^\//, '')),
    out,
    vertical: Boolean(body.vertical),
  });
  const r = spawnSync('ffmpeg', args, { stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(out)) return Response.json({ error: 'ffmpeg assemble failed' }, { status: 500 });
  return Response.json({ videoUrl: `/generated/${name}` });
}
