'use client';

import { useMemo, useState } from 'react';
import { useCanvas } from '../../lib/canvas/store';
import { LUTS } from '../../lib/post/lut';

export function TimelinePanel() {
  const nodes = useCanvas((s) => s.nodes);
  const addConfiguredNode = useCanvas((s) => s.addConfiguredNode);
  const [open, setOpen] = useState(false);
  const [lut, setLut] = useState('teal-orange');
  const [exporting, setExporting] = useState<false | '1080p' | '9x16'>(false);
  const [error, setError] = useState<string | null>(null);

  // clip order = video nodes left-to-right, top-to-bottom on the canvas
  const clips = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === 'video' && n.data.videoUrl)
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        .map((n) => n.data.videoUrl as string),
    [nodes],
  );
  const audio = useMemo(
    () =>
      nodes
        .filter((n) => n.data.kind === 'dialogue' && n.data.audioUrl)
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        .map((n) => n.data.audioUrl as string),
    [nodes],
  );

  async function exportFilm(vertical: boolean) {
    if (clips.length === 0) return;
    setExporting(vertical ? '9x16' : '1080p');
    setError(null);
    try {
      const res = await fetch('/api/assemble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips, audio, lut, vertical }),
      });
      const j = (await res.json().catch(() => ({ error: res.statusText }))) as { videoUrl?: string; error?: string };
      if (!res.ok || !j.videoUrl) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      // drop the finished film onto the canvas as a node…
      addConfiguredNode('video', { x: 1200, y: 200 }, { title: `🎬 Final Film (${vertical ? '9:16' : '1080p'})`, videoUrl: j.videoUrl, status: 'done', prompt: `assembled ${clips.length} clips + ${audio.length} voice, ${lut} LUT` });
      // …and download it
      const a = document.createElement('a');
      a.href = j.videoUrl;
      a.download = `recut-film${vertical ? '-9x16' : '-1080p'}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setOpen(true);
    } catch (e) {
      setError(String(e).slice(0, 120));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="border-t border-neutral-800 bg-neutral-950" data-testid="timeline-panel">
      <div className={`flex items-center justify-between px-4 py-2.5 ${clips.length ? 'bg-neutral-900' : 'bg-neutral-950'}`}>
        <button onClick={() => setOpen((o) => !o)} data-testid="timeline-toggle" className={`flex items-center gap-2 text-xs font-semibold ${clips.length ? 'text-neutral-100' : 'text-neutral-500'}`}>
          {open ? '▾' : '▴'} 🎬 Timeline
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-medium text-neutral-400">
            {clips.length} clip{clips.length === 1 ? '' : 's'}{audio.length ? ` · ${audio.length} voice` : ''}
          </span>
        </button>
        {clips.length > 0 && (
          <button
            onClick={() => exportFilm(false)}
            disabled={exporting !== false}
            data-testid="export-bar"
            className="rounded-md bg-sky-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-sky-400 disabled:opacity-60"
          >
            {exporting === '1080p' ? 'Stitching the film…' : '▶ Export film'}
          </button>
        )}
      </div>

      {open && (
        <div className="px-4 pb-3">
          {clips.length === 0 ? (
            <p className="py-3 text-xs text-neutral-600">Generate a Video node to add a clip to the timeline.</p>
          ) : (
            <>
              <div className="flex gap-1 overflow-x-auto py-2" data-testid="timeline-strip">
                {clips.map((src, i) => (
                  <div key={i} className="relative shrink-0">
                    <video src={src} muted loop playsInline className="h-20 w-36 rounded bg-black object-cover" />
                    <span className="absolute top-0.5 left-0.5 rounded bg-black/70 px-1 text-[9px] tabular-nums text-neutral-200">{i + 1}</span>
                  </div>
                ))}
              </div>
              {audio.length > 0 && <div className="mb-2 rounded bg-pink-500/10 px-2 py-1 text-[10px] text-pink-300">🔊 dialogue track: {audio.length} line{audio.length === 1 ? '' : 's'}</div>}

              <div className="flex flex-wrap items-center gap-2">
                <select value={lut} onChange={(e) => setLut(e.target.value)} className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none">
                  {LUTS.map((l) => (
                    <option key={l.name} value={l.name}>{l.label}</option>
                  ))}
                </select>
                <button onClick={() => exportFilm(false)} disabled={exporting !== false} data-testid="export-film" className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-sky-400 disabled:opacity-60">
                  {exporting === '1080p' ? 'Assembling…' : 'Export film 1080p'}
                </button>
                <button onClick={() => exportFilm(true)} disabled={exporting !== false} className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-100 hover:bg-neutral-800 disabled:opacity-60">
                  {exporting === '9x16' ? 'Assembling…' : '9:16'}
                </button>
                {error && <span className="text-[11px] text-rose-400">{error}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
