'use client';

// The Director's Monitor: the whole product on one screen, one loop everywhere.
// Steps: CAST (the cast rail + candidate stage) → SCRIPT (the director skill turns the
// script into shots) → SHOTS (takes compared big, crowned) → EDIT (the cut, export).
// LEFT the cast (only in Cast/Script) · TOP the storyboard · CENTER the stage · BOTTOM controls.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePipeline } from '../../lib/pipeline/usePipeline';
import {
  compilePromptText,
  filmSegments,
  keeperClips,
  resolveAssets,
  takesFor,
  voiceTracks,
  type AssetKind,
  type PromptDoc,
  type TakeDoc,
} from '../../lib/pipeline/doc';
import { classifyVerdict } from '../../lib/pipeline/taxonomy';
import { LUTS } from '../../lib/post/lut';

const ASSET_KINDS: AssetKind[] = ['product', 'character', 'location', 'prop'];
const KIND_ICON: Record<AssetKind, string> = { product: '📦', character: '🧍', location: '🏠', prop: '☕' };
const SHOT = ['extreme close-up', 'close-up', 'medium close-up', 'medium shot', 'wide shot', 'extreme wide shot'];
const ANGLE = ['low angle', 'eye level', 'high angle', 'overhead', 'three-quarter view', 'profile view'];
const LENS = ['24mm wide-angle lens', '35mm lens', '50mm lens', '85mm portrait lens', '135mm telephoto lens'];
const LIGHT = ['Rembrandt lighting', 'split lighting', 'butterfly lighting', 'loop lighting', 'high-key soft light', 'low-key dramatic light', 'natural window light', 'golden hour'];

type Sel = { t: 'cut'; name: string } | { t: 'casting' } | { t: 'script' } | { t: 'export' };
/** source image feeding candidate generation: a photo, a cast member, or a candidate to iterate on */
export interface CastSource { url: string; label: string }

