'use client';

// The three-stage pipeline wizard (PIPELINE-SPEC.md): Assets > Scenes > Film.
// A film is scenes; a scene is cuts; each cut carries its camera presets, prompt, and takes
// inline (Shotlist and Takes merged: one place to write, angle, generate, judge, and repair).

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePipeline } from '../../lib/pipeline/usePipeline';
import {
  compilePromptText,
  keeperClips,
  resolveAssets,
  stageReady,
  takesFor,
  voiceTracks,
  type AssetDoc,
  type AssetKind,
  type PromptDoc,
  type SceneDoc,
  type TakeDoc,
} from '../../lib/pipeline/doc';
import { classifyVerdict } from '../../lib/pipeline/taxonomy';
import { LUTS } from '../../lib/post/lut';

const ASSET_KINDS: AssetKind[] = ['product', 'character', 'location', 'prop'];
const KIND_ICON: Record<AssetKind, string> = { product: '📦', character: '🧍', location: '🏠', prop: '☕' };

// Cinematography vocabulary (ported from the main-branch inspector)
const SHOT = ['', 'extreme close-up', 'close-up', 'medium close-up', 'medium shot', 'wide shot', 'extreme wide shot'];
const ANGLE = ['', 'low angle', 'eye level', 'high angle', 'overhead', 'three-quarter view', 'profile view'];
const LENS = ['', '24mm wide-angle lens', '35mm lens', '50mm lens', '85mm portrait lens', '135mm telephoto lens'];
const LIGHT = ['', 'Rembrandt lighting', 'split lighting', 'butterfly lighting', 'loop lighting', 'high-key soft light', 'low-key dramatic light', 'natural window light', 'golden hour'];

export function PipelineWizard({ projectId, title }: { projectId: string; title: string }) {
  const { doc, tab, setTab, load, busy, error, spentUsd, capUsd } = usePipeline();
  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  // flush the debounced autosave when the tab hides or unloads, so the last drag never vanishes
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

  const gates = stageReady(doc);
  const tabs: Array<{ key: typeof tab; label: string; enabled: boolean; hint: string }> = [
    { key: 'assets', label: '1 · Assets', enabled: true, hint: 'Create, test, and lock every reusable reference' },
    { key: 'scenes', label: '2 · Scenes', enabled: gates.shotlist, hint: 'Lock at least one asset first' },
    { key: 'film', label: '3 · Film', enabled: gates.film, hint: 'Animate at least one take first' },
  ];

  return (
    <main className="flex h-screen flex-col bg-[#07070c]">
      <header className="flex items-center justify-between border-b border-white/8 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="brand-mark h-5 w-5 text-[10px] font-black">R</span>
            <span className="text-sm font-bold tracking-tight text-neutral-100">Recut</span>
          </Link>
          <span className="text-xs text-neutral-500">/ {title}</span>
        </div>
        <nav className="flex items-center gap-1" data-testid="pipeline-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => t.enabled && setTab(t.key)}
              disabled={!t.enabled}
              title={t.hint}
              data-testid={`tab-${t.key}`}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === t.key ? 'btn-grad' : t.enabled ? 'text-neutral-300 hover:bg-white/5' : 'text-neutral-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {busy && <span className="animate-pulse text-[11px] text-[#ff9ac4]">{busy}…</span>}
          <span className="text-xs tabular-nums text-neutral-500" data-testid="spend">
            ${spentUsd.toFixed(3)}{capUsd !== null ? ` / $${capUsd.toFixed(0)}` : ''}
          </span>
          <Link href={`/project/${projectId}`} className="text-[11px] text-neutral-600 hover:text-neutral-400">canvas ↗</Link>
        </div>
      </header>

      {error && <div className="border-b border-rose-900 bg-rose-950/60 px-4 py-1.5 text-xs text-rose-300">{error}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'assets' && <AssetsPanel />}
        {tab === 'scenes' && <ScenesPanel />}
        {tab === 'film' && <FilmPanel />}
      </div>
    </main>
  );
}

