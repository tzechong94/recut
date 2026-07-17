'use client';

// The guided demo: a SIMULATED live session on the real product. The project starts empty;
// each Next types the real prompts into the real inputs, shows a believable generating beat,
// then reveals the project's pre-made media as if freshly created. Nothing persists
// (store demo mode) and nothing is spent: it is a scripted replay of how the film was made.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePipeline, setDemoMode } from '../../lib/pipeline/usePipeline';
import type { AssetDoc, PipelineDoc } from '../../lib/pipeline/doc';

export type TourSel = { t: 'cut'; name: string } | { t: 'casting' } | { t: 'script' } | { t: 'export' };

// The pristine project, captured ONCE per tour run and held outside the component: a mid-show
// remount (fast refresh, error boundary) must never re-capture a staged doc as 'the original'.
const pristine = new Map<string, { doc: PipelineDoc; spentUsd: number; capUsd: number | null }>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Type into a REAL React-controlled input using the native value setter (demo magic). */
async function typeInto(selector: string, text: string): Promise<void> {
  const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return;
  el.focus();
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  const chunk = Math.max(1, Math.ceil(text.length / 90)); // whole prompt lands in ~2s
  let cur = '';
  for (let i = 0; i < text.length; i += chunk) {
    cur = text.slice(0, i + chunk);
    setter.call(el, cur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(22);
  }
}

/** Set a REAL React-controlled <select> (native setter + change event). */
function selectValue(selector: string, value: string): void {
  const el = document.querySelector(selector) as HTMLSelectElement | null;
  if (!el) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Instantly clear a React-controlled input (a finished field should not linger into the next beat). */
function clearInput(selector: string): void {
  const el = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function castingPromptFor(a: AssetDoc): string {
  const nice = a.slug.replace(/_/g, ' ');
  if (a.kind === 'character') return `two-panel character sheet of ${nice}: closeup face and full body on a clean background, exactly on-model`;
  if (a.kind === 'location') return `${nice}, seen from a three-quarter angle, warm natural light, no people`;
  return `clean reference sheet of ${nice}, front and three-quarter views`;
}

interface TourStep {
  target: string | null;
  title: string;
  body: string;
  nextLabel?: string;
  prep?: () => void; // steer the UI before showing the popup
  action?: (setBusyLine: (s: string | null) => void) => Promise<void>; // runs when Next is clicked
}

export function Tour({ projectId, setSel, onExit }: { projectId: string; setSel: (s: TourSel) => void; onExit: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const raf = useRef(0);
  const full = useRef<PipelineDoc | null>(null);
  const ledger = useRef<{ spentUsd: number; capUsd: number | null }>({ spentUsd: 0, capUsd: null });
  const steps = useRef<TourStep[]>([]);

  const stage = useCallback((patch: Partial<PipelineDoc>) => {
    const cur = usePipeline.getState().doc;
    usePipeline.setState({ doc: { ...cur, ...patch } });
  }, []);
  const busyLine = useCallback((s: string | null) => usePipeline.setState({ busy: s }), []);

  // build the script of the show from the finished project, then strip the stage bare
  useEffect(() => {
    const st = usePipeline.getState();
    if (!pristine.has(projectId)) {
      pristine.set(projectId, { doc: JSON.parse(JSON.stringify(st.doc)) as PipelineDoc, spentUsd: st.spentUsd, capUsd: st.capUsd });
    }
    const saved = pristine.get(projectId)!;
    full.current = saved.doc;
    ledger.current = { spentUsd: saved.spentUsd, capUsd: saved.capUsd };
    const f = full.current;
    setDemoMode(true);
    const charge = (usd: number) => {
      const cur = usePipeline.getState().spentUsd;
      usePipeline.setState({ spentUsd: cur + usd });
    };

    const cast = f.assets.filter((a) => a.locked && a.imageUrl).slice(0, 3);
    // each scene is two beats: GENERATE (the fake render + reveal), then LINGER on the
    // result so the judge can actually press play before the tour moves on
    const sceneSteps: TourStep[] = f.scenes.flatMap((scene, si) => {
      const names = scene.prompts.map((p) => p.name);
      const shoot: TourStep = {
        target: '[data-testid=cut-controls]',
        title: `Shooting ${names.join(' + ')}`,
        body: `This cut's description + the locked cast go straight to the video model as bound references. (Replayed instantly here; live it takes 1-2 minutes.)`,
        nextLabel: `🎥 Generate ${names[0]}`,
        prep: () => setSel({ t: 'cut', name: names[0]! }),
        action: async (line) => {
          line(`rendering ${names.join(', ')}`);
          await sleep(1500);
          charge(0.6 * names.length);
          const upto = f.scenes.slice(0, si + 1).flatMap((sc) => sc.prompts.map((p) => p.name));
          stage({ takes: f.takes.filter((t) => upto.includes(t.promptName)) });
          line(null);
          await sleep(200);
          // the fresh clip starts playing by itself: the reveal feels alive. If the browser
          // blocks unmuted autoplay, retry muted so the frame still comes up moving.
          const v = document.querySelector('[data-testid=cut-stage] video') as HTMLVideoElement | null;
          v?.play().catch(() => {
            v.muted = true;
            v.play().catch(() => { v.currentTime = 0.05; }); // last resort: paint a real frame
          });
          await sleep(200);
        },
      };
      const review: TourStep = {
        target: '[data-testid=cut-stage]',
        title: `${names.join(' + ')} ${names.length > 1 ? 'are' : 'is'} in`,
        body: `Press ▶ on the clip to watch what was just generated. The ★ marks it as the keeper: the take that represents this cut in the film.${names.length > 1 ? ` The stage shows ${names[0]}; click ${names.slice(1).join(', ')} in the storyboard to see the rest.` : ''} Take your time; Next when ready.`,
        nextLabel: si + 1 < f.scenes.length ? `On to Scene ${si + 2} →` : 'To the edit →',
      };
      return [shoot, review];
    });

    steps.current = [
      {
        target: null,
        title: 'This is Recut, live',
        body: 'The real product, an empty project. Watch the agent cast, script, shoot, and cut this film in front of you. → or the buttons to drive.',
        prep: () => {
          stage({ assets: [], candidates: [], scenes: [], takes: [], timeline: undefined, stylePrefix: '', script: '' });
          usePipeline.setState({ spentUsd: 0 }); // the demo ledger tells its own story
          setSel({ t: 'casting' });
        },
        nextLabel: 'Start casting →',
      },
      ...cast.map((a, ci) => ({
        target: '[data-testid=candidate-prompt]',
        title: `Casting: ${a.slug}`,
        body: 'The prompt goes right here. Generate candidates, crown the winner, lock it into the cast rail.',
        nextLabel: `✨ Generate ${a.slug}`,
        action: async (line: (s: string | null) => void) => {
          selectValue('[data-testid=cast-kind]', a.kind); // character / location, not the default
          selectValue('[data-testid=cast-count]', '1');
          await sleep(250);
          await typeInto('[data-testid=candidate-prompt]', castingPromptFor(a));
          line('candidate 1/1');
          await sleep(1300);
          charge(0.05);
          stage({ candidates: [{ id: `demo_${a.id}`, kind: a.kind, url: a.imageUrl!, prompt: castingPromptFor(a) }] });
          line(null);
          await sleep(900);
          // replaying a step (back then forward) must not double-cast the member
          const prev = usePipeline.getState().doc.assets.filter((x) => x.id !== a.id);
          stage({ assets: [...prev, a], candidates: [] });
          clearInput('[data-testid=candidate-prompt]'); // field resets for the next member
          await sleep(400);
        },
      })),
      {
        target: '[data-testid=beats]',
        title: 'The script',
        body: 'Paste a script or a premise. The director skill (seedance discipline) writes named cuts with blocking, acting beats, and camera presets, bound to the cast by name.',
        nextLabel: '🎬 Draft the shots',
        prep: () => setSel({ t: 'script' }),
        action: async (line) => {
          const castNames = f.assets.filter((a) => a.locked).map((a) => a.slug.replace(/_/g, ' ')).join(', ');
          await typeInto('[data-testid=beats]', (f.script ?? '').trim() || `A short film starring ${castNames || 'the cast'}: one beat per scene, ending on a hero shot.`);
          line('directing');
          await sleep(1500);
          charge(0.01);
          stage({ scenes: f.scenes, stylePrefix: f.stylePrefix, script: f.script });
          line(null);
          await sleep(300);
        },
      },
      {
        target: '[data-testid=storyboard]',
        title: 'The shotlist lands',
        body: 'One cell per cut: the film’s spine. Camera presets arrived pre-set from the director; every cut lists its @cast references. Now we shoot.',
        prep: () => {
          const firstName = f.scenes[0]?.prompts[0]?.name;
          if (firstName) setSel({ t: 'cut', name: firstName });
        },
      },
      ...sceneSteps,
      {
        target: '[data-testid=film-cut]',
        title: 'The edit',
        body: 'Keepers land on a real timeline: drag edges to trim, S splits at the playhead, drag clips in from the media panel, scroll to zoom, ⌘Z undoes.',
        prep: () => setSel({ t: 'export' }),
      },
      {
        target: '[data-testid=export-film]',
        title: 'Export',
        body: 'ffmpeg renders the timeline: trims, order, the clips’ native audio beds, the voice line mixed over. Saves an MP4 locally; never touches the edit.',
      },
      {
        target: null,
        title: 'Every other tool gives you shots.',
        body: 'Recut gives you a series. This project is now fully live: explore anything you just watched.',
        nextLabel: 'Explore ✓',
        prep: () => {
          if (full.current) usePipeline.setState({ doc: full.current });
        },
      },
    ];
    steps.current[0]!.prep?.();
    setI(0);

    return () => {
      if (full.current) usePipeline.setState({ doc: full.current, busy: null, ...ledger.current });
      setDemoMode(false);
    };
    // (pristine entry is cleared in exit(); a remount mid-show reuses it instead of re-capturing)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = steps.current[i];

  const go = useCallback(async (n: number) => {
    if (running) return;
    const cur = steps.current[i];
    if (n > i && cur?.action) {
      setRunning(cur.nextLabel ?? 'working');
      try { await cur.action(busyLine); } finally { setRunning(null); busyLine(null); }
    }
    const ni = Math.max(0, Math.min(n, steps.current.length - 1));
    steps.current[ni]?.prep?.();
    setI(ni);
  }, [i, running, busyLine]);

  const exit = useCallback(() => {
    if (full.current) usePipeline.setState({ doc: full.current, busy: null, ...ledger.current });
    pristine.delete(projectId);
    setDemoMode(false);
    onExit();
  }, [onExit, projectId]);

  // anchor tracking
  useEffect(() => {
    const tick = () => {
      const target = steps.current[i]?.target;
      if (target) {
        const el = document.querySelector(target);
        if (el) {
          const r = el.getBoundingClientRect();
          setRect((old) => (old && Math.abs(old.x - r.x) < 1 && Math.abs(old.y - r.y) < 1 && Math.abs(old.width - r.width) < 1 ? old : r));
        } else setRect(null);
      } else setRect(null);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); void go(i + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); void go(i - 1); }
      else if (e.key === 'Escape') { e.preventDefault(); exit(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [i, go, exit]);

  if (!step) return null;
  const W = 350;
  const pos = (() => {
    if (!rect) return { left: window.innerWidth / 2 - W / 2, top: window.innerHeight / 2 - 110 };
    const pad = 14;
    // full-width bars (storyboard, cut controls): go below or above, never on top of the highlight
    if (rect.width > window.innerWidth * 0.6 && rect.height <= window.innerHeight * 0.6) {
      const left = Math.min(Math.max(12, rect.left + 16), window.innerWidth - W - 12);
      const top = rect.top < window.innerHeight / 2
        ? Math.min(rect.bottom + pad, window.innerHeight - 232)
        : Math.max(12, rect.top - 210 - pad);
      return { left, top };
    }
    let left = rect.right + pad;
    let top = rect.top;
    if (left + W > window.innerWidth - 12) left = Math.max(12, rect.left - W - pad);
    if (top + 210 > window.innerHeight) top = Math.max(12, window.innerHeight - 222);
    if (rect.height > window.innerHeight * 0.6) top = Math.max(12, rect.top + 40);
    return { left, top };
  })();

  return (
    <>
      {rect && (
        <div
          className="pointer-events-none fixed z-[90] rounded-xl transition-all duration-300"
          style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: '0 0 0 3px rgba(255,61,139,.85), 0 0 0 9999px rgba(0,0,0,.45)' }}
        />
      )}
      {!rect && <div className="pointer-events-none fixed inset-0 z-[90] bg-black/55" />}

      <div className="fixed z-[95] w-[350px] rounded-2xl border border-white/15 bg-[#14121d] p-4 shadow-2xl" style={{ left: pos.left, top: pos.top }} data-testid="tour-popup">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="grad-text text-[10px] font-bold tracking-wide uppercase">Live demo · {i + 1}/{steps.current.length}</span>
          <button onClick={exit} data-testid="tour-exit" className="text-xs text-neutral-500 hover:text-neutral-200" title="Exit (esc)">✕</button>
        </div>
        <h3 className="text-base font-extrabold tracking-tight text-neutral-100">{step.title}</h3>
        <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">{step.body}</p>
        <div className="mt-3 flex items-center justify-between">
          <button onClick={() => void go(i - 1)} disabled={i === 0 || !!running} className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-30">←</button>
          <div className="h-1 w-20 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-[#ff3d8b] transition-all duration-300" style={{ width: `${((i + 1) / steps.current.length) * 100}%` }} />
          </div>
          {i < steps.current.length - 1 ? (
            <button onClick={() => void go(i + 1)} disabled={!!running} data-testid="tour-next" className="btn-grad rounded-lg px-4 py-1.5 text-xs font-semibold disabled:opacity-60">
              {running ? '● generating…' : (step.nextLabel ?? 'Next →')}
            </button>
          ) : (
            <button onClick={exit} data-testid="tour-next" className="btn-grad rounded-lg px-4 py-1.5 text-xs font-semibold">Explore ✓</button>
          )}
        </div>
      </div>
    </>
  );
}
