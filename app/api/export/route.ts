import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildExportArgs } from '../../../lib/post/export';
import { lutByName } from '../../../lib/post/lut';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The demo's ordered clips (produced from approved keyframes). A real project would read the
// accepted takes from the graph; the export machinery is identical.
const CLIPS = ['1000', '1001', '1002'].map((s) => resolve(process.cwd(), 'public/clips', `${s}.mp4`));

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const lutName = url.searchParams.get('lut') ?? 'teal-orange';
  const vertical = url.searchParams.get('vertical') === '1';

  if (spawnSync('ffmpeg', ['-version']).status !== 0) {
    return Response.json({ error: 'ffmpeg not available on the server' }, { status: 501 });
  }
  const missing = CLIPS.filter((c) => !existsSync(c));
  if (missing.length) return Response.json({ error: 'clips missing', missing }, { status: 500 });

  const dir = mkdtempSync(join(tmpdir(), 'recut-export-'));
  const out = join(dir, 'cut.mp4');
  const lut = lutByName(lutName);
  const args = buildExportArgs({
    clips: CLIPS,
    lutCube: resolve(process.cwd(), 'public', lut.cube.replace(/^\//, '')),
    out,
    vertical,
  });
  const r = spawnSync('ffmpeg', args, { stdio: 'ignore' });
  if (r.status !== 0 || !existsSync(out)) {
    return Response.json({ error: 'ffmpeg export failed' }, { status: 500 });
  }
  const bytes = readFileSync(out);
  const name = `recut-${lut.name}${vertical ? '-9x16' : '-1080p'}.mp4`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Content-Length': String(bytes.length),
    },
  });
}
