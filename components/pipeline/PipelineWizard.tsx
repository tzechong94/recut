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

/* ---------------- Stage 1: Assets ---------------- */

function AssetsPanel() {
  const { doc, addAsset, updateAsset, removeAsset, generateAsset, setAssetImage, lockAsset } = usePipeline();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AssetKind>('product');

  return (
    <section className="mx-auto max-w-5xl px-6 py-8">
      <h2 className="text-lg font-bold text-neutral-100">Asset Bible</h2>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-neutral-500">
        Create, test, and lock every reusable reference before generating a single scene. Locked assets are named by
        registry slug and attached to every cut that references them.
      </p>

      <div className="mb-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && (addAsset(name, kind), setName(''))}
          placeholder="Asset name (becomes its registry slug)…"
          data-testid="new-asset-name"
          className="glass flex-1 rounded-xl px-3.5 py-2.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-[color:var(--c2)]"
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as AssetKind)} className="glass rounded-xl px-3 py-2.5 text-sm text-neutral-200 outline-none">
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>{KIND_ICON[k]} {k}</option>
          ))}
        </select>
        <button onClick={() => name.trim() && (addAsset(name, kind), setName(''))} data-testid="add-asset" className="btn-grad rounded-xl px-5 py-2.5 text-sm font-semibold">
          Add asset
        </button>
      </div>

      {doc.assets.length === 0 ? (
        <div className="glass grid place-items-center rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-neutral-400">No assets yet</p>
          <p className="mt-1 max-w-sm text-xs text-neutral-600">Start with your product or hero: name it, add a photo or generate a sheet, then lock it.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doc.assets.map((a) => (
            <AssetCard key={a.id} a={a} onUpdate={updateAsset} onRemove={removeAsset} onGenerate={generateAsset} onUpload={setAssetImage} onLock={lockAsset} />
          ))}
        </div>
      )}
    </section>
  );
}

function AssetCard({
  a, onUpdate, onRemove, onGenerate, onUpload, onLock,
}: {
  a: AssetDoc;
  onUpdate: (id: string, patch: Partial<AssetDoc>) => void;
  onRemove: (id: string) => void;
  onGenerate: (id: string, prompt: string, fromImage?: string) => Promise<void>;
  onUpload: (id: string, dataUri: string) => void;
  onLock: (id: string, locked: boolean) => void;
}) {
  const [prompt, setPrompt] = useState('');
  const busy = usePipeline((s) => s.busy);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = (file: File) => {
    const r = new FileReader();
    r.onload = () => onUpload(a.id, String(r.result));
    r.readAsDataURL(file);
  };

  return (
    <div className={`overflow-hidden rounded-2xl border ${a.locked ? 'border-emerald-500/40' : 'border-white/10'} bg-white/[0.02]`} data-testid={`asset-${a.slug}`}>
      <div className="relative aspect-video bg-neutral-900">
        {a.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.imageUrl} alt={a.slug} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-3xl opacity-40">{KIND_ICON[a.kind]}</div>
        )}
        {a.locked && <span className="absolute top-2 left-2 rounded-md bg-emerald-500/90 px-1.5 py-0.5 text-[10px] font-bold text-black">🔒 LOCKED</span>}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2">
          <input
            value={a.slug}
            disabled={a.locked}
            onChange={(e) => onUpdate(a.id, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
            className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 font-mono text-xs text-neutral-200 outline-none disabled:opacity-60"
          />
          <span className="shrink-0 text-[10px] text-neutral-500">{a.kind}</span>
        </div>
        {!a.locked && (
          <>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={a.imageUrl ? 'refine: turn the photo into a clean sheet…' : 'describe it, or upload a photo…'}
              className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => prompt.trim() && void onGenerate(a.id, prompt, a.imageUrl)}
                disabled={busy !== null || !prompt.trim()}
                className="btn-grad flex-1 rounded-md py-1.5 text-[11px] font-semibold disabled:opacity-50"
              >
                {a.imageUrl ? '↻ Regenerate' : 'Generate'}
              </button>
              <button onClick={() => fileRef.current?.click()} className="rounded-md border border-white/12 px-2.5 py-1.5 text-[11px] text-neutral-300 hover:bg-white/5">⬆ Photo</button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <button onClick={() => onRemove(a.id)} className="rounded-md border border-white/12 px-2 py-1.5 text-[11px] text-rose-300 hover:bg-rose-950/40">✕</button>
            </div>
          </>
        )}
        <button
          onClick={() => onLock(a.id, !a.locked)}
          disabled={!a.imageUrl}
          data-testid={`lock-${a.slug}`}
          className={`w-full rounded-md py-1.5 text-[11px] font-semibold disabled:opacity-40 ${
            a.locked ? 'border border-white/12 text-neutral-400 hover:bg-white/5' : 'bg-emerald-500 text-black hover:bg-emerald-400'
          }`}
        >
          {a.locked ? 'Unlock to edit' : '🔒 Lock asset'}
        </button>
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
        {gates.film && (
          <button onClick={() => setTab('film')} data-testid="to-film" className="btn-grad shrink-0 rounded-lg px-4 py-2 text-xs font-semibold">
            Assemble the film →
          </button>
        )}
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
  const { doc, updatePrompt, runPrompt, voicePrompt, busy } = usePipeline();
  const takes = takesFor(doc, p.name);
  const lockedSlugs = doc.assets.filter((a) => a.locked && a.imageUrl).map((a) => a.slug);

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
        <button onClick={() => void runPrompt(p.name)} disabled={busy !== null} data-testid={`run-${p.name}`} className="btn-grad rounded-md px-3.5 py-1 text-[11px] font-semibold disabled:opacity-50">
          {busy === `running ${p.name}` ? 'Generating…' : takes.length ? '↻ New take' : '▶ Take'}
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
  const { doc, lut, vertical, setLut, setVertical, exportFilm, exporting, filmUrl } = usePipeline();
  const cut = keeperClips(doc);
  const voices = voiceTracks(doc);

  return (
    <section className="mx-auto max-w-5xl px-6 py-8">
      <h2 className="text-lg font-bold text-neutral-100">The film</h2>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-neutral-500">
        The cut assembles each cut's ★ keeper clip in scene order, mixes the voice takes over it, and bakes the look
        on export. Change keepers in Scenes; change order by moving scenes.
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
                  <div key={c.promptName} className="relative shrink-0">
                    <video src={c.url} muted playsInline preload="metadata" className="h-20 w-32 rounded-lg border border-white/10 bg-black object-cover" />
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