/* ---------------- Stage 1: Assets (generator + tray > curation board) ---------------- */

function AssetsPanel() {
  const { doc, generateCandidates, promoteCandidate, discardCandidate, moveAsset, updateAsset, removeAsset, lockAsset, setAssetImage, addAsset, busy } = usePipeline();
  const [prompt, setPrompt] = useState('');
  const [kind, setKind] = useState<AssetKind>('character');
  const [count, setCount] = useState(4);
  const [fromImage, setFromImage] = useState<string | undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const candidates = doc.candidates ?? [];

  const readFile = (file: File, cb: (dataUri: string) => void) => {
    const r = new FileReader();
    r.onload = () => cb(String(r.result));
    r.readAsDataURL(file);
  };

  // drop from the tray (candidate/<id>) promotes; drop of a board card (asset/<id>) repositions
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, e.clientX - rect.left - 110);
    const y = Math.max(0, e.clientY - rect.top - 70);
    const cand = e.dataTransfer.getData('candidate');
    const asset = e.dataTransfer.getData('asset');
    if (cand) promoteCandidate(cand, { x, y });
    else if (asset) moveAsset(asset, { x, y });
  };

  return (
    <section className="grid h-full grid-cols-[20rem_1fr]" data-testid="assets-board">
      {/* left: generator + candidate tray */}
      <aside className="flex min-h-0 flex-col border-r border-white/8">
        <div className="space-y-2 border-b border-white/8 p-4">
          <div className="grad-text text-[10px] font-bold tracking-wide uppercase">Generate candidates</div>
          <div className="flex gap-1.5">
            <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)} className="glass rounded-lg px-2 py-1.5 text-xs text-neutral-200 outline-none">
              {ASSET_KINDS.map((k) => (
                <option key={k} value={k}>{KIND_ICON[k]} {k}</option>
              ))}
            </select>
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} title="How many variations per go" className="glass rounded-lg px-2 py-1.5 text-xs text-neutral-200 outline-none">
              {[1, 2, 3, 4, 6].map((n) => (
                <option key={n} value={n}>×{n}</option>
              ))}
            </select>
            <button onClick={() => fileRef.current?.click()} title={fromImage ? 'Source photo attached: candidates are edits of it' : 'Start from a photo (e.g. your real product)'} className={`rounded-lg border px-2 py-1.5 text-xs ${fromImage ? 'border-[#ff3d8b]/60 bg-[#ff3d8b]/15 text-[#ff9ac4]' : 'border-white/12 text-neutral-400 hover:bg-white/5'}`}>
              {fromImage ? '📎 photo' : '⬆ photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0], setFromImage)} />
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="describe the asset: 'two-panel character sheet, closeup face + full body on gray, a farm girl in red overalls…'"
            data-testid="candidate-prompt"
            className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[color:var(--c2)]"
          />
          <button
            onClick={() => prompt.trim() && void generateCandidates(kind, prompt, count, fromImage)}
            disabled={busy !== null || !prompt.trim()}
            data-testid="generate-candidates"
            className="btn-grad w-full rounded-lg py-2 text-xs font-semibold disabled:opacity-50"
          >
            {busy?.startsWith('candidate') ? `Generating ${busy.slice(10)}…` : `Generate ${count} candidates`}
          </button>
          <button
            onClick={() => uploadRef.current?.click()}
            className="w-full rounded-lg border border-white/12 py-1.5 text-[11px] text-neutral-400 hover:bg-white/5"
          >
            ⬆ Upload straight to the board
          </button>
          <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            readFile(f, (uri) => {
              const a = addAsset(f.name.replace(/\.[a-z]+$/i, ''), kind);
              setAssetImage(a.id, uri);
            });
          }} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-testid="candidate-tray">
          <div className="mb-2 px-1 text-[10px] font-bold tracking-wide text-neutral-500 uppercase">
            Tray · {candidates.length} candidate{candidates.length === 1 ? '' : 's'}
          </div>
          {candidates.length === 0 ? (
            <p className="px-1 text-[11px] leading-relaxed text-neutral-600">
              Generate a batch: candidates land here. Drag the keepers onto the board; discard the rest.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {candidates.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('candidate', c.id)}
                  data-testid={`candidate-${c.id}`}
                  className="group relative cursor-grab overflow-hidden rounded-lg border border-white/10 bg-white/[0.02] active:cursor-grabbing"
                  title={c.prompt}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.url} alt="" className="aspect-video w-full object-cover" />
                  <span className="absolute top-1 left-1 rounded bg-black/60 px-1 text-[9px]">{KIND_ICON[c.kind]}</span>
                  {c.used && <span className="absolute bottom-1 left-1 rounded bg-emerald-500/85 px-1 text-[8px] font-bold text-black">✓ on board</span>}
                  <button
                    onClick={() => discardCandidate(c.id)}
                    className="absolute top-1 right-1 hidden rounded bg-black/70 px-1 text-[10px] text-rose-300 group-hover:block"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* right: the curation board */}
      <div
        ref={boardRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        data-testid="board"
        className="relative min-h-full overflow-auto"
        style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1.4px)', backgroundSize: '22px 22px' }}
      >
        {doc.assets.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="max-w-xs text-center text-sm text-neutral-600">
              The board. Drag your shortlisted candidates here, name them, and 🔒 lock them into the bible.
            </p>
          </div>
        )}
        {doc.assets.map((a, i) => (
          <BoardCard
            key={a.id}
            a={a}
            fallback={{ x: 28 + (i % 4) * 250, y: 28 + Math.floor(i / 4) * 230 }}
            onUpdate={updateAsset}
            onRemove={removeAsset}
            onLock={lockAsset}
            onReplace={(id, file) => readFile(file, (uri) => setAssetImage(id, uri))}
          />
        ))}
      </div>
    </section>
  );
}

