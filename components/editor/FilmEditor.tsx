'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { loadGraph } from '../../lib/projects';
import { LUTS, lutByName } from '../../lib/post/lut';

interface Clip {
  id: string;
  src: string;
  label: string;
}

export function FilmEditor({ projectId, title }: { projectId: string; title: string }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [audio, setAudio] = useState<Clip[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [lut, setLut] = useState('warm-film');
  const [vertical, setVertical] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playIdx, setPlayIdx] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    loadGraph(projectId).then((g) => {
      if (!g) return;
      const nodes = g.nodes as Array<{ id: string; position: { x: number; y: number }; data: { kind: string; videoUrl?: string; audioUrl?: string; title?: string } }>;
      const vids = nodes
        .filter((n) => n.data.kind === 'video' && n.data.videoUrl && n.id !== 'final')
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        .map((n) => ({ id: n.id, src: n.data.videoUrl!, label: n.data.title ?? 'clip' }));
      const auds = nodes
        .filter((n) => n.data.kind === 'dialogue' && n.data.audioUrl)
        .map((n) => ({ id: n.id, src: n.data.audioUrl!, label: n.data.title ?? 'voice' }));
      setClips(vids);
      setAudio(auds);
      setOrder(vids.map((v) => v.id));
    });
  }, [projectId]);

  const ordered = useMemo(() => order.map((id) => clips.find((c) => c.id === id)).filter((c): c is Clip => Boolean(c)), [order, clips]);
  const filter = lutByName(lut).css;

  const move = (id: string, dir: -1 | 1) => {
    setOrder((o) => {
      const i = o.indexOf(id);
      const j = i + dir;
      if (j < 0 || j >= o.length) return o;
      const next = [...o];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  };
  const remove = (id: string) => setOrder((o) => o.filter((x) => x !== id));

  // sequential preview: play each clip, advance on ended
  const playAll = () => setPlayIdx(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || playIdx === null || !ordered[playIdx]) return;
    v.src = ordered[playIdx]!.src;
    v.play().catch(() => {});
    const onEnded = () => setPlayIdx((i) => (i === null || i + 1 >= ordered.length ? null : i + 1));
    v.addEventListener('ended', onEnded);
    return () => v.removeEventListener('ended', onEnded);
  }, [playIdx, ordered]);

  async function exportFilm() {
    if (ordered.length === 0) return;
    setExporting(true);
    setError(null);
    setResultUrl(null);
    try {
      const res = await fetch('/api/assemble', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clips: ordered.map((c) => c.src), audio: audio.map((a) => a.src), lut, vertical }),
      });
      const j = (await res.json().catch(() => ({ error: res.statusText }))) as { videoUrl?: string; error?: string };
      if (!res.ok || !j.videoUrl) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setResultUrl(j.videoUrl);
    } catch (e) {
      setError(String(e).slice(0, 140));
    } finally {
      setExporting(false);
    }
  }

  return (
    <main className="flex h-screen flex-col bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold text-neutral-100">Recut</Link>
          <span className="text-xs text-neutral-500">/ {title} · <span className="text-neutral-300">Edit</span></span>
        </div>
        <Link href={`/project/${projectId}`} className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800" data-testid="back-to-canvas">
          ← Back to canvas
        </Link>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_20rem]">
        {/* Preview + timeline */}
        <div className="flex min-h-0 flex-col">
          <div className="flex flex-1 items-center justify-center bg-black p-4">
            {resultUrl ? (
              <video src={resultUrl} controls autoPlay className="max-h-full max-w-full rounded" data-testid="result-video" />
            ) : ordered.length > 0 ? (
              <div className="relative">
                <video ref={videoRef} muted playsInline style={{ filter }} className="max-h-[52vh] rounded bg-neutral-900" />
                {playIdx === null && (
                  <button onClick={playAll} className="absolute inset-0 grid place-items-center text-4xl text-white/80 hover:text-white">▶</button>
                )}
              </div>
            ) : (
              <p className="text-sm text-neutral-600">No clips yet — generate Video nodes on the canvas first.</p>
            )}
          </div>

          {/* video track */}
          <div className="border-t border-neutral-800 p-3">
            <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Video track · {ordered.length}</div>
            <div className="flex gap-2 overflow-x-auto pb-1" data-testid="video-track">
              {ordered.map((c, i) => (
                <div key={c.id} className="group relative shrink-0 rounded border border-neutral-800 bg-neutral-900">
                  <video src={c.src} muted className="h-20 w-32 rounded object-cover" style={{ filter }} />
                  <span className="absolute top-0.5 left-0.5 rounded bg-black/70 px-1 text-[9px] tabular-nums text-neutral-200">{i + 1}</span>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/60 py-0.5 opacity-0 transition group-hover:opacity-100">
                    <button onClick={() => move(c.id, -1)} className="text-[11px] text-neutral-200 hover:text-white">◀</button>
                    <button onClick={() => remove(c.id)} className="text-[11px] text-rose-300 hover:text-rose-200">✕</button>
                    <button onClick={() => move(c.id, 1)} className="text-[11px] text-neutral-200 hover:text-white">▶</button>
                  </div>
                </div>
              ))}
            </div>
            {audio.length > 0 && (
              <div className="mt-2 rounded bg-pink-500/10 px-2 py-1 text-[10px] text-pink-300">🔊 audio track · {audio.length} voice line{audio.length === 1 ? '' : 's'} (mixed over the cut)</div>
            )}
          </div>
        </div>

        {/* Inspector: grade + export */}
        <aside className="space-y-4 border-l border-neutral-800 p-4 text-sm">
          <div>
            <div className="mb-1 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Look (LUT)</div>
            <select value={lut} onChange={(e) => { setLut(e.target.value); setResultUrl(null); }} className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none">
              {LUTS.map((l) => <option key={l.name} value={l.name}>{l.label}</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Aspect</div>
            <div className="flex gap-2">
              {[{ v: false, label: '16:9' }, { v: true, label: '9:16' }].map((a) => (
                <button key={a.label} onClick={() => { setVertical(a.v); setResultUrl(null); }} className={`flex-1 rounded-md border px-2 py-1.5 text-xs ${vertical === a.v ? 'border-sky-400 bg-sky-500/15 text-sky-200' : 'border-neutral-700 text-neutral-400'}`}>{a.label}</button>
              ))}
            </div>
          </div>

          <button onClick={exportFilm} disabled={exporting || ordered.length === 0} data-testid="export-film" className="w-full rounded-md bg-sky-500 py-2 text-sm font-semibold text-black hover:bg-sky-400 disabled:opacity-50">
            {exporting ? 'Rendering the film…' : '▶ Export film'}
          </button>
          {error && <p className="rounded-md bg-rose-950/50 px-2 py-1.5 text-[11px] text-rose-300">{error}</p>}
          {resultUrl && (
            <a href={resultUrl} download="recut-film.mp4" className="block rounded-md border border-neutral-700 py-2 text-center text-xs font-medium text-neutral-100 hover:bg-neutral-800">⬇ Download MP4</a>
          )}
          <p className="text-[11px] leading-relaxed text-neutral-600">Reorder clips with ◀ ▶, remove with ✕. Export concatenates the video track, bakes the LUT, and mixes the voice track.</p>
        </aside>
      </div>
    </main>
  );
}
