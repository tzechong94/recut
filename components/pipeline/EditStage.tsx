'use client';

// The Edit stage: a real single-playhead timeline editor over the film's segment list (EDL).
// One player = the film. Click the timeline to seek, space plays through segments, S splits at
// the playhead, edges drag-trim with live readout, cmd/ctrl+Z undoes timeline edits.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePipeline } from '../../lib/pipeline/usePipeline';
import { deriveTimeline, filmSegments, voiceTracks, type FilmSegment } from '../../lib/pipeline/doc';

const MIN_ZOOM = 16;
const MAX_ZOOM = 320;

export function EditStage() {
  const {
    doc, vertical, setVertical, exportFilm, exporting, filmUrl, clearFilm,
    updateSegment, splitSegmentAt, removeSegment, moveSegmentTo, resetTimeline, setTimeline, appendSegment,
  } = usePipeline();
  // every video take not currently on the timeline is available in the bin
  const binTakes = doc.takes.filter((t) => t.kind === 'video' && !filmSegments(doc).some((sg) => sg.takeId === t.id));

  const segs = filmSegments(doc);
  const voices = voiceTracks(doc);
  const [selected, setSelected] = useState<string | null>(null);
  const [pxPerSec, setPxPerSec] = useState(56);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [T, setT] = useState(0); // playhead, film seconds
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [dragInfo, setDragInfo] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const playerRef = useRef<HTMLVideoElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const justDragged = useRef(false);
  const undoStack = useRef<Array<FilmSegment[] | undefined>>([]);
  const playIdx = useRef<number>(-1); // segment index currently loaded in the player

  const durOf = useCallback((sg: (typeof segs)[number]) => durations[sg.takeId] ?? 5, [durations]);
  const lenOf = useCallback((sg: (typeof segs)[number]) => Math.max(0.15, (sg.end ?? durOf(sg)) - sg.start), [durOf]);
  const prefix = useMemo(() => {
    const out: number[] = [0];
    for (const sg of segs) out.push(out[out.length - 1]! + lenOf(sg));
    return out;
  }, [segs, lenOf]);
  const total = prefix[prefix.length - 1] ?? 0;
  const sel = segs.find((sg) => sg.id === selected) ?? null;

  /** film time -> segment index + local offset inside its window */
  const locate = useCallback((t: number): { i: number; local: number } => {
    const tt = Math.max(0, Math.min(t, Math.max(0, total - 0.001)));
    for (let i = 0; i < segs.length; i++) {
      if (tt < prefix[i + 1]! || i === segs.length - 1) return { i, local: tt - prefix[i]! };
    }
    return { i: 0, local: 0 };
  }, [segs, prefix, total]);

  // every timeline mutation goes through here so cmd+Z can restore
  const withUndo = useCallback((fn: () => void) => {
    undoStack.current.push((usePipeline.getState().doc.timeline ?? deriveTimeline(usePipeline.getState().doc)).map((s) => ({ ...s })));
    if (undoStack.current.length > 50) undoStack.current.shift();
    fn();
  }, []);
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev) setTimeline(prev);
  }, [setTimeline]);

  /** put the player at film time t (loads the right segment, pauses or keeps playing) */
  const seek = useCallback((t: number, keepPlaying = false) => {
    const v = playerRef.current;
    if (!v || segs.length === 0) return;
    const { i, local } = locate(t);
    const sg = segs[i]!;
    setT(Math.max(0, Math.min(t, total)));
    if (playIdx.current !== i || !v.src.endsWith(sg.url)) {
      playIdx.current = i;
      v.src = sg.url;
    }
    const target = sg.start + local;
    if (v.readyState >= 1) v.currentTime = target;
    else v.addEventListener('loadedmetadata', () => { v.currentTime = target; }, { once: true });
    if (keepPlaying) void v.play().catch(() => undefined);
  }, [segs, locate, total]);

  const play = useCallback(() => {
    const v = playerRef.current;
    if (!v || segs.length === 0) return;
    clearFilm();
    if (T >= total - 0.01) seek(0, true);
    else seek(T, true);
    setIsPlaying(true);
  }, [T, total, segs.length, seek, clearFilm]);

  const pause = useCallback(() => {
    playerRef.current?.pause();
    setIsPlaying(false);
  }, []);

  // playback engine: track film time, hop across segment boundaries
  useEffect(() => {
    const v = playerRef.current;
    if (!v) return;
    const onTime = () => {
      if (v.paused) return; // paused/seek-loading updates must not fight seek()'s playhead
      const i = playIdx.current;
      const sg = segs[i];
      if (!sg) return;
      const local = v.currentTime - sg.start;
      setT(prefix[i]! + Math.max(0, local));
      const stop = sg.end ?? durations[sg.takeId];
      if (!v.paused && stop !== undefined && v.currentTime >= stop - 0.03) {
        if (i + 1 < segs.length) seek(prefix[i + 1]!, true);
        else { pause(); setT(total); }
      }
    };
    const onEnded = () => {
      const i = playIdx.current;
      if (i + 1 < segs.length) seek(prefix[i + 1]!, true);
      else { setIsPlaying(false); setT(total); }
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    return () => { v.removeEventListener('timeupdate', onTime); v.removeEventListener('ended', onEnded); };
  }, [segs, prefix, durations, seek, pause, total]);

  // show the first frame once segments/durations exist
  useEffect(() => {
    if (segs.length && playIdx.current === -1) seek(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segs.length]);

  // wheel = zoom-to-cursor (native, non-passive)
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      setPxPerSec((z) => {
        const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * (e.deltaY > 0 ? 0.88 : 1.14)));
        const tUnder = (el.scrollLeft + cursorX) / z;
        requestAnimationFrame(() => { el.scrollLeft = Math.max(0, tUnder * nz - cursorX); });
        return nz;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // keyboard: space play/pause · S split · delete remove · arrows nudge · cmd+Z undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (e.key === ' ') { e.preventDefault(); isPlaying ? pause() : play(); }
      else if (e.key.toLowerCase() === 's') { e.preventDefault(); splitAtPlayhead(); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selected) { e.preventDefault(); withUndo(() => removeSegment(selected)); setSelected(null); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(T - (e.shiftKey ? 1 : 0.1)); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(T + (e.shiftKey ? 1 : 0.1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const splitAtPlayhead = () => {
    if (!segs.length) return;
    const { i, local } = locate(T);
    const sg = segs[i]!;
    withUndo(() => splitSegmentAt(sg.id, sg.start + local));
  };

  // edge-drag trimming with live readout
  const dragEdge = (e: React.PointerEvent, sg: (typeof segs)[number], edge: 'l' | 'r') => {
    e.preventDefault();
    e.stopPropagation();
    withUndo(() => undefined); // snapshot once per drag
    const x0 = e.clientX;
    const s0 = sg.start;
    const e0 = sg.end ?? durOf(sg);
    const dur = durOf(sg);
    const onMove = (ev: PointerEvent) => {
      const ds = (ev.clientX - x0) / pxPerSec;
      if (edge === 'l') {
        const ns = Math.max(0, Math.min(s0 + ds, e0 - 0.15));
        updateSegment(sg.id, { start: ns });
        setDragInfo(`in ${ns.toFixed(2)}s · len ${(e0 - ns).toFixed(2)}s`);
      } else {
        const ne = Math.max(s0 + 0.15, Math.min(e0 + ds, dur));
        updateSegment(sg.id, { end: ne });
        setDragInfo(`out ${ne.toFixed(2)}s · len ${(ne - s0).toFixed(2)}s`);
      }
    };
    const onUp = () => {
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 200);
      setDragInfo(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ruler ticks adaptive to zoom
  const tickStep = pxPerSec >= 120 ? 0.5 : pxPerSec >= 48 ? 1 : 5;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= Math.max(total, 1) + 0.001; t += tickStep) out.push(Number(t.toFixed(2)));
    return out;
  }, [total, tickStep]);

  const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
  const contentW = Math.max(total * pxPerSec + 40, 300);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4" data-testid="export-stage">
      {/* metadata probes: real durations per take */}
      {[...new Map(segs.map((sg) => [sg.takeId, sg.url])).entries()].map(([takeId, url]) => (
        <video key={takeId} src={url} preload="metadata" className="hidden" onLoadedMetadata={(e) => {
          const dur = e.currentTarget?.duration;
          if (dur && Number.isFinite(dur)) setDurations((d) => (d[takeId] ? d : { ...d, [takeId]: dur }));
        }} />
      ))}

      <div className="grid min-h-0 flex-1 grid-cols-[1fr_15rem] gap-4">
        {/* player: always the film */}
        <div className="relative min-h-0">
          {filmUrl ? (
            <div className="relative h-full">
              <video src={filmUrl} controls autoPlay className="h-full w-full rounded-2xl border border-emerald-500/30 bg-black object-contain" data-testid="film-result" />
              <button onClick={clearFilm} className="absolute top-2 right-2 rounded-md bg-black/70 px-2 py-1 text-[11px] text-neutral-200 hover:bg-black" title="Back to editing">✕ back to edit</button>
              <span className="absolute top-2 left-2 rounded bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-bold text-black">EXPORTED</span>
            </div>
          ) : (
            <div className="relative h-full">
              <video ref={playerRef} muted={muted} playsInline className="h-full w-full rounded-2xl border border-white/10 bg-black object-contain" onClick={() => (isPlaying ? pause() : play())} />
              {!isPlaying && segs.length > 0 && (
                <button onClick={play} data-testid="preview-sequence" className="absolute inset-0 grid place-items-center text-6xl text-white/60 hover:text-white" title="Play (space)">▶</button>
              )}
              {segs.length === 0 && <p className="absolute inset-0 grid place-items-center text-sm text-neutral-600">Star keeper takes in Shots: they become the film here.</p>}
              <div className="absolute bottom-2 left-2 flex items-center gap-2">
                <span className="rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-neutral-200">{fmt(T)} / {fmt(total)}</span>
                <button onClick={() => setMuted((m) => !m)} className="rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-neutral-200 hover:bg-black" title={muted ? 'Unmute' : 'Mute'}>{muted ? '🔇' : '🔊'}</button>
              </div>
            </div>
          )}
        </div>

        {/* right rail: export */}
        <aside className="space-y-3 overflow-y-auto">
          <div>
            <div className="mb-1 text-[10px] font-bold tracking-wide text-neutral-500 uppercase">Aspect</div>
            <div className="flex gap-2">
              {[{ v: false, label: '16:9' }, { v: true, label: '9:16' }].map((a) => (
                <button key={a.label} onClick={() => setVertical(a.v)} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${vertical === a.v ? 'border-[#ff3d8b] bg-[#ff3d8b]/15 text-[#ff9ac4]' : 'border-white/12 text-neutral-400'}`}>{a.label}</button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-2.5 py-2 text-[11px] text-neutral-500">
            <div className="flex justify-between"><span>Segments</span><span className="tabular-nums text-neutral-300">{segs.length}</span></div>
            <div className="flex justify-between"><span>Runtime</span><span className="tabular-nums text-neutral-300">{fmt(total)}</span></div>
            {voices.length > 0 && <div className="flex justify-between"><span>Voice lines</span><span className="tabular-nums text-neutral-300">{voices.length}</span></div>}
          </div>
          <button onClick={() => void exportFilm()} disabled={exporting || segs.length === 0} data-testid="export-film" className="btn-grad w-full rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">
            {exporting ? 'Rendering…' : '▶ Export film'}
          </button>
          {filmUrl && <a href={filmUrl} download="recut-film.mp4" className="block rounded-lg border border-white/12 py-2 text-center text-xs font-medium text-neutral-100 hover:bg-white/5">⬇ Download MP4</a>}
        </aside>
      </div>

      {/* timeline */}
      <div className="mt-3 shrink-0">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={splitAtPlayhead} disabled={segs.length === 0} data-testid="split-seg" className="btn-grad rounded-md px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40" title="Split the segment under the playhead (S)">✂ Split</button>
            {sel && (
              <button onClick={() => { withUndo(() => removeSegment(sel.id)); setSelected(null); }} data-testid="remove-seg" className="rounded-md border border-white/12 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/40" title="Remove selected segment (del)">✕ remove</button>
            )}
            {dragInfo && <span className="rounded bg-amber-400/90 px-1.5 py-0.5 font-mono text-[10px] font-bold text-black">{dragInfo}</span>}
            {sel && !dragInfo && <span className="font-mono text-[10px] tabular-nums text-neutral-500">{sel.promptName} · {sel.start.toFixed(2)}→{(sel.end ?? durOf(sel)).toFixed(2)}s</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPxPerSec((z) => Math.max(MIN_ZOOM, z * 0.8))} className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-white/5">−</button>
            <button onClick={() => { const el = railRef.current; if (el && total > 0) setPxPerSec(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (el.clientWidth - 48) / total))); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-white/5" title="Fit the whole film">fit</button>
            <button onClick={() => setPxPerSec((z) => Math.min(MAX_ZOOM, z * 1.25))} className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-white/5">＋</button>
          </div>
        </div>

        <div ref={railRef} className="overflow-x-auto rounded-xl border border-white/8 bg-black/40" data-testid="film-cut">
          <div
            className="relative"
            style={{ width: contentW }}
            onClick={(e) => {
              if (justDragged.current) return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              seek((e.clientX - rect.left - 8) / pxPerSec, isPlaying);
            }}
          >
            {/* ruler */}
            <div className="relative h-5 border-b border-white/8 select-none">
              {ticks.map((t) => (
                <span key={t} className="absolute bottom-0 border-l border-white/15 pl-1 font-mono text-[8px] text-neutral-600" style={{ left: 8 + t * pxPerSec, height: t % (tickStep * 5) === 0 ? 14 : 7 }}>
                  {t % (tickStep * 5) === 0 ? `${t}s` : ''}
                </span>
              ))}
            </div>
            {/* segments */}
            <div className="flex h-24 items-stretch gap-px py-1 pl-2">
              {segs.map((sg) => {
                const w = Math.max(24, lenOf(sg) * pxPerSec);
                const isSel = selected === sg.id;
                return (
                  <div
                    key={sg.id}
                    draggable
                    onClick={(e) => { if (justDragged.current) { e.stopPropagation(); return; } setSelected(isSel ? null : sg.id); }}
                    onDragStart={(e) => e.dataTransfer.setData('seg', sg.id)}
                    onDragOver={(e) => { e.preventDefault(); setDropTarget(sg.id); }}
                    onDragLeave={() => setDropTarget((d) => (d === sg.id ? null : d))}
                    onDrop={(e) => { e.preventDefault(); setDropTarget(null); const from = e.dataTransfer.getData('seg'); if (from) withUndo(() => moveSegmentTo(from, sg.id)); }}
                    data-testid={`seg-${sg.id}`}
                    style={{ width: w }}
                    className={`group relative shrink-0 cursor-pointer overflow-hidden rounded-md border bg-neutral-900 ${isSel ? 'border-[#ff3d8b] ring-1 ring-[#ff3d8b]/50' : 'border-white/10 hover:border-white/30'} ${dropTarget === sg.id ? 'ring-2 ring-sky-400/70' : ''}`}
                    title={`${sg.promptName} · ${sg.start.toFixed(1)}→${(sg.end ?? durOf(sg)).toFixed(1)}s · click to seek+select, drag edges to trim`}
                  >
                    <video src={sg.url} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
                    <span className="absolute top-0.5 left-1.5 rounded bg-black/70 px-1 font-mono text-[9px] font-bold text-neutral-200">{sg.promptName}</span>
                    <span className="absolute bottom-0.5 left-1.5 rounded bg-black/70 px-1 font-mono text-[8px] text-neutral-400">{lenOf(sg).toFixed(1)}s</span>
                    {(sg.start > 0 || sg.end !== undefined) && <span className="absolute right-1.5 bottom-0.5 rounded bg-amber-400/90 px-1 font-mono text-[8px] font-bold text-black">✂</span>}
                    <div onPointerDown={(e) => dragEdge(e, sg, 'l')} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-gradient-to-r from-[#ff3d8b]/50 to-transparent opacity-40 group-hover:opacity-100" />
                    <div onPointerDown={(e) => dragEdge(e, sg, 'r')} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-gradient-to-l from-[#ff3d8b]/50 to-transparent opacity-40 group-hover:opacity-100" />
                  </div>
                );
              })}
            </div>
            {/* voice track row */}
            {voices.length > 0 && (
              <div className="flex h-6 items-center gap-1 border-t border-white/8 py-0.5 pl-2">
                {voices.map((u, i) => (
                  <span key={i} className="rounded bg-pink-500/15 px-1.5 py-0.5 text-[9px] text-pink-300" title={u}>🔊 voice {i + 1}</span>
                ))}
                <span className="pl-1 text-[9px] text-neutral-700">mixed over the cut on export</span>
              </div>
            )}
            {/* playhead */}
            {segs.length > 0 && (
              <div className="pointer-events-none absolute top-0 bottom-0 z-10" style={{ left: 8 + T * pxPerSec }}>
                <div className="h-full w-px bg-[#ff3d8b]" />
                <div className="absolute -top-0.5 -left-[5px] h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[#ff3d8b]" />
              </div>
            )}
          </div>
        </div>

        {binTakes.length > 0 && (
          <div className="mt-2 flex items-center gap-2 overflow-x-auto rounded-xl border border-white/8 bg-white/[0.02] px-2.5 py-1.5" data-testid="media-bin">
            <span className="shrink-0 text-[9px] font-bold tracking-wide text-neutral-500 uppercase">Bin · {binTakes.length}</span>
            {binTakes.map((t) => (
              <button
                key={t.id}
                onClick={() => withUndo(() => appendSegment(t.id))}
                data-testid={`bin-${t.id}`}
                title={`${t.promptName}: add to the end of the timeline`}
                className="group relative h-12 w-20 shrink-0 overflow-hidden rounded-md border border-white/10 hover:border-[#ff3d8b]/60"
              >
                <video src={t.url} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
                <span className="absolute top-0.5 left-1 rounded bg-black/70 px-1 font-mono text-[8px] font-bold text-neutral-200">{t.promptName}</span>
                <span className="absolute inset-0 hidden place-items-center bg-black/50 text-sm font-bold text-white group-hover:grid">＋</span>
              </button>
            ))}
            <span className="shrink-0 text-[9px] text-neutral-700">click to add · starring in Shots also adds</span>
          </div>
        )}
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10px] text-neutral-700">space play · click timeline to seek · S split at playhead · del remove · ⌘Z undo · drag edges trim · drag body reorder · scroll zoom</span>
          {doc.timeline && (
            <button onClick={() => { withUndo(() => resetTimeline()); }} className="text-[10px] text-neutral-600 underline hover:text-neutral-400" title="Discard all trims/splits, rebuild from the starred keepers">reset to keepers</button>
          )}
        </div>
      </div>
    </div>
  );
}
