'use client';

// The guided demo tour: the REAL product UI with coach-mark popups anchored to the actual
// controls. Each step can steer the Monitor (switch stage, select a cut) before pointing.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePipeline } from '../../lib/pipeline/usePipeline';

export type TourSel = { t: 'cut'; name: string } | { t: 'casting' } | { t: 'script' } | { t: 'export' };

interface TourStep {
  /** css selector of the anchor; null = centered modal */
  target: string | null;
  title: string;
  body: string;
  placement?: 'right' | 'left' | 'below' | 'above';
  /** steer the app before pointing (switch stage, select first cut, …) */
  before?: (ctx: { setSel: (s: TourSel) => void; firstCut?: string }) => void;
}

const STEPS: TourStep[] = [
  { target: null, title: 'This is Recut', body: 'What you see is the real product, not a mockup. Step through how this film was made: → / space to advance, esc to explore freely.' },
  { target: '[data-testid=rail]', title: '1 · The cast', body: 'Locked references, named by slug. Every shot binds to these exact images: that is what keeps characters on-model across the whole film.', placement: 'right', before: ({ setSel }) => setSel({ t: 'casting' }) },
  { target: '[data-testid=candidate-prompt]', title: 'Casting works like this', body: 'Describe a member here, generate a batch of candidates, click one to iterate on it, ＋ Cast the winner, then name and 🔒 lock it in the rail.', placement: 'above' },
  { target: '[data-testid=beats]', title: '2 · The script', body: 'Paste a script or a one-line premise. The director skill breaks it into named cuts with blocking, acting beats, and camera presets, referencing your cast by name.', placement: 'right', before: ({ setSel }) => setSel({ t: 'script' }) },
  { target: '[data-testid=storyboard]', title: '3 · The storyboard', body: 'The film’s spine. One cell per cut; thumbnails fill in as shots complete. Click any cell to work on that cut; ★ marks a chosen keeper.', placement: 'below', before: ({ setSel, firstCut }) => firstCut && setSel({ t: 'cut', name: firstCut }) },
  { target: '[data-testid=cut-controls]', title: 'Directing a cut', body: 'The prompt, camera presets (shot/angle/lens/light), and @cast references live here. 🎥 Takes generates video DIRECTLY from this description with the locked cast as references.', placement: 'above' },
  { target: '[data-testid=cut-stage]', title: 'Compare, then keep', body: 'Takes land here, big, side by side. Judge scores advise; your eye decides. ★ the keeper: it represents this cut in the film.', placement: 'below' },
  { target: '[data-testid=film-cut]', title: '4 · The edit', body: 'A real timeline: drag edges to trim, S splits at the playhead, drag clips from the media panel, scroll to zoom, ⌘Z undoes. The player above always plays YOUR cut.', placement: 'above', before: ({ setSel }) => setSel({ t: 'export' }) },
  { target: '[data-testid=export-film]', title: 'Export', body: 'One click renders the timeline with ffmpeg (trims, order, native audio beds, voice mix) and saves the MP4 locally. It never touches your edit.', placement: 'left' },
  { target: null, title: 'Every other tool gives you shots.', body: 'Recut gives you a series. Explore this project freely: everything you just saw is live.' },
];

export function Tour({ setSel, onExit }: { setSel: (s: TourSel) => void; onExit: () => void }) {
  const doc = usePipeline((s) => s.doc);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const raf = useRef<number>(0);
  const step = STEPS[i]!;
  const firstCut = doc.scenes[0]?.prompts[0]?.name;

  const go = useCallback((n: number) => {
    const ni = Math.max(0, Math.min(n, STEPS.length - 1));
    const s = STEPS[ni]!;
    s.before?.({ setSel, firstCut });
    setI(ni);
  }, [setSel, firstCut]);

  // track the anchor's rect (post-steer layout settles async, so poll via rAF)
  useEffect(() => {
    const tick = () => {
      if (step.target) {
        const el = document.querySelector(step.target);
        if (el) {
          const r = el.getBoundingClientRect();
          setRect((old) => (old && Math.abs(old.x - r.x) < 1 && Math.abs(old.y - r.y) < 1 && Math.abs(old.width - r.width) < 1 ? old : r));
        } else setRect(null);
      } else setRect(null);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [step.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); go(i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
      else if (e.key === 'Escape') { e.preventDefault(); onExit(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [i, go, onExit]);

  // popup placement relative to the anchor, clamped to the viewport
  const pos = (() => {
    const W = 340;
    const H = 170;
    if (!rect) return { left: window.innerWidth / 2 - W / 2, top: window.innerHeight / 2 - H / 2, centered: true };
    const pad = 14;
    let left = rect.right + pad;
    let top = rect.top;
    if (step.placement === 'left') { left = rect.left - W - pad; top = rect.top; }
    if (step.placement === 'below') { left = rect.left; top = rect.bottom + pad; }
    if (step.placement === 'above') { left = rect.left; top = rect.top - H - pad; }
    left = Math.max(12, Math.min(left, window.innerWidth - W - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - H - 12));
    return { left, top, centered: false };
  })();

  return (
    <>
      {/* spotlight ring around the anchored control */}
      {rect && (
        <div
          className="pointer-events-none fixed z-[90] rounded-xl transition-all duration-300"
          style={{
            left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12,
            boxShadow: '0 0 0 3px rgba(255,61,139,.85), 0 0 0 9999px rgba(0,0,0,.45)',
          }}
        />
      )}
      {!rect && <div className="pointer-events-none fixed inset-0 z-[90] bg-black/55" />}

      <div className="fixed z-[95] w-[340px] rounded-2xl border border-white/15 bg-[#14121d] p-4 shadow-2xl" style={{ left: pos.left, top: pos.top }} data-testid="tour-popup">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="grad-text text-[10px] font-bold tracking-wide uppercase">Guided demo · {i + 1}/{STEPS.length}</span>
          <button onClick={onExit} data-testid="tour-exit" className="text-xs text-neutral-500 hover:text-neutral-200" title="Exit the tour (esc)">✕</button>
        </div>
        <h3 className="text-base font-extrabold tracking-tight text-neutral-100">{step.title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">{step.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => go(i - 1)} disabled={i === 0} className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-30">← Back</button>
          <div className="flex items-center gap-1">
            {STEPS.map((_, d) => (
              <span key={d} className={`h-1 rounded-full ${d === i ? 'w-4 bg-[#ff3d8b]' : 'w-1 bg-white/20'}`} />
            ))}
          </div>
          {i < STEPS.length - 1 ? (
            <button onClick={() => go(i + 1)} data-testid="tour-next" className="btn-grad rounded-lg px-4 py-1.5 text-xs font-semibold">Next →</button>
          ) : (
            <button onClick={onExit} data-testid="tour-next" className="btn-grad rounded-lg px-4 py-1.5 text-xs font-semibold">Explore ✓</button>
          )}
        </div>
      </div>
    </>
  );
}