function BoardCard({
  a, fallback, onUpdate, onRemove, onLock, onReplace,
}: {
  a: AssetDoc;
  fallback: { x: number; y: number };
  onUpdate: (id: string, patch: Partial<AssetDoc>) => void;
  onRemove: (id: string) => void;
  onLock: (id: string, locked: boolean) => void;
  onReplace: (id: string, file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const x = a.x ?? fallback.x;
  const y = a.y ?? fallback.y;

  return (
    <div
      draggable
      onDragStart={(e) => e.dataTransfer.setData('asset', a.id)}
      data-testid={`board-${a.slug}`}
      className={`absolute w-56 cursor-grab overflow-hidden rounded-xl border shadow-xl shadow-black/50 active:cursor-grabbing ${a.locked ? 'border-emerald-500/50' : 'border-white/12'} bg-[#0e0d15]`}
      style={{ left: x, top: y }}
    >
      <div className="relative aspect-video bg-neutral-900">
        {a.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.imageUrl} alt={a.slug} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="grid h-full w-full place-items-center text-2xl opacity-40">{KIND_ICON[a.kind]}</div>
        )}
        {a.locked && <span className="absolute top-1.5 left-1.5 rounded bg-emerald-500/90 px-1 py-0.5 text-[9px] font-bold text-black">🔒 LOCKED</span>}
      </div>
      <div className="space-y-1.5 p-2">
        <div className="flex items-center gap-1.5">
          <input
            value={a.slug}
            disabled={a.locked}
            onChange={(e) => onUpdate(a.id, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
            className="w-full rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-neutral-200 outline-none disabled:opacity-60"
          />
          <span className="shrink-0 text-[9px] text-neutral-500">{a.kind}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onLock(a.id, !a.locked)}
            disabled={!a.imageUrl}
            data-testid={`lock-${a.slug}`}
            className={`flex-1 rounded py-1 text-[10px] font-semibold disabled:opacity-40 ${a.locked ? 'border border-white/12 text-neutral-400 hover:bg-white/5' : 'bg-emerald-500 text-black hover:bg-emerald-400'}`}
          >
            {a.locked ? 'Unlock' : '🔒 Lock'}
          </button>
          {!a.locked && (
            <>
              <button onClick={() => fileRef.current?.click()} title="Replace image" className="rounded border border-white/12 px-1.5 py-1 text-[10px] text-neutral-400 hover:bg-white/5">⬆</button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onReplace(a.id, e.target.files[0])} />
              <button onClick={() => onRemove(a.id)} className="rounded border border-white/12 px-1.5 py-1 text-[10px] text-rose-300 hover:bg-rose-950/40">✕</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Stage 2: Scenes (shotlist + takes, one surface) ---------------- */

function ScenesPanel() {
  const { doc, setStylePrefix, setSceneOverride, planShotlist, addPrompt, addCoverage, addScene, removeScene, shiftScene, busy, setTab } = usePipeline();
  const [beats, setBeats] = useState('');
  const gates = stageReady(doc);

  return (
    <section className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-neutral-100">Scenes</h2>
          <p className="mt-1 max-w-2xl text-sm text-neutral-500">
            A film is scenes; a scene is cuts. Each cut carries its camera, prompt, and takes. Edits are surgical, by
            cut name.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {doc.scenes.length > 0 && (
            <a
              href={`/api/shotlist/${doc.projectId}`}
              target="_blank"
              data-testid="shotlist-html"
              title="The director's shotlist as a self-contained HTML artifact (seedance-shotlist-director format)"
              className="rounded-lg border border-white/12 px-4 py-2 text-xs font-medium text-neutral-300 hover:bg-white/5"
            >
              ⬇ Shotlist.html
            </a>
          )}
          {gates.film && (
            <button onClick={() => setTab('film')} data-testid="to-film" className="btn-grad rounded-lg px-4 py-2 text-xs font-semibold">
              Assemble the film →
            </button>
          )}
        </div>
      </div>

      <div className="glass mb-6 rounded-2xl p-4">
        <div className="grad-text mb-1.5 text-[10px] font-bold tracking-wide uppercase">Global Style Prefix · glued to every cut</div>
        <textarea
          value={doc.stylePrefix}
          onChange={(e) => setStylePrefix(e.target.value)}
          rows={2}
          placeholder="lighting, camera, colour, realism rules glued to every prompt…"
          data-testid="style-prefix"
          className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[color:var(--c2)]"
        />
      </div>

      {doc.scenes.length === 0 ? (
        <div className="glass rounded-2xl p-5">
          <div className="mb-1.5 text-[10px] font-bold tracking-wide text-neutral-500 uppercase">Draft from a beat sheet</div>
          <textarea
            value={beats}
            onChange={(e) => setBeats(e.target.value)}
            rows={3}
            placeholder="One beat per scene. Product ad: 'A 30s ad for the LUNA sofa: evening reveal, she sinks in, stitching closeup, hero shot.' Or a drama: 'A lighthouse keeper finds a letter from her past.'"
            data-testid="beats"
            className="mb-3 w-full resize-none rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600"
          />
          <div className="flex items-center gap-3">
            <button onClick={() => beats.trim() && void planShotlist(beats)} disabled={busy !== null || !beats.trim()} data-testid="draft-shotlist" className="btn-grad rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50">
              {busy ? 'Planning…' : 'Draft scenes'}
            </button>
            <button onClick={addScene} className="rounded-lg border border-white/12 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5">Start blank</button>
          </div>
        </div>
      ) : (
        <>
          {doc.scenes.map((scene, si) => (
            <div key={si} className="glass mb-5 rounded-2xl p-4" data-testid={`scene-${si + 1}`}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-bold text-neutral-200">
                  {scene.title}
                  <button onClick={() => shiftScene(si, -1)} disabled={si === 0} title="Move scene up" data-testid={`scene-up-${si}`} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-white/5 disabled:opacity-30">▲</button>
                  <button onClick={() => shiftScene(si, 1)} disabled={si === doc.scenes.length - 1} title="Move scene down" data-testid={`scene-down-${si}`} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-white/5 disabled:opacity-30">▼</button>
                  <button onClick={() => { if (confirm(`Delete ${scene.title} and its takes?`)) removeScene(si); }} title="Delete scene" data-testid={`scene-delete-${si}`} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-rose-300/80 hover:bg-rose-950/40">✕</button>
                </span>
                <input
                  value={scene.styleOverride ?? ''}
                  onChange={(e) => setSceneOverride(si, e.target.value)}
                  placeholder="scoped style override for this scene only (optional)…"
                  className="w-1/2 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-amber-200/90 outline-none placeholder:text-neutral-600"
                />
              </div>

              {scene.prompts.map((p) => (
                <CutRow key={p.name} scene={scene} p={p} />
              ))}

              <div className="mt-1 flex items-center gap-3">
                <button onClick={() => addPrompt(si)} className="text-[11px] text-neutral-500 hover:text-neutral-300">＋ cut</button>
                <button onClick={() => addCoverage(si)} title="Duplicate the master cut at the next shot size (coverage)" data-testid={`coverage-${si}`} className="text-[11px] text-neutral-500 hover:text-neutral-300">
                  ＋ coverage (new angle)
                </button>
              </div>
            </div>
          ))}
          <button onClick={addScene} className="rounded-lg border border-white/12 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5">＋ Scene</button>
        </>
      )}
    </section>
  );
}

function Preset({ value, options, label, onChange }: { value: string; options: string[]; label: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={label}
      className={`rounded-md border px-1.5 py-1 text-[10px] outline-none ${value ? 'border-[#ff3d8b]/40 bg-[#ff3d8b]/10 text-[#ff9ac4]' : 'border-white/10 bg-black/30 text-neutral-500'}`}
    >
      <option value="">{label}</option>
      {options.filter(Boolean).map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function CutRow({ scene, p }: { scene: SceneDoc; p: PromptDoc }) {
  const { doc, updatePrompt, batchTakes, voicePrompt, busy } = usePipeline();
  const takes = takesFor(doc, p.name);
  const lockedSlugs = doc.assets.filter((a) => a.locked && a.imageUrl).map((a) => a.slug);
  const [variations, setVariations] = useState(1);

  return (
    <div className="mb-3 rounded-xl border border-white/8 bg-black/20 p-3" data-testid={`cut-${p.name}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="grad-text font-mono text-sm font-black">{p.name}</span>
        <div className="flex flex-wrap gap-1">
          {lockedSlugs.map((slug) => {
            const on = p.assetSlugs.includes(slug);
            return (
              <button
                key={slug}
                onClick={() => updatePrompt(p.name, { assetSlugs: on ? p.assetSlugs.filter((s) => s !== slug) : [...p.assetSlugs, slug] })}
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${on ? 'border-[#ff3d8b]/60 bg-[#ff3d8b]/15 text-[#ff9ac4]' : 'border-white/10 text-neutral-500 hover:text-neutral-300'}`}
              >
                {slug}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex gap-1" data-testid={`cine-${p.name}`}>
          <Preset value={p.shotSize ?? ''} options={SHOT} label="shot" onChange={(v) => updatePrompt(p.name, { shotSize: v || undefined })} />
          <Preset value={p.angle ?? ''} options={ANGLE} label="angle" onChange={(v) => updatePrompt(p.name, { angle: v || undefined })} />
          <Preset value={p.lens ?? ''} options={LENS} label="lens" onChange={(v) => updatePrompt(p.name, { lens: v || undefined })} />
          <Preset value={p.light ?? ''} options={LIGHT} label="light" onChange={(v) => updatePrompt(p.name, { light: v || undefined })} />
        </div>
      </div>

      <textarea
        value={p.text}
        onChange={(e) => updatePrompt(p.name, { text: e.target.value })}
        rows={2}
        placeholder="the cut: action, choreography move by move…"
        className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-neutral-200 outline-none focus:border-[color:var(--c2)]"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <input
          value={p.dialogue ?? ''}
          onChange={(e) => updatePrompt(p.name, { dialogue: e.target.value || undefined })}
          placeholder="🔊 spoken line (optional)…"
          className="flex-1 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-pink-200/90 outline-none placeholder:text-neutral-700"
        />
        {p.dialogue?.trim() && (
          <button onClick={() => void voicePrompt(p.name)} disabled={busy !== null} data-testid={`voice-${p.name}`} className="rounded-md border border-pink-500/40 bg-pink-500/10 px-2.5 py-1 text-[11px] font-semibold text-pink-200 hover:bg-pink-500/20 disabled:opacity-50">
            🔊 Voice
          </button>
        )}
        <select value={variations} onChange={(e) => setVariations(Number(e.target.value))} title="How many image variations per go (images first; animate the keeper after)" data-testid={`variations-${p.name}`} className="rounded-md border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-neutral-300 outline-none">
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>×{n}</option>
          ))}
        </select>
        <button onClick={() => void batchTakes(p.name, variations)} disabled={busy !== null} data-testid={`run-${p.name}`} title="Generates image keyframes only; animate your keeper take afterwards" className="btn-grad rounded-md px-3.5 py-1 text-[11px] font-semibold disabled:opacity-50">
          {busy === `running ${p.name}` ? 'Generating…' : takes.length ? `↻ New take${variations > 1 ? 's' : ''}` : `▶ Take${variations > 1 ? 's' : ''}`}
        </button>
      </div>
      <p className="mt-1.5 line-clamp-2 font-mono text-[10px] leading-relaxed text-neutral-600" title={compilePromptText(doc, p.name)}>
        → {compilePromptText(doc, p.name)}
      </p>

      {takes.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" data-testid={`takes-${p.name}`}>
          {takes.map((t) => (
            <TakeCard key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

function TakeCard({ t }: { t: TakeDoc }) {
  const { judgeTake, animateTake, removeTake, setKeeper, applyRepair, busy } = usePipeline();
  const diags = classifyVerdict(t.verdict);

  return (
    <div className="w-64 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
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
      <div className="flex items-center justify-between gap-1.5 p-2">
        <div className="flex items-center gap-1.5">
          {t.score !== undefined ? (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${t.score >= 0.7 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>◎ {t.score.toFixed(2)}</span>
          ) : (
            t.kind === 'image' && (
              <button onClick={() => void judgeTake(t.id)} disabled={busy !== null} className="rounded-md border border-white/12 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-white/5 disabled:opacity-50">◎ Judge</button>
            )
          )}
        </div>
        <div className="flex items-center gap-1">
          {t.kind === 'video' && (
            <button onClick={() => setKeeper(t.id)} title="Keeper: represents this cut in the film" data-testid={`keeper-${t.id}`} className={`rounded-md border px-1.5 py-0.5 text-[10px] ${t.keeper ? 'border-amber-400/60 bg-amber-400/15 text-amber-200' : 'border-white/12 text-neutral-400 hover:bg-white/5'}`}>
              {t.keeper ? '★' : '☆'}
            </button>
          )}
          {t.kind === 'image' && (
            <button onClick={() => void animateTake(t.id)} disabled={busy !== null} title="Animate (i2v)" className="rounded-md border border-white/12 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-white/5 disabled:opacity-50">🎬</button>
          )}
          <button onClick={() => removeTake(t.id)} className="rounded-md px-1 py-0.5 text-[10px] text-neutral-600 hover:text-rose-300">✕</button>
        </div>
      </div>
      {diags.length > 0 && (
        <div className="space-y-1 border-t border-white/8 px-2 py-1.5" data-testid={`diagnosis-${t.id}`}>
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

/* ---------------- Stage 3: Film ---------------- */

function FilmPanel() {
  const { doc, lut, vertical, setLut, setVertical, exportFilm, exporting, filmUrl, setFilmOrder } = usePipeline();
  const cut = keeperClips(doc);
  const voices = voiceTracks(doc);

  // drag a clip onto another to reorder the film (persisted as filmOrder)
  const reorder = (fromName: string, toName: string) => {
    if (fromName === toName) return;
    const names = cut.map((c) => c.promptName);
    const from = names.indexOf(fromName);
    const to = names.indexOf(toName);
    if (from === -1 || to === -1) return;
    names.splice(to, 0, names.splice(from, 1)[0]!);
    setFilmOrder(names);
  };

  return (
    <section className="mx-auto max-w-5xl px-6 py-8">
      <h2 className="text-lg font-bold text-neutral-100">The film</h2>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-neutral-500">
        The cut assembles each cut's ★ keeper clip, mixes the voice takes over it, and bakes the look on export.
        Drag clips below to reorder the film; change keepers in Scenes.
      </p>

      {cut.length === 0 ? (
        <div className="glass grid place-items-center rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-neutral-500">No clips yet. Animate a take in Scenes first.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_18rem] gap-6">
          <div>
            {filmUrl ? (
              <video src={filmUrl} controls autoPlay className="w-full rounded-2xl border border-white/10 bg-black" data-testid="film-result" />
            ) : (
              <div className="glass grid aspect-video place-items-center rounded-2xl">
                <p className="text-sm text-neutral-500">{exporting ? 'Rendering the film…' : 'Export to render the cut'}</p>
              </div>
            )}
            <div className="mt-4">
              <div className="mb-1.5 text-[10px] font-bold tracking-wide text-neutral-500 uppercase">The cut · {cut.length} clip{cut.length === 1 ? '' : 's'}{voices.length ? ` · ${voices.length} voice` : ''}</div>
              <div className="flex gap-2 overflow-x-auto pb-1" data-testid="film-cut">
                {cut.map((c, i) => (
                  <div
                    key={c.promptName}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('clip', c.promptName)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData('clip'); if (from) reorder(from, c.promptName); }}
                    data-testid={`film-clip-${c.promptName}`}
                    className="relative shrink-0 cursor-grab active:cursor-grabbing"
                    title="Drag to reorder the film"
                  >
                    <video src={c.url} muted playsInline preload="metadata" className="pointer-events-none h-20 w-32 rounded-lg border border-white/10 bg-black object-cover" />
                    <span className="absolute top-1 left-1 rounded bg-black/70 px-1 font-mono text-[9px] font-bold text-neutral-200">{i + 1} · {c.promptName}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <aside className="space-y-4">
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
                  <button key={a.label} onClick={() => setVertical(a.v)} className={`flex-1 rounded-lg border px-2 py-2 text-xs ${vertical === a.v ? 'border-[#ff3d8b] bg-[#ff3d8b]/15 text-[#ff9ac4]' : 'border-white/12 text-neutral-400'}`}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => void exportFilm()} disabled={exporting || cut.length === 0} data-testid="export-film" className="btn-grad w-full rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50">
              {exporting ? 'Rendering…' : '▶ Export film'}
            </button>
            {filmUrl && (
              <a href={filmUrl} download="recut-film.mp4" className="block rounded-lg border border-white/12 py-2 text-center text-xs font-medium text-neutral-100 hover:bg-white/5">
                ⬇ Download MP4
              </a>
            )}
            <p className="text-[11px] leading-relaxed text-neutral-600">Export concatenates the keepers, bakes the LUT, and mixes the voice track. Free: no model calls.</p>
          </aside>
        </div>
      )}
    </section>
  );
}
