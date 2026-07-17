'use client';

// The judge demo: a read-only, step-through replay of how the agent made a film.
// Every frame shown is the project's REAL media; the steps mirror the pipeline stages.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { filmSegments, type PipelineDoc } from '../../lib/pipeline/doc';

interface StepDef {
  kind: 'title' | 'cast' | 'script' | 'scene' | 'film' | 'end';
  sceneIdx?: number;
}

export function Walkthrough({ projectId, title }: { projectId: string; title: string }) {
  const [doc, setDoc] = useState<PipelineDoc | null>(null);
  const [step, setStep] = useState(0);
  const playerRef = useRef<HTMLVideoElement>(null);
  const playIdx = useRef(-1);

  useEffect(() => {
    fetch(`/api/pipeline/${projectId}`).then(async (r) => setDoc((await r.json()) as PipelineDoc));
  }, [projectId]);

  const steps = useMemo<StepDef[]>(() => {
    if (!doc) return [{ kind: 'title' }];
    return [
      { kind: 'title' },
      { kind: 'cast' },
      { kind: 'script' },
      ...doc.scenes.map((_, i) => ({ kind: 'scene' as const, sceneIdx: i })),
      { kind: 'film' },
      { kind: 'end' },
    ];
  }, [doc]);

  const next = useCallback(() => setStep((s) => Math.min(s + 1, steps.length - 1)), [steps.length]);
  const prev = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); next(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

  // the final-cut player: plays the film's segments back to back, trims honored
  const segs = doc ? filmSegments(doc) : [];
  const current = steps[step]!;
  useEffect(() => {
    const v = playerRef.current;
    if (!v || current.kind !== 'film' || segs.length === 0) return;
    playIdx.current = 0;
    const load = (i: number) => {
      const sg = segs[i];
      if (!sg) return;
      playIdx.current = i;
      v.src = sg.url;
      v.currentTime = sg.start;
      void v.play().catch(() => undefined);
    };
    const onTime = () => {
      const sg = segs[playIdx.current];
      if (sg?.end !== undefined && v.currentTime >= sg.end - 0.03) v.dispatchEvent(new Event('ended'));
    };
    const onEnded = () => load((playIdx.current + 1) % segs.length);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    load(0);
    return () => { v.removeEventListener('timeupdate', onTime); v.removeEventListener('ended', onEnded); v.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.kind, doc]);

  if (!doc) return <main className="grid h-screen place-items-center bg-[#07070c] text-sm text-neutral-500">Loading the film…</main>;

  const cast = doc.assets.filter((a) => a.locked && a.imageUrl);
  const voices = doc.takes.filter((t) => t.kind === 'audio');

  return (
    <main className="brand-ambience flex h-screen flex-col bg-[#07070c]" data-testid="walkthrough">
      <header className="flex items-center justify-between border-b border-white/8 px-5 py-2.5">
        <Link href="/demo" className="flex items-center gap-2">
          <span className="brand-mark h-5 w-5 text-[10px] font-black">R</span>
          <span className="text-sm font-bold tracking-tight text-neutral-100">Recut</span>
          <span className="text-xs text-neutral-500">/ demo / {title}</span>
        </Link>
        <div className="flex items-center gap-1.5" data-testid="step-dots">
          {steps.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-[#ff3d8b]' : 'w-1.5 bg-white/20 hover:bg-white/40'}`} />
          ))}
        </div>
        <Link href={`/project/${projectId}/pipeline`} className="text-[11px] text-neutral-600 hover:text-neutral-300">open in Recut ↗</Link>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {current.kind === 'title' && (
          <div className="grid h-full place-items-center px-8 text-center">
            <div>
              <p className="reveal text-[11px] font-bold tracking-[0.2em] text-neutral-500 uppercase">Recut · AI Showrunner demo</p>
              <h1 className="reveal mt-4 max-w-3xl text-6xl leading-[1.02] font-extrabold tracking-tight" style={{ animationDelay: '.15s' }}>{title}</h1>
              <p className="reveal mt-5 text-lg text-neutral-400" style={{ animationDelay: '.3s' }}>
                One pipeline: <span className="text-neutral-200">cast</span> → <span className="text-neutral-200">script</span> → <span className="text-neutral-200">shots</span> → <span className="text-neutral-200">the cut</span>. Watch how the agent made it.
              </p>
              <p className="reveal mt-8 text-xs text-neutral-600" style={{ animationDelay: '.45s' }}>→ or space to step through</p>
            </div>
          </div>
        )}

        {current.kind === 'cast' && (
          <div className="mx-auto max-w-4xl px-8 py-12">
            <StepHeading n={1} title="The agent casts the film" sub="Locked references, named by registry slug. Every future shot binds to these exact images: this is what keeps characters on-model." />
            <div className="mt-8 grid grid-cols-3 gap-4">
              {cast.map((a, i) => (
                <figure key={a.id} className="reveal overflow-hidden rounded-2xl border border-emerald-500/25 bg-white/[0.02]" style={{ animationDelay: `${0.15 + i * 0.15}s` }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.imageUrl} alt={a.slug} className="aspect-video w-full object-cover" />
                  <figcaption className="flex items-center justify-between px-3 py-2">
                    <span className="font-mono text-xs text-neutral-200">🔒 {a.slug}</span>
                    <span className="text-[10px] text-neutral-500">{a.kind}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        {current.kind === 'script' && (
          <div className="mx-auto max-w-3xl px-8 py-12">
            <StepHeading n={2} title="The script becomes a shotlist" sub="A director skill turns the script into named cuts with blocking, acting beats, and camera presets, referencing the cast by name." />
            {doc.stylePrefix && (
              <div className="reveal mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4" style={{ animationDelay: '.15s' }}>
                <p className="grad-text mb-1 text-[10px] font-bold tracking-wide uppercase">Global style · glued to every cut</p>
                <p className="text-sm leading-relaxed text-neutral-300">{doc.stylePrefix}</p>
              </div>
            )}
            <div className="reveal mt-4 rounded-xl border border-white/10 bg-black/30 p-4" style={{ animationDelay: '.3s' }}>
              <p className="mb-1 text-[10px] font-bold tracking-wide text-neutral-500 uppercase">Script</p>
              <p className="text-sm whitespace-pre-wrap text-neutral-400">{doc.script?.trim() || 'Drafted from a one-line premise.'}</p>
            </div>
          </div>
        )}

        {current.kind === 'scene' && (() => {
          const scene = doc.scenes[current.sceneIdx!]!;
          return (
            <div className="mx-auto max-w-5xl px-8 py-12">
              <StepHeading n={3 + current.sceneIdx!} title={`Scene ${current.sceneIdx! + 1}`} sub="Each cut: directed prompt + camera presets + reference bindings. The agent shoots takes; the ★ keeper joins the film." />
              {scene.prompts.map((p) => {
                const takes = doc.takes.filter((t) => t.promptName === p.name && t.kind === 'video');
                return (
                  <div key={p.name} className="reveal mt-6" style={{ animationDelay: '.15s' }}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="grad-text font-mono text-lg font-black">{p.name}</span>
                      {[p.shotSize, p.angle, p.lens, p.light].filter(Boolean).map((c) => (
                        <span key={c} className="rounded-full border border-[#ff3d8b]/40 bg-[#ff3d8b]/10 px-2 py-0.5 text-[10px] text-[#ff9ac4]">{c}</span>
                      ))}
                      {p.assetSlugs.map((sl) => (
                        <span key={sl} className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] text-neutral-500">@{sl}</span>
                      ))}
                    </div>
                    <p className="mb-3 max-w-3xl text-sm leading-relaxed text-neutral-400">{p.text}</p>
                    {p.dialogue && <p className="mb-3 text-sm text-pink-300/90">🔊 “{p.dialogue}”</p>}
                    <div className="grid grid-cols-2 gap-3">
                      {takes.map((t) => (
                        <div key={t.id} className={`relative overflow-hidden rounded-xl border ${t.keeper ? 'border-amber-400/60' : 'border-white/10'}`}>
                          <video src={t.url} controls muted loop playsInline preload="metadata" className="aspect-video w-full bg-black object-cover" />
                          {t.keeper && <span className="absolute top-2 right-2 rounded-md bg-amber-400/90 px-1.5 py-0.5 text-xs font-bold text-black">★ keeper</span>}
                        </div>
                      ))}
                      {takes.length === 0 && <p className="text-xs text-neutral-600">(image-only cut)</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {current.kind === 'film' && (
          <div className="mx-auto max-w-4xl px-8 py-10">
            <StepHeading n={3 + doc.scenes.length} title="The final cut" sub={`${segs.length} keeper segments, trimmed and ordered on the timeline${voices.length ? `, voice mixed over` : ''}. Exported with ffmpeg: no model calls.`} />
            <video ref={playerRef} controls playsInline className="reveal mt-6 aspect-video w-full rounded-2xl border border-white/10 bg-black" style={{ animationDelay: '.15s' }} data-testid="final-cut" />
            <p className="mt-2 text-center text-[11px] text-neutral-600">playing the timeline's segments back to back, trims honored</p>
          </div>
        )}

        {current.kind === 'end' && (
          <div className="grid h-full place-items-center px-8 text-center">
            <div>
              <h2 className="reveal max-w-3xl text-5xl leading-[1.05] font-extrabold tracking-tight">
                Every other tool gives you shots.<br />Recut gives you a <span className="serif-em grad-text">series</span>.
              </h2>
              <p className="reveal mt-6 text-neutral-400" style={{ animationDelay: '.2s' }}>
                {cast.length} locked cast · {doc.scenes.length} scenes · {doc.takes.filter((t) => t.kind === 'video').length} generated clips · one consistent film
              </p>
              <div className="reveal mt-8 flex items-center justify-center gap-3" style={{ animationDelay: '.35s' }}>
                <Link href={`/project/${projectId}/pipeline`} className="btn-grad rounded-xl px-6 py-3 text-sm font-semibold">Open in Recut →</Link>
                <Link href="/demo" className="rounded-xl border border-white/12 px-5 py-3 text-sm text-neutral-300 hover:bg-white/5">More demos</Link>
              </div>
            </div>
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-white/8 px-5 py-3">
        <button onClick={prev} disabled={step === 0} className="rounded-lg border border-white/12 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5 disabled:opacity-30">← Back</button>
        <span className="text-[11px] text-neutral-600">step {step + 1} / {steps.length}</span>
        <button onClick={next} disabled={step === steps.length - 1} data-testid="demo-next" className="btn-grad rounded-lg px-6 py-2 text-sm font-semibold disabled:opacity-30">Next →</button>
      </footer>
    </main>
  );
}

function StepHeading({ n, title, sub }: { n: number; title: string; sub: string }) {
  return (
    <div className="reveal">
      <p className="text-[10px] font-bold tracking-[0.2em] text-neutral-500 uppercase">Step {n}</p>
      <h2 className="mt-1 text-3xl font-extrabold tracking-tight">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm text-neutral-400">{sub}</p>
    </div>
  );
}
