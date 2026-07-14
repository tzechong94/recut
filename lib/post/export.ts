// ffmpeg assembly. Concats the ordered accepted clips, bakes the series LUT (lut3d), and emits
// 1080p landscape + a 9:16 vertical crop. No ffmpeg.wasm (too slow at 1080p) — real ffmpeg on
// the host / Function Compute. This module only BUILDS the arg list; the caller spawns ffmpeg.

export interface ExportSpec {
  clips: string[]; // ordered input clip paths (already produced from approved keyframes)
  lutCube: string; // path to the .cube to bake
  out: string; // output mp4 path
  vertical?: boolean; // 9:16 crop instead of 1080p landscape
  fps?: number;
}

/** Build the ffmpeg argument vector for a graded, assembled export. */
export function buildExportArgs(spec: ExportSpec): string[] {
  const fps = spec.fps ?? 24;
  const n = spec.clips.length;
  if (n === 0) throw new Error('export needs at least one clip');

  const inputs = spec.clips.flatMap((c) => ['-i', c]);
  // concat the video streams, then bake the LUT, then scale/crop to the target frame.
  const concat = spec.clips.map((_, i) => `[${i}:v]`).join('') + `concat=n=${n}:v=1:a=0[cat]`;
  const geom = spec.vertical
    ? // fill a 1080x1920 frame, centre-crop
      `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`
    : `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2`;
  const filter = `${concat};[cat]lut3d=file='${spec.lutCube}',${geom},fps=${fps}[v]`;

  return [
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    spec.out,
  ];
}

/**
 * Assemble ordered clips + bake the LUT + (optionally) lay a concatenated audio track over the
 * whole cut. This is the "finish a film" path from the canvas timeline.
 */
export function buildAssembleArgs(spec: ExportSpec & { audio?: string[] }): string[] {
  const fps = spec.fps ?? 24;
  const n = spec.clips.length;
  if (n === 0) throw new Error('assemble needs at least one clip');
  const audio = spec.audio ?? [];

  const inputs = [...spec.clips, ...audio].flatMap((c) => ['-i', c]);
  const concatV = spec.clips.map((_, i) => `[${i}:v]`).join('') + `concat=n=${n}:v=1:a=0[cat]`;
  const geom = spec.vertical
    ? `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`
    : `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2`;
  let filter = `${concatV};[cat]lut3d=file='${spec.lutCube}',${geom},fps=${fps}[v]`;

  const maps = ['-map', '[v]'];
  if (audio.length) {
    const concatA = audio.map((_, i) => `[${n + i}:a]`).join('') + `concat=n=${audio.length}:v=0:a=1[a]`;
    filter += `;${concatA}`;
    maps.push('-map', '[a]');
  }

  return [
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    ...maps,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    ...(audio.length ? ['-c:a', 'aac', '-shortest'] : []),
    '-movflags', '+faststart',
    spec.out,
  ];
}

/** Build ffmpeg args that animate an approved keyframe into a clip (Ken Burns push-in). Video
 *  is animation of an approved keyframe (hard rule 6); real i2v uses the same clip contract. */
export function buildKenBurnsArgs(image: string, out: string, seconds = 3, fps = 24): string[] {
  const frames = seconds * fps;
  return [
    '-y',
    '-loop', '1', '-i', image,
    '-vf', `scale=2160:-1,zoompan=z='min(zoom+0.0009,1.15)':d=${frames}:s=1920x1080:fps=${fps},format=yuv420p`,
    '-t', String(seconds),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    out,
  ];
}
