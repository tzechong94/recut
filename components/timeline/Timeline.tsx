'use client';

import { useState } from 'react';
import { LUTS, lutByName } from '../../lib/post/lut';

export interface Clip {
  id: string;
  poster: string;
  label: string;
  seconds: number;
}

export function Timeline({ clips }: { clips: Clip[] }) {
  const [lut, setLut] = useState('teal-orange');
  const filter = lutByName(lut).css;
  const total = clips.reduce((a, c) => a + c.seconds, 0);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Timeline</h1>
          <p className="text-sm text-neutral-500">
            {clips.length} shots · {total}s · series LUT restyles every clip instantly, zero API calls
          </p>
        </div>
        <button data-testid="export" className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-black hover:bg-sky-400">
          Export 1080p + 9:16
        </button>
      </div>

      {/* LookBook — series-level LUT selector */}
      <div className="mb-6 flex flex-wrap gap-2" data-testid="lookbook">
        {LUTS.map((l) => (
          <button
            key={l.name}
            data-testid={`lut-${l.name}`}
            onClick={() => setLut(l.name)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium transition ${lut === l.name ? 'border-sky-400 bg-sky-500/15 text-sky-200' : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {/* Clip strip — the LUT preview is a CSS filter (instant, no network) */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3" data-testid="strip">
        {clips.map((c) => (
          <div key={c.id} className="relative shrink-0" data-testid="clip">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.poster} alt={c.label} data-testid="clip-frame" style={{ filter }} className="h-40 w-72 rounded object-cover" />
            <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-200">{c.seconds}s</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right text-xs text-neutral-600">
        Preview LUT: <span className="text-neutral-400">{lutByName(lut).label}</span> · baked with ffmpeg lut3d on export
      </div>
    </div>
  );
}
