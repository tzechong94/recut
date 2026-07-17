import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildExportArgs, buildKenBurnsArgs, buildAssembleArgs } from '../export';
import { lutByName, LUTS } from '../lut';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const clipsExist = existsSync(resolve('public/clips/1000.mp4'));

describe('LookBook', () => {
  it('ships 8 LUTs each with a .cube and a CSS preview', () => {
    expect(LUTS.length).toBe(8);
    for (const l of LUTS) {
      expect(l.cube).toMatch(/\.cube$/);
      expect(typeof l.css).toBe('string');
    }
  });
});

describe('export arg builder (pure, zero network)', () => {
  it('concats clips, bakes the lut, targets 1080p', () => {
    const args = buildExportArgs({ clips: ['a.mp4', 'b.mp4'], lutCube: '/luts/teal-orange.cube', out: 'o.mp4' });
    const fc = args[args.indexOf('-filter_complex') + 1]!;
    expect(fc).toContain('concat=n=2');
    expect(fc).toContain("lut3d=file='/luts/teal-orange.cube'");
    expect(fc).toContain('scale=1920:1080');
  });
  it('vertical mode crops to 1080x1920', () => {
    const args = buildExportArgs({ clips: ['a.mp4'], lutCube: 'x.cube', out: 'o.mp4', vertical: true });
    expect(args[args.indexOf('-filter_complex') + 1]!).toContain('crop=1080:1920');
  });
  it('refuses an empty clip list', () => {
    expect(() => buildExportArgs({ clips: [], lutCube: 'x', out: 'o' })).toThrow();
  });
});

describe.skipIf(!hasFfmpeg || !clipsExist)('ffmpeg export produces a graded MP4 from fixture clips', () => {
  it('assembles 3 clips + bakes a LUT → a real playable mp4', () => {
    const dir = mkdtempSync(join(tmpdir(), 'recut-export-'));
    const out = join(dir, 'cut.mp4');
    const args = buildExportArgs({
      clips: [resolve('public/clips/1000.mp4'), resolve('public/clips/1001.mp4'), resolve('public/clips/1002.mp4')],
      lutCube: resolve('public', lutByName('teal-orange').cube.replace(/^\//, '')),
      out,
    });
    const r = spawnSync('ffmpeg', args, { stdio: 'ignore' });
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(1000);

    // ffprobe: it's really a 1080p h264 video ~9s (3×3s)
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,height', '-of', 'default=noprint_wrappers=1', out], { encoding: 'utf8' });
    expect(probe.stdout).toContain('codec_name=h264');
    expect(probe.stdout).toContain('height=1080');
  }, 60_000);
});

describe('assemble arg builder (clips + audio + lut)', () => {
  it('maps a video stream only when there is no audio', () => {
    const args = buildAssembleArgs({ clips: ['a.mp4', 'b.mp4'], lutCube: 'x.cube', out: 'o.mp4' });
    expect(args.filter((a) => a === '-map')).toHaveLength(1);
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('concat=n=2:v=1:a=0');
  });
  it('adds an audio concat + maps it when dialogue is present', () => {
    const args = buildAssembleArgs({ clips: ['a.mp4'], audio: ['v1.wav', 'v2.wav'], lutCube: 'x.cube', out: 'o.mp4' });
    const fc = args[args.indexOf('-filter_complex') + 1]!;
    expect(fc).toContain('concat=n=2:v=0:a=1[a]');
    expect(args.filter((a) => a === '-map')).toHaveLength(2);
    expect(args).toContain('aac');
  });
});

describe.skipIf(!hasFfmpeg || !clipsExist)('ffmpeg assemble produces a film from canvas clips', () => {
  it('assembles 2 clips + LUT into a playable mp4', () => {
    const dir = mkdtempSync(join(tmpdir(), 'recut-asm-'));
    const out = join(dir, 'film.mp4');
    const args = buildAssembleArgs({
      clips: [resolve('public/clips/1000.mp4'), resolve('public/clips/1001.mp4')],
      lutCube: resolve('public', lutByName('warm-film').cube.replace(/^\//, '')),
      out,
    });
    const r = spawnSync('ffmpeg', args, { stdio: 'ignore' });
    expect(r.status).toBe(0);
    expect(existsSync(out)).toBe(true);
  }, 60_000);
});

describe('Ken Burns arg builder', () => {
  it('loops an image into a timed clip', () => {
    const args = buildKenBurnsArgs('/x/take.png', '/o/clip.mp4', 3);
    expect(args[args.indexOf('-vf') + 1]).toContain('zoompan');
    expect(args[args.indexOf('-t') + 1]).toBe('3');
  });
});

describe('assemble with keeper-phase trims', () => {
  it('trim windows shorten the assembled film accordingly', () => {
    const args = buildAssembleArgs({
      clips: [
        { path: '/a.mp4', trimIn: 1, trimOut: 2.5 },
        '/b.mp4',
      ],
      lutCube: '/lut.cube',
      out: '/out.mp4',
    });
    const filter = args[args.indexOf('-filter_complex') + 1]!;
    expect(filter).toContain('trim=start=1:end=2.5,setpts=PTS-STARTPTS');
    expect(filter).not.toContain('[1:v]trim'); // untrimmed clip has no trim stage
  });
});

describe('native audio bed carried into the assemble', () => {
  it('probed clips produce per-clip fades + bed concat + voice amix', () => {
    const args = buildAssembleArgs({
      clips: [
        { path: '/a.mp4', trimIn: 1, trimOut: 3, durSec: 5, hasAudio: true },
        { path: '/b.mp4', durSec: 4, hasAudio: false },
      ],
      audio: ['/vo.wav'],
      lutCube: '/lut.cube',
      out: '/out.mp4',
    });
    const filter = args[args.indexOf('-filter_complex') + 1]!;
    expect(filter).toContain('atrim=start=1:end=3');
    expect(filter).toContain('afade=t=in:st=0:d=0.15');
    expect(filter).toContain('aevalsrc=0:d=4.000'); // silent stand-in for the audio-less clip
    expect(filter).toContain('concat=n=2:v=0:a=1[bed]');
    expect(filter).toContain('amix=inputs=2');
  });
  it('unprobed clips keep the legacy video-only path', () => {
    const args = buildAssembleArgs({ clips: ['/a.mp4', '/b.mp4'], lutCube: '/l.cube', out: '/o.mp4' });
    const filter = args[args.indexOf('-filter_complex') + 1]!;
    expect(filter).not.toContain('[bed]');
  });
  it('real ffmpeg: assembled film keeps an audio stream from clip beds', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'recut-bed-'));
    const mk = (name: string) => {
      const p = join(tmp, name);
      const r = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=12:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p], { stdio: 'ignore' });
      expect(r.status).toBe(0);
      return p;
    };
    const a = mk('a.mp4');
    const b = mk('b.mp4');
    const out = join(tmp, 'out.mp4');
    const args = buildAssembleArgs({
      clips: [
        { path: a, trimIn: 0.2, trimOut: 0.8, durSec: 1, hasAudio: true },
        { path: b, durSec: 1, hasAudio: true },
      ],
      lutCube: resolve('public/luts/identity.cube'),
      out,
    });
    const r = spawnSync('ffmpeg', args, { stdio: 'ignore' });
    expect(r.status).toBe(0);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { encoding: 'utf8' });
    expect(probe.stdout.trim()).toContain('audio');
  });
});
