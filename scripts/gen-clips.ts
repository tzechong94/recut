// Produces fixture clips from approved keyframes (Ken Burns push-in) into public/clips/.
// Video is animation of an approved keyframe (hard rule 6). Real i2v produces the same clip
// contract; the demo uses these pre-generated clips so video is never cold-called. Free (ffmpeg).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildKenBurnsArgs } from '../lib/post/export';

const SEEDS = [1000, 1001, 1002];
mkdirSync(resolve('public/clips'), { recursive: true });

for (const seed of SEEDS) {
  const image = resolve(`public/takes/${seed}.png`);
  const out = resolve(`public/clips/${seed}.mp4`);
  const args = buildKenBurnsArgs(image, out, 3);
  const r = spawnSync('ffmpeg', args, { stdio: 'ignore' });
  console.log(`clip ${seed}: ${r.status === 0 ? 'ok' : 'FAILED'}`);
}
console.log('done.');
