import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildAssembleArgs } from '../../../lib/post/export';
import { lutByName } from '../../../lib/post/lut';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  clips?: string[]; // public paths, e.g. /clips/x.mp4 or /generated/x.mp4
  audio?: string[];
  lut?: string;
  vertical?: boolean;
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
  const clips = (body.clips ?? []).map(localOf);
  if (clips.length === 0 || clips.some((c) => c === null)) {
    return Response.json({ error: 'need clips that exist under public/' }, { status: 400 });
  }
  const audio = (body.audio ?? []).map(localOf).filter((a): a is string => a !== null);

  const dir = mkdtempSync(join(tmpdir(), 'recut-assemble-'));
  const out = join(dir, 'film.mp4');
  const lut = lutByName(body.lut ?? 'teal-orange');
  const args = buildAssembleArgs({
    clips: clips as string[],
    audio: audio.length ? audio : undefined,
    lutCube: resolve(process.cwd(), 'public', lut.cube.replace(/^\//, '')),
    out,
    vertical: Boolean(body.vertical),
  });
  const r = spawnSync('ffmpeg', args, { stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(out)) return Response.json({ error: 'ffmpeg assemble failed' }, { status: 500 });

  const bytes = readFileSync(out);
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="recut-film-${lut.name}${body.vertical ? '-9x16' : '-1080p'}.mp4"`,
      'Content-Length': String(bytes.length),
    },
  });
}