export function Monitor({ projectId, title }: { projectId: string; title: string }) {
  const { doc, load, busy, error, spentUsd, capUsd } = usePipeline();
  const [sel, setSel] = useState<Sel>({ t: 'casting' });
  const [castSource, setCastSource] = useState<CastSource | undefined>(undefined);
  const booted = useRef(false);

  useEffect(() => {
    booted.current = false;
    void load(projectId);
  }, [projectId, load]);

  // land somewhere sensible once the doc arrives (once per project)
  useEffect(() => {
    if (booted.current || usePipeline.getState().loadedFor !== projectId) return;
    booted.current = true;
    const first = doc.scenes[0]?.prompts[0]?.name;
    setSel(first ? { t: 'cut', name: first } : { t: 'casting' });
  }, [doc, projectId]);

  useEffect(() => {
    const flush = () => void usePipeline.getState().save();
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('beforeunload', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  const hasShots = doc.scenes.length > 0;
  const hasKeepers = keeperClips(doc).length > 0;
  // rail everywhere except the edit room: seeing the cast helps while directing shots
  const showRail = sel.t !== 'export';
  const steps: Array<{ key: string; label: string; active: boolean; enabled: boolean; go: () => void }> = [
    { key: 'cast', label: 'Cast', active: sel.t === 'casting', enabled: true, go: () => setSel({ t: 'casting' }) },
    { key: 'script', label: 'Script', active: sel.t === 'script', enabled: true, go: () => setSel({ t: 'script' }) },
    { key: 'shots', label: 'Shots', active: sel.t === 'cut', enabled: hasShots, go: () => { const f = doc.scenes[0]?.prompts[0]?.name; if (f) setSel({ t: 'cut', name: f }); } },
    { key: 'edit', label: 'Edit', active: sel.t === 'export', enabled: hasKeepers, go: () => setSel({ t: 'export' }) },
  ];

  return (
    <main className="flex h-screen flex-col bg-[#07070c]">
      <header className="flex items-center justify-between border-b border-white/8 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="brand-mark h-5 w-5 text-[10px] font-black">R</span>
            <span className="text-sm font-bold tracking-tight text-neutral-100">Recut</span>
          </Link>
          <span className="max-w-[16rem] truncate text-xs text-neutral-500">/ {title}</span>
        </div>
        <nav className="flex items-center gap-1 text-[11px]" data-testid="steps">
          {steps.map((st, i) => (
            <span key={st.key} className="flex items-center gap-1">
              {i > 0 && <span className="text-neutral-700">→</span>}
              <button onClick={st.go} disabled={!st.enabled} data-testid={`step-${st.key}`} className={`rounded-md px-3 py-1 font-semibold disabled:opacity-40 ${st.active ? 'btn-grad' : 'text-neutral-400 hover:bg-white/5'}`}>
                {st.label}
              </button>
            </span>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {busy && <span className="animate-pulse text-[11px] text-[#ff9ac4]">{busy}…</span>}
          <span className="text-xs tabular-nums text-neutral-500" data-testid="spend">${spentUsd.toFixed(3)}{capUsd !== null ? ` / $${capUsd.toFixed(0)}` : ''}</span>
          {hasShots && <a href={`/api/shotlist/${doc.projectId}`} target="_blank" className="text-[11px] text-neutral-600 hover:text-neutral-400" title="Director's shotlist (HTML artifact)">shotlist ↧</a>}
        </div>
      </header>

      {error && <div className="border-b border-rose-900 bg-rose-950/60 px-4 py-1.5 text-xs text-rose-300">{error}</div>}

      <div className={`grid min-h-0 flex-1 ${showRail ? 'grid-cols-[13rem_1fr]' : 'grid-cols-1'}`}>
        {showRail && <CastRail setSel={setSel} setCastSource={setCastSource} />}
        <div className="flex min-h-0 flex-col">
          <Storyboard sel={sel} setSel={setSel} />
          <StylePrefixRow />
          <Stage sel={sel} setSel={setSel} castSource={castSource} setCastSource={setCastSource} />
          <ControlBar sel={sel} setSel={setSel} castSource={castSource} setCastSource={setCastSource} />
        </div>
      </div>
    </main>
  );
}

/* ---------------- the cast rail: who and what you have ---------------- */

function CastRail({ setSel, setCastSource }: { setSel: (s: Sel) => void; setCastSource: (c: CastSource | undefined) => void }) {
  const { doc, updateAsset, lockAsset, removeAsset, addAsset, setAssetImage } = usePipeline();
  const uploadRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="flex min-h-0 flex-col border-r border-white/8" data-testid="rail">
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <span className="text-[10px] font-bold tracking-wide text-neutral-500 uppercase">Cast</span>
        <button onClick={() => uploadRef.current?.click()} title="Upload an image as a cast member" className="rounded-md border border-white/12 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-white/5">⬆ upload</button>
        <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            const a = addAsset(f.name.replace(/\.[a-z]+$/i, ''), 'product');
            setAssetImage(a.id, String(r.result));
          };
          r.readAsDataURL(f);
        }} />
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
        {doc.assets.length === 0 && (
          <p className="pt-2 text-[11px] leading-relaxed text-neutral-600">Nobody cast yet. Generate candidates on the right, crown the winner, then name + lock it here.</p>
        )}
        {doc.assets.map((a) => (
          <div key={a.id} className={`group overflow-hidden rounded-lg border bg-white/[0.02] ${a.locked ? 'border-emerald-500/30' : 'border-white/10'}`} data-testid={`member-${a.id}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {a.imageUrl && <img src={a.imageUrl} alt={a.slug} className="aspect-video w-full object-cover" />}
            <div className="space-y-1 p-1.5">
              <div className="flex items-center gap-1">
                {a.locked && <span className="text-[10px]">🔒</span>}
                <input
                  value={a.slug}
                  disabled={a.locked}
                  onChange={(e) => updateAsset(a.id, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                  className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-neutral-200 outline-none disabled:border-transparent disabled:bg-transparent"
                />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => lockAsset(a.id, !a.locked)}
                  disabled={!a.imageUrl}
                  data-testid={`lock-${a.id}`}
                  className={`flex-1 rounded py-0.5 text-[10px] font-bold disabled:opacity-40 ${a.locked ? 'border border-white/12 text-neutral-400 hover:bg-white/5' : 'bg-emerald-500 text-black hover:bg-emerald-400'}`}
                >
                  {a.locked ? 'Unlock' : '🔒 Lock'}
                </button>
                {a.imageUrl && (
                  <>
                    <button
                      onClick={() => { setCastSource({ url: a.imageUrl!, label: a.slug }); setSel({ t: 'casting' }); }}
                      title="Use as the source for new candidates (e.g. re-style or make a state variant)"
                      className="rounded border border-white/12 px-1.5 text-[10px] text-neutral-300 hover:bg-white/5"
                    >
                      ↻
                    </button>
                    <a
                      href={`/api/pipeline/${doc.projectId}/download/${a.id}`}
                      title={`Download as ${a.slug}.png`}
                      data-testid={`download-${a.id}`}
                      className="rounded border border-white/12 px-1.5 text-[10px] text-neutral-300 hover:bg-white/5"
                    >
                      ⬇
                    </a>
                  </>
                )}
                {!a.locked && (
                  <button onClick={() => removeAsset(a.id)} className="rounded border border-white/12 px-1.5 text-[10px] text-rose-300 hover:bg-rose-950/40">✕</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/* ---------------- the storyboard: the film taking shape ---------------- */

function Storyboard({ sel, setSel }: { sel: Sel; setSel: (s: Sel) => void }) {
  const { doc, addPrompt, addCoverage, addScene, removeScene, shiftScene, setSceneOverride } = usePipeline();
  const [menuScene, setMenuScene] = useState<number | null>(null);

  const cellFor = (p: PromptDoc) => {
    const takes = doc.takes.filter((t) => t.promptName === p.name);
    const img = takes.filter((t) => t.kind === 'image');
    const vid = takes.filter((t) => t.kind === 'video');
    const thumb = (img.find((t) => t.keeper) ?? img[img.length - 1])?.url;
    const state: 'empty' | 'framed' | 'animated' | 'keeper' = vid.some((t) => t.keeper) ? 'keeper' : vid.length ? 'animated' : img.length ? 'framed' : 'empty';
    return { thumb, state };
  };
  const ring: Record<string, string> = {
    empty: 'border-dashed border-white/15',
    framed: 'border-white/25',
    animated: 'border-violet-400/60',
    keeper: 'border-emerald-400/80',
  };

  if (doc.scenes.length === 0) {
    return <div className="border-b border-white/8 px-4 py-2 text-[11px] text-neutral-600">No shots yet: write your <button onClick={() => setSel({ t: 'script' })} className="text-neutral-400 underline hover:text-neutral-200">Script</button> and the shots appear here.</div>;
  }

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto border-b border-white/8 px-3 py-2" data-testid="storyboard">
      {doc.scenes.map((scene, si) => (
        <div key={si} className="flex shrink-0 items-stretch gap-1.5">
          <div className="relative flex flex-col items-center justify-center">
            <button onClick={() => setMenuScene(menuScene === si ? null : si)} data-testid={`scene-chip-${si}`} className="rounded-md border border-white/10 px-1.5 py-0.5 text-[9px] font-bold text-neutral-500 hover:bg-white/5" title={scene.styleOverride ? `override: ${scene.styleOverride}` : 'scene menu'}>
              S{si + 1}{scene.styleOverride ? '*' : ''}
            </button>
            {menuScene === si && (
              <div className="absolute top-full left-0 z-40 mt-1 w-64 space-y-1.5 rounded-xl border border-white/12 bg-[#0e0d15]/95 p-2 shadow-2xl backdrop-blur" data-testid={`scene-menu-${si}`}>
                <input
                  value={scene.styleOverride ?? ''}
                  onChange={(e) => setSceneOverride(si, e.target.value)}
                  placeholder="scoped style override…"
                  className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-amber-200/90 outline-none placeholder:text-neutral-600"
                />
                <div className="flex gap-1">
                  <button onClick={() => { shiftScene(si, -1); setMenuScene(null); }} disabled={si === 0} className="flex-1 rounded border border-white/12 py-0.5 text-[10px] text-neutral-300 disabled:opacity-30">▲ earlier</button>
                  <button onClick={() => { shiftScene(si, 1); setMenuScene(null); }} disabled={si === doc.scenes.length - 1} className="flex-1 rounded border border-white/12 py-0.5 text-[10px] text-neutral-300 disabled:opacity-30">▼ later</button>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { addCoverage(si); setMenuScene(null); }} className="flex-1 rounded border border-white/12 py-0.5 text-[10px] text-neutral-300">＋ coverage (new angle)</button>
                  <button onClick={() => { if (confirm(`Delete Scene ${si + 1} and its takes?`)) removeScene(si); setMenuScene(null); }} className="rounded border border-white/12 px-1.5 py-0.5 text-[10px] text-rose-300">✕ scene</button>
                </div>
              </div>
            )}
          </div>
          {scene.prompts.map((p) => {
            const { thumb, state } = cellFor(p);
            const active = sel.t === 'cut' && sel.name === p.name;
            return (
              <button
                key={p.name}
                onClick={() => setSel({ t: 'cut', name: p.name })}
                data-testid={`cell-${p.name}`}
                title={p.text.slice(0, 120)}
                className={`relative h-[4.5rem] w-32 shrink-0 overflow-hidden rounded-lg border bg-neutral-900 transition ${active ? 'border-[#ff3d8b] ring-2 ring-[#ff3d8b]/40' : ring[state]}`}
              >
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt={p.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center text-[10px] text-neutral-600">◌</span>
                )}
                <span className="absolute top-1 left-1 rounded bg-black/70 px-1 font-mono text-[9px] font-bold text-neutral-100">{p.name}</span>
                {state === 'keeper' && <span className="absolute right-1 bottom-1 text-[10px] text-amber-300">★</span>}
                {state === 'animated' && <span className="absolute right-1 bottom-1 text-[10px]">🎬</span>}
              </button>
            );
          })}
          {/* another cut INSIDE this beat: 1A -> 1B (tutorial: split/insert shots per scene) */}
          <button onClick={() => addPrompt(si)} data-testid={`add-cut-${si}`} title={`Add a cut to Scene ${si + 1} (${scene.prompts.length ? scene.prompts[scene.prompts.length - 1]!.name + ' exists, this adds the next letter' : ''})`} className="h-[4.5rem] w-7 shrink-0 rounded-lg border border-dashed border-white/12 text-[11px] text-neutral-600 hover:border-white/30 hover:text-neutral-400">
            ＋
          </button>
        </div>
      ))}
      <button onClick={addScene} data-testid="add-scene" className="flex h-[4.5rem] w-20 shrink-0 flex-col items-center justify-center rounded-lg border border-dashed border-white/15 text-neutral-600 hover:border-white/30 hover:text-neutral-400" title="New story beat (next scene number)">
        <span className="text-sm">＋</span>
        <span className="text-[9px]">scene</span>
      </button>
      <div className="ml-auto flex shrink-0 items-center pl-2">
        <button onClick={() => setSel({ t: 'export' })} disabled={keeperClips(usePipeline.getState().doc).length === 0} data-testid="storyboard-export" className="btn-grad rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-40">
          ▶ Export
        </button>
      </div>
    </div>
  );
}

function StylePrefixRow() {
  const { doc, setStylePrefix, lockStyle, draftStyle, busy } = usePipeline();
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState('');
  const locked = Boolean(doc.styleLocked);

  // collapsed: one calm line showing the committed look
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-testid="style-bar"
        className="flex w-full items-center gap-2 border-b border-white/8 px-4 py-1.5 text-left hover:bg-white/[0.03]"
        title={locked ? 'Global style (locked). Click to view or edit.' : 'Click to define the film\'s one look'}
      >
        <span className="grad-text shrink-0 text-[9px] font-bold tracking-wide uppercase">Global style</span>
        {doc.stylePrefix ? (
          <>
            <span className="line-clamp-2 min-w-0 flex-1 text-[11px] leading-snug text-neutral-300">{doc.stylePrefix}</span>
            <span className="ml-auto shrink-0 text-[10px]">{locked ? '🔒' : <span className="text-amber-300/90">unlocked ✎</span>}</span>
          </>
        ) : (
          <span className="text-[11px] text-neutral-600">not set: click to define the film\'s one look (or let AI draft it from a few words)</span>
        )}
      </button>
    );
  }

  return (
    <div className="space-y-2 border-b border-white/8 bg-white/[0.02] px-4 py-3" data-testid="style-editor">
      <div className="flex items-center gap-2">
        <span className="grad-text shrink-0 text-[9px] font-bold tracking-wide uppercase">Global style</span>
        <span className="text-[10px] text-neutral-600">the film\'s one look, glued to every cut; scene overrides win inside their scene</span>
      </div>
      {/* AI draft from plain words */}
      <div className="flex items-center gap-2">
        <input
          value={hint}
          onChange={(e) => setHint(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && hint.trim() && void draftStyle(hint)}
          placeholder="say it simply: 'warm and cozy, like an apple ad' or 'ghibli watercolor'…"
          data-testid="style-hint"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px] text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[color:var(--c2)]"
        />
        <button
          onClick={() => hint.trim() && void draftStyle(hint)}
          disabled={busy !== null || !hint.trim()}
          data-testid="style-ai"
          className="btn-grad shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
        >
          {busy === 'styling' ? 'Drafting…' : '✨ AI draft'}
        </button>
      </div>
      <textarea
        value={doc.stylePrefix}
        onChange={(e) => setStylePrefix(e.target.value)}
        disabled={locked}
        rows={3}
        placeholder="…or write it yourself: medium, lighting, camera character, palette, realism rules"
        data-testid="style-prefix"
        className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-[11px] leading-relaxed text-neutral-200 outline-none placeholder:text-neutral-700 focus:border-[color:var(--c2)] disabled:opacity-60"
      />
      <div className="flex items-center gap-2">
        {locked ? (
          <button onClick={() => lockStyle(false)} data-testid="style-unlock" className="rounded-lg border border-white/12 px-3 py-1.5 text-[11px] text-neutral-300 hover:bg-white/5">Unlock to edit</button>
        ) : (
          <button
            onClick={() => { lockStyle(true); setOpen(false); }}
            disabled={!doc.stylePrefix.trim()}
            data-testid="style-lock"
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-bold text-black hover:bg-emerald-400 disabled:opacity-40"
          >
            🔒 Save & lock
          </button>
        )}
        <button onClick={() => setOpen(false)} className="rounded-lg border border-white/12 px-3 py-1.5 text-[11px] text-neutral-400 hover:bg-white/5">Close</button>
        {!locked && doc.stylePrefix && <span className="text-[10px] text-amber-300/80">unlocked: edits apply to every future generation</span>}
      </div>
    </div>
  );
}

/* ---------------- the stage ---------------- */

function Stage({ sel, setSel, castSource, setCastSource }: { sel: Sel; setSel: (s: Sel) => void; castSource?: CastSource; setCastSource: (c: CastSource | undefined) => void }) {
  if (sel.t === 'script') return <ScriptStage setSel={setSel} />;
  if (sel.t === 'casting') return <CastingStage castSource={castSource} setCastSource={setCastSource} />;
  if (sel.t === 'export') return <ExportStage />;
  return <CutStage name={sel.name} />;
}

function ScriptStage({ setSel }: { setSel: (s: Sel) => void }) {
  const { doc, setScript, planShotlist, addScene, busy } = usePipeline();
  const prevScenes = useRef(doc.scenes.length);
  // after a successful draft, jump to the first shot
  useEffect(() => {
    if (doc.scenes.length > 0 && prevScenes.current === 0) {
      const first = doc.scenes[0]?.prompts[0]?.name;
      if (first) setSel({ t: 'cut', name: first });
    }
    prevScenes.current = doc.scenes.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.scenes.length]);

  const draft = () => {
    if (!doc.script?.trim()) return;
    if (doc.scenes.length > 0 && !confirm('Re-drafting replaces the current shots (their takes go with them). Continue?')) return;
    void planShotlist(doc.script);
  };

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6" data-testid="script-stage">
      <div className="glass w-full max-w-2xl rounded-2xl p-5">
        <div className="grad-text mb-1 text-[10px] font-bold tracking-wide uppercase">Script</div>
        <p className="mb-2 text-[11px] leading-relaxed text-neutral-500">
          Write the script or beat sheet, one beat per scene. The director (seedance-shotlist skill) breaks it into
          shots with camera, blocking, and acting beats, referencing your cast by name.
        </p>
        <textarea
          value={doc.script ?? ''}
          onChange={(e) => setScript(e.target.value)}
          rows={7}
          placeholder={'A 30s ad for the LUNA sofa.\nBeats:\n1. Evening loft, warm lamps, the empty room waits.\n2. maya walks in, drops her bag, sinks into luna_sofa.\n3. Extreme closeup of the boucle stitching.\n4. Hero shot: luna_sofa dead center, city lights behind.'}
          data-testid="beats"
          className="mb-3 w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm leading-relaxed text-neutral-200 outline-none placeholder:text-neutral-700 focus:border-[color:var(--c2)]"
        />
        <div className="flex items-center gap-3">
          <button onClick={draft} disabled={busy !== null || !doc.script?.trim()} data-testid="draft-shotlist" className="btn-grad rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50">
            {busy ? 'Directing…' : doc.scenes.length ? '↻ Re-draft shots' : 'Draft shots'}
          </button>
          <button onClick={addScene} className="rounded-lg border border-white/12 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5">Add a blank scene</button>
          {doc.scenes.length > 0 && (
            <button onClick={() => { const f = doc.scenes[0]?.prompts[0]?.name; if (f) setSel({ t: 'cut', name: f }); }} className="text-xs text-neutral-500 hover:text-neutral-300">
              → to Shots ({doc.scenes.reduce((n, s) => n + s.prompts.length, 0)})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CastingStage({ castSource, setCastSource }: { castSource?: CastSource; setCastSource: (c: CastSource | undefined) => void }) {
  const { doc, promoteCandidate, discardCandidate, busy } = usePipeline();
  const candidates = doc.candidates ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="casting-stage">
      {candidates.length === 0 ? (
        <div className="grid h-full place-items-center">
          <p className="max-w-sm text-center text-sm text-neutral-600">
            {busy?.startsWith('candidate') ? 'Generating candidates…' : 'Describe a cast member below and generate a batch. Candidates appear here, big, side by side. Click one to select it, or ＋ Cast the winner.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {candidates.map((c) => {
            const selected = castSource?.url === c.url;
            return (
              <div
                key={c.id}
                onClick={() => setCastSource(selected ? undefined : { url: c.url, label: 'selected image' })}
                data-testid={`candidate-${c.id}`}
                title={selected ? 'Selected as the source: type a prompt below to regenerate from it' : 'Click to select as the source for the next generation'}
                className={`group relative cursor-pointer overflow-hidden rounded-2xl border bg-white/[0.02] transition ${selected ? 'border-[#ff3d8b] ring-2 ring-[#ff3d8b]/40' : c.used ? 'border-emerald-500/30' : 'border-white/10 hover:border-white/25'}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.url} alt="" className="aspect-video w-full object-cover" />
                {selected && <span className="absolute top-2 left-2 rounded-md bg-[#ff3d8b] px-1.5 py-0.5 text-[10px] font-bold text-white">selected · prompt below ↓</span>}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-2.5 pt-6 pb-2">
                  <span className="text-[10px] text-neutral-400">{KIND_ICON[c.kind]} {c.used ? '✓ cast' : 'candidate'}</span>
                  <div className="flex gap-1.5">
                    <button onClick={(e) => { e.stopPropagation(); promoteCandidate(c.id); }} data-testid={`promote-${c.id}`} className="btn-grad rounded-md px-2.5 py-1 text-[11px] font-bold" title="Add to the cast (name + lock it in the rail)">＋ Cast</button>
                    <button onClick={(e) => { e.stopPropagation(); discardCandidate(c.id); }} className="rounded-md border border-white/20 bg-black/40 px-2 py-1 text-[11px] text-neutral-300 hover:text-rose-300">✕</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CutStage({ name }: { name: string }) {
  const { doc, busy } = usePipeline();
  const takes = takesFor(doc, name);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="cut-stage">
      {takes.length === 0 ? (
        <div className="grid h-full place-items-center">
          <p className="max-w-sm text-center text-sm text-neutral-600">
            {busy === `running ${name}` ? 'Generating…' : `No takes for ${name} yet. Hit ▸ Takes below: generate a few, compare them here, crown the keeper.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
          {takes.map((t) => (
            <StageTake key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function StageTake({ t }: { t: TakeDoc }) {
  const { judgeTake, animateTake, removeTake, setKeeper, applyRepair, busy } = usePipeline();
  const diags = classifyVerdict(t.verdict);
  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-white/[0.02] ${t.keeper ? 'border-amber-400/70' : 'border-white/10'}`} data-testid={`take-${t.id}`}>
      {t.kind === 'audio' ? (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-black/40">
          <span className="text-2xl">🔊</span>
          <audio src={t.url} controls className="w-11/12" />
        </div>
      ) : t.kind === 'video' ? (
        <video src={t.url} controls muted loop playsInline preload="metadata" className="aspect-video w-full bg-black object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.url} alt={t.promptName} className="aspect-video w-full object-cover" />
      )}
      {t.kind !== 'audio' && (
        <button
          onClick={() => setKeeper(t.id)}
          data-testid={`keep-${t.id}`}
          title={t.kind === 'video' ? 'Keeper: this clip represents the cut in the film' : 'Keeper: this frame is the keyframe Animate uses'}
          className={`absolute top-2 right-2 rounded-lg px-2 py-1 text-sm backdrop-blur ${t.keeper ? 'bg-amber-400/90 text-black' : 'bg-black/50 text-white/70 hover:bg-black/70 hover:text-white'}`}
        >
          {t.keeper ? '★' : '☆'}
        </button>
      )}
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          {t.score !== undefined ? (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${t.score >= 0.7 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>◎ {t.score.toFixed(2)}</span>
          ) : (
            t.kind === 'image' && (
              <button onClick={() => void judgeTake(t.id)} disabled={busy !== null} className="rounded-md border border-white/12 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-white/5 disabled:opacity-50">◎ judge</button>
            )
          )}
          <span className="text-[9px] text-neutral-600 uppercase">{t.kind}</span>
        </div>
        <div className="flex items-center gap-1">
          {t.kind === 'image' && (
            <button onClick={() => void animateTake(t.id)} disabled={busy !== null} title="Animate this frame (i2v)" className="rounded-md border border-white/12 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-white/5 disabled:opacity-50">🎬</button>
          )}
          <button onClick={() => removeTake(t.id)} className="rounded-md px-1 py-0.5 text-[10px] text-neutral-600 hover:text-rose-300">✕</button>
        </div>
      </div>
      {diags.length > 0 && (
        <div className="space-y-1 border-t border-white/8 px-2.5 py-1.5" data-testid={`diagnosis-${t.id}`}>
          {diags.map((d) => (
            <div key={d.axis} className="flex items-start gap-1.5 text-[9px] leading-snug">
              <span className="mt-px shrink-0 rounded bg-rose-500/20 px-1 font-semibold tabular-nums text-rose-300">{d.axis.replace('_match', '')} {d.score.toFixed(2)}</span>
              <span className="shrink-0 rounded bg-white/8 px-1 font-semibold text-neutral-300 uppercase">{d.layer}</span>
              <span className="line-clamp-2 text-neutral-500" title={d.fix}>{d.fix}</span>
            </div>
          ))}
          {t.repairInstruction && diags.some((d) => d.autoFixable) && (
            <button onClick={() => void applyRepair(t.id)} disabled={busy !== null} data-testid={`fix-${t.id}`} className="btn-grad w-full rounded-md py-1 text-[10px] font-semibold disabled:opacity-50">
              ⚡ Fix {t.promptName} & new take
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ExportStage() {
  const { doc, lut, vertical, setLut, setVertical, exportFilm, exporting, filmUrl, updateSegment, splitSegmentAt, removeSegment, moveSegmentTo, resetTimeline } = usePipeline();
  const segs = filmSegments(doc);
  const voices = voiceTracks(doc);
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [pxPerSec, setPxPerSec] = useState(56);
  const [durations, setDurations] = useState<Record<string, number>>({});
  const playerRef = useRef<HTMLVideoElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const justDragged = useRef(false); // an edge-drag's mouse-up must not toggle selection
  const sel = segs.find((sg) => sg.id === selected) ?? null;

  // scroll = timeline zoom (native listener: React wheel handlers can't preventDefault)
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setPxPerSec((z) => Math.max(24, Math.min(240, z * (e.deltaY > 0 ? 0.88 : 1.14))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const durOf = (sg: (typeof segs)[number]) => durations[sg.takeId] ?? 5;
  const lenOf = (sg: (typeof segs)[number]) => Math.max(0.15, (sg.end ?? durOf(sg)) - sg.start);

  // edge-drag trimming
  const dragEdge = (e: React.PointerEvent, sg: (typeof segs)[number], edge: 'l' | 'r') => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const s0 = sg.start;
    const e0 = sg.end ?? durOf(sg);
    const dur = durOf(sg);
    const onMove = (ev: PointerEvent) => {
      const ds = (ev.clientX - x0) / pxPerSec;
      if (edge === 'l') updateSegment(sg.id, { start: Math.max(0, Math.min(s0 + ds, e0 - 0.15)) });
      else updateSegment(sg.id, { end: Math.max(s0 + 0.15, Math.min(e0 + ds, dur)) });
    };
    const onUp = () => {
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 200);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // sequence preview honoring segment windows
  useEffect(() => {
    const v = playerRef.current;
    if (!v || playing === null) return;
    const sg = segs[playing];
    if (!sg) { setPlaying(null); return; }
    v.src = sg.url;
    v.currentTime = sg.start;
    void v.play().catch(() => undefined);
    const onTime = () => {
      const stop = sg.end ?? durations[sg.takeId];
      if (stop !== undefined && v.currentTime >= stop) v.dispatchEvent(new Event('ended'));
    };
    const onEnded = () => setPlaying((i) => (i === null || i + 1 >= segs.length ? null : i + 1));
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    return () => { v.removeEventListener('timeupdate', onTime); v.removeEventListener('ended', onEnded); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // selecting a segment loads it in the player at its start (for scrubbing + split)
  useEffect(() => {
    const v = playerRef.current;
    if (!v || !sel || playing !== null) return;
    v.src = sel.url;
    v.currentTime = sel.start;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const total = segs.reduce((n, sg) => n + lenOf(sg), 0);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="export-stage">
      {/* hidden metadata probes: learn each take's real duration */}
      {[...new Map(segs.map((sg) => [sg.takeId, sg.url])).entries()].map(([takeId, url]) => (
        <video
          key={takeId}
          src={url}
          preload="metadata"
          className="hidden"
          onLoadedMetadata={(e) => setDurations((d) => (d[takeId] ? d : { ...d, [takeId]: e.currentTarget.duration }))}
        />
      ))}
      <div className="grid grid-cols-[1fr_16rem] gap-5">
        <div>
          {filmUrl && playing === null ? (
            <video src={filmUrl} controls autoPlay className="w-full rounded-2xl border border-white/10 bg-black" data-testid="film-result" />
          ) : (
            <div className="relative">
              <video ref={playerRef} controls={playing === null && !!sel} muted playsInline className="aspect-video w-full rounded-2xl border border-white/10 bg-black" />
              {playing === null && !sel && (
                <button onClick={() => segs.length && setPlaying(0)} data-testid="preview-sequence" className="absolute inset-0 grid place-items-center rounded-2xl text-5xl text-white/70 hover:text-white" title="Preview the cut (trims applied)">
                  ▶
                </button>
              )}
              {playing !== null && (
                <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-neutral-200">{playing + 1}/{segs.length} · {segs[playing]?.promptName}</span>
              )}
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold tracking-wide text-neutral-500 uppercase">
                Timeline · {segs.length} segment{segs.length === 1 ? '' : 's'} · {total.toFixed(1)}s{voices.length ? ` · ${voices.length} voice` : ''}
              </span>
              <span className="text-[10px] text-neutral-600">scroll to zoom · drag edges to trim · drag body to reorder</span>
            </div>
            <div ref={railRef} className="overflow-x-auto rounded-xl border border-white/8 bg-black/30 p-2" data-testid="film-cut">
              <div className="flex h-24 items-stretch gap-1">
                {segs.map((sg) => {
                  const w = Math.max(36, lenOf(sg) * pxPerSec);
                  const isSel = selected === sg.id;
                  return (
                    <div
                      key={sg.id}
                      draggable
                      onClick={() => { if (justDragged.current) return; setSelected(isSel ? null : sg.id); setPlaying(null); }}
                      onDragStart={(e) => e.dataTransfer.setData('seg', sg.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData('seg'); if (from) moveSegmentTo(from, sg.id); }}
                      data-testid={`seg-${sg.id}`}
                      style={{ width: w }}
                      className={`group relative shrink-0 cursor-pointer overflow-hidden rounded-lg border bg-neutral-900 ${isSel ? 'border-[#ff3d8b] ring-2 ring-[#ff3d8b]/40' : 'border-white/10 hover:border-white/25'}`}
                      title={`${sg.promptName} · ${sg.start.toFixed(1)}-${(sg.end ?? durOf(sg)).toFixed(1)}s`}
                    >
                      <video src={sg.url} muted playsInline preload="metadata" className="pointer-events-none h-full w-full object-cover" />
                      <span className="absolute top-1 left-2 rounded bg-black/70 px-1 font-mono text-[9px] font-bold text-neutral-200">{sg.promptName}</span>
                      <span className="absolute bottom-1 left-2 rounded bg-black/70 px-1 font-mono text-[8px] text-neutral-400">{lenOf(sg).toFixed(1)}s</span>
                      {/* trim handles */}
                      <div onPointerDown={(e) => dragEdge(e, sg, 'l')} className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize bg-gradient-to-r from-[#ff3d8b]/70 to-transparent opacity-0 group-hover:opacity-100" title="drag to trim in-point" />
                      <div onPointerDown={(e) => dragEdge(e, sg, 'r')} className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize bg-gradient-to-l from-[#ff3d8b]/70 to-transparent opacity-0 group-hover:opacity-100" title="drag to trim out-point" />
                    </div>
                  );
                })}
                {segs.length === 0 && <p className="grid w-full place-items-center text-xs text-neutral-600">No clips yet: star keepers in Shots, they land here.</p>}
              </div>
            </div>

            {sel && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2" data-testid="trim-panel">
                <span className="grad-text font-mono text-xs font-black">{sel.promptName}</span>
                <span className="font-mono text-[10px] tabular-nums text-neutral-500">{sel.start.toFixed(2)}s → {(sel.end ?? durOf(sel)).toFixed(2)}s</span>
                <button
                  onClick={() => { const at = playerRef.current?.currentTime ?? 0; splitSegmentAt(sel.id, at); setSelected(null); }}
                  data-testid="split-seg"
                  title="Split this segment at the player's current position"
                  className="btn-grad rounded-md px-2.5 py-1 text-[11px] font-semibold"
                >
                  ✂ Split at playhead
                </button>
                <button onClick={() => { removeSegment(sel.id); setSelected(null); }} data-testid="remove-seg" className="rounded-md border border-white/12 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-950/40">remove</button>
                <span className="text-[10px] text-neutral-600">scrub the player above, then split; edges trim live</span>
              </div>
            )}
            {doc.timeline && (
              <button onClick={resetTimeline} className="mt-1.5 text-[10px] text-neutral-600 underline hover:text-neutral-400" title="Discard all trims/splits and rebuild from the starred keepers">
                reset timeline to keepers
              </button>
            )}
          </div>
        </div>

        <aside className="space-y-3">
          <div>
            <div className="mb-1 text-[10px] font-bold tracking-wide text-neutral-500 uppercase">Look (LUT)</div>
            <select value={lut} onChange={(e) => setLut(e.target.value)} className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs text-neutral-200 outline-none">
              {LUTS.map((l) => (
                <option key={l.name} value={l.name}>{l.label}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold tracking-wide text-neutral-500 uppercase">Aspect</div>
            <div className="flex gap-2">
              {[{ v: false, label: '16:9' }, { v: true, label: '9:16' }].map((a) => (
                <button key={a.label} onClick={() => setVertical(a.v)} className={`flex-1 rounded-lg border px-2 py-1.5 text-xs ${vertical === a.v ? 'border-[#ff3d8b] bg-[#ff3d8b]/15 text-[#ff9ac4]' : 'border-white/12 text-neutral-400'}`}>{a.label}</button>
              ))}
            </div>
          </div>
          <button onClick={() => void exportFilm()} disabled={exporting || segs.length === 0} data-testid="export-film" className="btn-grad w-full rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">
            {exporting ? 'Rendering…' : '▶ Export film'}
          </button>
          {filmUrl && <a href={filmUrl} download="recut-film.mp4" className="block rounded-lg border border-white/12 py-2 text-center text-xs font-medium text-neutral-100 hover:bg-white/5">⬇ Download MP4</a>}
          <p className="text-[11px] leading-relaxed text-neutral-600">Segments export exactly as cut: trim + split windows, order, LUT, voice mix. No model calls.</p>
        </aside>
      </div>
    </div>
  );
}

/* ---------------- the control bar ---------------- */

function ControlBar({ sel, setSel, castSource, setCastSource }: { sel: Sel; setSel: (s: Sel) => void; castSource?: CastSource; setCastSource: (c: CastSource | undefined) => void }) {
  if (sel.t === 'casting') return <CastingControls castSource={castSource} setCastSource={setCastSource} />;
  if (sel.t === 'cut') return <CutControls name={sel.name} setSel={setSel} />;
  return null;
}

function CastingControls({ castSource, setCastSource }: { castSource?: CastSource; setCastSource: (c: CastSource | undefined) => void }) {
  const { doc, generateCandidates, busy } = usePipeline();
  const [kind, setKind] = useState<AssetKind>('product');
  const [count, setCount] = useState(4);
  const [prompt, setPrompt] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const withImages = doc.assets.filter((a) => a.imageUrl);

  const go = () => prompt.trim() && void generateCandidates(kind, prompt, count, castSource?.url);

  return (
    <div className="space-y-1.5 border-t border-white/8 bg-[#0b0a11] px-4 py-2.5" data-testid="casting-controls">
      <div className="flex items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-neutral-200 outline-none">
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>{KIND_ICON[k]} {k}</option>
          ))}
        </select>
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} title="Variations per go" className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-neutral-200 outline-none">
          {[1, 2, 3, 4, 6].map((n) => (
            <option key={n} value={n}>×{n}</option>
          ))}
        </select>
        {/* source: a photo, an existing cast member, or a candidate being iterated */}
        {castSource ? (
          <span className="flex items-center gap-1.5 rounded-lg border border-[#ff3d8b]/50 bg-[#ff3d8b]/10 px-2 py-1 text-[11px] text-[#ff9ac4]" data-testid="cast-source">
            from: {castSource.label}
            <button onClick={() => setCastSource(undefined)} className="text-[#ff9ac4]/70 hover:text-white">✕</button>
          </span>
        ) : (
          <>
            <button onClick={() => fileRef.current?.click()} title="Start from a photo (your real product)" className="rounded-lg border border-white/12 px-2 py-1.5 text-xs text-neutral-400 hover:bg-white/5">⬆ photo</button>
            {withImages.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  const a = withImages.find((x) => x.id === e.target.value);
                  if (a) setCastSource({ url: a.imageUrl!, label: a.slug });
                }}
                title="Start from an existing cast member (re-style, state variant, wardrobe change)"
                data-testid="source-from-cast"
                className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-neutral-400 outline-none"
              >
                <option value="">from cast…</option>
                {withImages.map((a) => (
                  <option key={a.id} value={a.id}>{a.slug}</option>
                ))}
              </select>
            )}
          </>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const r = new FileReader();
          r.onload = () => setCastSource({ url: String(r.result), label: f.name.slice(0, 18) });
          r.readAsDataURL(f);
        }} />
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder={castSource ? `what to make from ${castSource.label}: 'clean product sheet, front + 3/4 view…'` : "describe the cast member: 'two-panel character sheet, closeup + full body on gray…'"}
          data-testid="candidate-prompt"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[color:var(--c2)]"
        />
        <button onClick={go} disabled={busy !== null || !prompt.trim()} data-testid="generate-candidates" className="btn-grad rounded-lg px-4 py-1.5 text-xs font-semibold disabled:opacity-50">
          Generate ×{count}
        </button>
      </div>
    </div>
  );
}

function CutControls({ name, setSel }: { name: string; setSel: (s: Sel) => void }) {
  const { doc, updatePrompt, batchTakes, voicePrompt, animateTake, removePrompt, busy } = usePipeline();
  const [variations, setVariations] = useState(1);
  const [duration, setDuration] = useState(5);
  const [mention, setMention] = useState<{ token: string; start: number } | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const p = doc.scenes.flatMap((s) => s.prompts).find((x) => x.name === name);
  useEffect(() => {
    if (!p) {
      const first = usePipeline.getState().doc.scenes[0]?.prompts[0]?.name;
      setSel(first ? { t: 'cut', name: first } : { t: 'script' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);
  if (!p) return null;
  const attached = resolveAssets(doc, name);
  const lockedSlugs = doc.assets.filter((a) => a.locked && a.imageUrl).map((a) => a.slug);
  const crownedImage = doc.takes.find((t) => t.promptName === name && t.kind === 'image' && t.keeper);
  const latestImage = [...doc.takes].reverse().find((t) => t.promptName === name && t.kind === 'image');
  const animTarget = crownedImage ?? latestImage;
  const preset = (value: string, options: string[], label: string, key: 'shotSize' | 'angle' | 'lens' | 'light') => (
    <select
      value={value}
      onChange={(e) => updatePrompt(name, { [key]: e.target.value || undefined })}
      title={label}
      className={`rounded-md border px-1.5 py-1 text-[10px] outline-none ${value ? 'border-[#ff3d8b]/40 bg-[#ff3d8b]/10 text-[#ff9ac4]' : 'border-white/10 bg-black/30 text-neutral-500'}`}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-1.5 border-t border-white/8 bg-[#0b0a11] px-4 py-2.5" data-testid="cut-controls">
      <div className="flex items-center gap-2">
        <span className="grad-text font-mono text-sm font-black">{name}</span>
        <div className="flex flex-wrap gap-1">
          {lockedSlugs.map((slug) => {
            const on = p.assetSlugs.includes(slug);
            return (
              <button key={slug} onClick={() => updatePrompt(name, { assetSlugs: on ? p.assetSlugs.filter((s) => s !== slug) : [...p.assetSlugs, slug] })} className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${on ? 'border-[#ff3d8b]/60 bg-[#ff3d8b]/15 text-[#ff9ac4]' : 'border-white/10 text-neutral-500 hover:text-neutral-300'}`}>
                {slug}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1" data-testid={`cine-${name}`}>
          {preset(p.shotSize ?? '', SHOT, 'shot', 'shotSize')}
          {preset(p.angle ?? '', ANGLE, 'angle', 'angle')}
          {preset(p.lens ?? '', LENS, 'lens', 'lens')}
          {preset(p.light ?? '', LIGHT, 'light', 'light')}
          <button
            onClick={() => { if (confirm(`Delete cut ${name} and its takes?`)) removePrompt(name); }}
            data-testid={`delete-cut-${name}`}
            title="Delete this cut (its takes go with it; letters renumber)"
            className="ml-1 rounded-md border border-white/12 px-1.5 py-1 text-[10px] text-rose-300/80 hover:bg-rose-950/40"
          >
            ✕ cut
          </button>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          {mention && (() => {
            const matches = lockedSlugs.filter((sl) => sl.startsWith(mention.token)).slice(0, 6);
            if (!matches.length) return null;
            return (
              <div className="absolute bottom-full left-2 z-50 mb-1 overflow-hidden rounded-lg border border-white/15 bg-[#14121d] shadow-2xl" data-testid="mention-menu">
                {matches.map((sl) => (
                  <button
                    key={sl}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const el = promptRef.current;
                      const text = p.text;
                      const before = text.slice(0, mention.start);
                      const after = text.slice(mention.start + mention.token.length + 1);
                      updatePrompt(name, { text: `${before}@${sl} ${after}` });
                      setMention(null);
                      el?.focus();
                    }}
                    className="block w-full px-3 py-1.5 text-left font-mono text-[11px] text-neutral-200 hover:bg-white/8"
                  >
                    @{sl}
                  </button>
                ))}
              </div>
            );
          })()}
          <textarea
            ref={promptRef}
            value={p.text}
            onChange={(e) => {
              const v = e.target.value;
              updatePrompt(name, { text: v });
              // detect an @token at the caret for the mention menu
              const caret = e.target.selectionStart ?? v.length;
              const upto = v.slice(0, caret);
              const m = upto.match(/@([a-z0-9_]*)$/);
              setMention(m ? { token: m[1] ?? '', start: caret - (m[1]?.length ?? 0) - 1 } : null);
            }}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            rows={4}
            placeholder="the cut: action, blocking, choreography… type @ to reference a cast member"
            data-testid="cut-prompt"
            className="max-h-44 w-full resize-y rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs leading-relaxed text-neutral-200 outline-none focus:border-[color:var(--c2)]"
          />
        </div>
        <div className="flex w-64 flex-col gap-1.5">
          <input
            value={p.dialogue ?? ''}
            onChange={(e) => updatePrompt(name, { dialogue: e.target.value || undefined })}
            placeholder="🔊 spoken line (optional)…"
            className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-pink-200/90 outline-none placeholder:text-neutral-700"
          />
          <div className="flex items-center gap-1.5">
            <select value={variations} onChange={(e) => setVariations(Number(e.target.value))} title="Takes per go" data-testid={`variations-${name}`} className="rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-neutral-300 outline-none">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>×{n}</option>
              ))}
            </select>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} title="Clip length (seconds)" data-testid={`duration-${name}`} className="rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-neutral-300 outline-none">
              {[3, 5, 8, 10].map((n) => (
                <option key={n} value={n}>{n}s</option>
              ))}
            </select>
            <button
              onClick={() => void batchTakes(name, variations, 'video', duration)}
              disabled={busy !== null}
              data-testid={`run-${name}`}
              title="Direct video from this cut's description + the attached cast as locked references (wan r2v)"
              className="btn-grad flex-1 rounded-md px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
            >
              {busy?.includes(name) ? 'Generating…' : '🎥 Takes'}
            </button>
            <button
              onClick={() => void batchTakes(name, variations, 'frame')}
              disabled={busy !== null}
              data-testid={`frame-${name}`}
              title="Cheap image keyframes: look-dev, judging, repair; animate the keeper after"
              className="rounded-md border border-white/12 px-2 py-1 text-[11px] font-semibold text-neutral-300 hover:bg-white/5 disabled:opacity-50"
            >
              🖼
            </button>
            <button
              onClick={() => animTarget && void animateTake(animTarget.id)}
              disabled={busy !== null || !animTarget}
              data-testid={`animate-${name}`}
              title={crownedImage ? 'Animate the keeper keyframe (i2v)' : latestImage ? 'No keeper yet: animates the latest frame' : 'Generate a frame first'}
              className="rounded-md border border-white/12 px-2 py-1 text-[11px] font-semibold text-neutral-200 hover:bg-white/5 disabled:opacity-40"
            >
              🎬 {crownedImage ? '★' : ''}
            </button>
            {p.dialogue?.trim() && (
              <button onClick={() => void voicePrompt(name)} disabled={busy !== null} className="rounded-md border border-pink-500/40 bg-pink-500/10 px-2 py-1 text-[11px] font-semibold text-pink-200 hover:bg-pink-500/20 disabled:opacity-50">🔊</button>
            )}
          </div>
        </div>
      </div>
      <p className="line-clamp-1 font-mono text-[10px] text-neutral-700" title={compilePromptText(doc, name)}>→ {compilePromptText(doc, name)}</p>
      {attached.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-neutral-700 uppercase">refs</span>
          {attached.map((a) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={a.id} src={a.imageUrl} alt={a.slug} title={a.slug} className="h-6 w-9 rounded border border-white/10 object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}
