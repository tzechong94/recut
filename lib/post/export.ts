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
export interface ClipSpec {
  path: string;
  /** trim window in seconds (keeper-phase editing); omitted = full clip */
  trimIn?: number;
  trimOut?: number;
  /** probed metadata (route-side ffprobe); when present on EVERY clip, the native audio bed
   *  is carried into the export with short edge fades softening the joins */
  durSec?: number;
  hasAudio?: boolean;
}

export function buildAssembleArgs(spec: Omit<ExportSpec, 'clips'> & { clips: Array<string | ClipSpec>; audio?: string[] }): string[] {
  const fps = spec.fps ?? 24;
  const clips = spec.clips.map((c) => (typeof c === 'string' ? { path: c } : c));
  const n = clips.length;
  if (n === 0) throw new Error('assemble needs at least one clip');
  const audio = spec.audio ?? [];
  const [W, H] = spec.vertical ? [1080, 1920] : [1920, 1080];

  const inputs = [...clips.map((c) => c.path), ...audio].flatMap((c) => ['-i', c]);
  // i2v clips can each be a different size, so NORMALISE every clip to the target frame
  // (scale + pad/crop + reset SAR + fps) BEFORE concat — concat requires identical inputs.
  // Trims run first (trim + setpts) so each clip contributes only its keeper phase.
  const geom = spec.vertical
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps}`
    : `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`;
  const trimOf = (c: ClipSpec): string => {
    if (c.trimIn === undefined && c.trimOut === undefined) return '';
    const args = [
      ...(c.trimIn !== undefined ? [`start=${c.trimIn}`] : []),
      ...(c.trimOut !== undefined ? [`end=${c.trimOut}`] : []),
    ].join(':');
    return `trim=${args},setpts=PTS-STARTPTS,`;
  };
  const perClip = clips.map((c, i) => `[${i}:v]${trimOf(c)}${geom}[v${i}]`).join(';');

  // native audio bed: only when every clip was probed (durations known for fades/silence)
  const withBed = clips.every((c) => c.durSec !== undefined && c.hasAudio !== undefined);
  const FADE = 0.15;
  const bedParts: string[] = [];
  if (withBed) {
    clips.forEach((c, i) => {
      const inT = c.trimIn ?? 0;
      const outT = c.trimOut ?? c.durSec!;
      const len = Math.max(0.15, outT - inT);
      if (c.hasAudio) {
        const fades = `afade=t=in:st=0:d=${FADE},afade=t=out:st=${Math.max(0, len - FADE).toFixed(3)}:d=${FADE}`;
        bedParts.push(`[${i}:a]atrim=start=${inT}:end=${outT},asetpts=PTS-STARTPTS,aresample=48000,${fades}[ba${i}]`);
      } else {
        bedParts.push(`aevalsrc=0:d=${len.toFixed(3)}:s=48000[ba${i}]`);
      }
    });
  }
  const concatV = clips.map((_, i) => `[v${i}]`).join('') + `concat=n=${n}:v=1:a=0[cat]`;
  let filter = `${perClip};${concatV};[cat]lut3d=file='${spec.lutCube}'[v]`;

  const maps = ['-map', '[v]'];
  let hasAudioOut = false;
  if (withBed) {
    filter += ';' + bedParts.join(';') + ';' + clips.map((_, i) => `[ba${i}]`).join('') + `concat=n=${n}:v=0:a=1[bed]`;
    if (audio.length) {
      const concatA = audio.map((_, i) => `[${n + i}:a]aresample=48000[va${i}]`).join(';') + ';' + audio.map((_, i) => `[va${i}]`).join('') + `concat=n=${audio.length}:v=0:a=1[voice]`;
      filter += `;${concatA};[bed][voice]amix=inputs=2:duration=first:dropout_transition=0[a]`;
    } else {
      filter += `;[bed]anull[a]`;
    }
    maps.push('-map', '[a]');
    hasAudioOut = true;
  } else if (audio.length) {
    const concatA = audio.map((_, i) => `[${n + i}:a]`).join('') + `concat=n=${audio.length}:v=0:a=1[a]`;
    filter += `;${concatA}`;
    maps.push('-map', '[a]');
    hasAudioOut = true;
  }

  return [
    '-y',
    ...inputs,
    '-filter_complex',
    filter,
    ...maps,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    // no -shortest: the VO is shorter than the film, so trimming to it would cut the video.
    // The video runs full length; the voice plays over the opening then silence.
    ...(hasAudioOut ? ['-c:a', 'aac'] : []),
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
