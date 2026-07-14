'use client';

import { useState } from 'react';
import { LUTS, lutByName } from '../../lib/post/lut';

export interface Clip {
  id: string;
  src: string;
  poster: string;
  label: string;
  seconds: number;
}

export function Timeline({ clips }: { clips: Clip[] }) {
  const [lut, setLut] = useState('teal-orange');
  const [exporting, setExporting] = useState<false | '1080p' | '9x16'>(false);
  const filter = lutByName(lut).css;
  const total = clips.reduce((a, c) => a + c.seconds, 0);

  async function doExport(vertical: boolean) {
    setExporting(vertical ? '9x16' : '1080p');
    try {
      const res = await fetch(`/api/export?lut=${lut}&vertical=${vertical ? 1 : 0}`);
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ error: res.statusText }));
        alert(`Export failed: ${msg.error ?? res.status}`);
        return;
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `recut-${lut}${vertical ? '-9x16' : '-1080p'}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">Timeline</h1>
          <p className="text-sm text-neutral-500">
            {clips.length} shots · {total}s · series LUT restyles every clip instantly, zero API calls
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="export"
            onClick={() => doExport(false)}
            disabled={exporting !== false}
            className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-black hover:bg-sky-400 disabled:opacity-60"
          >
            {exporting === '1080p' ? 'Baking LUT…' : 'Export 1080p'}
          </button>
          <button
            data-testid="export-vertical"
            onClick={() => doExport(true)}
            disabled={exporting !== false}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium text-neutral-100 hover:bg-neutral-800 disabled:opacity-60"
          >
            {exporting === '9x16' ? 'Baking…' : '9:16'}
          </button>
        </div>
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
            <video
              src={c.src}
              poster={c.poster}
              data-testid="clip-frame"
              autoPlay
              muted
              loop
              playsInline
              controls
              style={{ filter }}
              className="h-40 w-72 rounded bg-black object-cover"
            />
            <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-200">{c.seconds}s</span>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right text-xs text-neutral-600">
        Preview LUT: <span className="text-neutral-400">{lutByName(lut).label}</span> · baked with ffmpeg lut3d on export
      </div>
    </div>
  );
}
