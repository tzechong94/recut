'use client';

// The three-stage pipeline wizard (PIPELINE-SPEC.md): Assets > Shotlist > Takes.
// The wizard is the product; the node canvas remains only as an escape hatch.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePipeline } from '../../lib/pipeline/usePipeline';
import { compilePromptText, keeperClips, resolveAssets, stageReady, takesFor, voiceTracks, type AssetDoc, type AssetKind } from '../../lib/pipeline/doc';
import { LUTS } from '../../lib/post/lut';

const ASSET_KINDS: AssetKind[] = ['product', 'character', 'location', 'prop'];
const KIND_ICON: Record<AssetKind, string> = { product: '📦', character: '🧍', location: '🏠', prop: '☕' };

export function PipelineWizard({ projectId, title }: { projectId: string; title: string }) {
  const { doc, tab, setTab, load, busy, error, spentUsd, capUsd } = usePipeline();
  useEffect(() => {
    void load(projectId);
  }, [projectId, load]);

  const gates = stageReady(doc);
  const tabs: Array<{ key: typeof tab; label: string; enabled: boolean; hint: string }> = [
    { key: 'assets', label: '1 · Assets', enabled: true, hint: 'Create, test, and lock every reusable reference' },
    { key: 'shotlist', label: '2 · Shotlist', enabled: gates.shotlist, hint: 'Lock at least one asset first' },
    { key: 'takes', label: '3 · Takes', enabled: gates.takes, hint: 'Write the shotlist first' },
    { key: 'film', label: '4 · Film', enabled: gates.film, hint: 'Animate at least one take first' },
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
              title={t.enabled ? t.hint : t.hint}
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
        {tab === 'shotlist' && <ShotlistPanel />}
        {tab === 'takes' && <TakesPanel />}
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
        registry slug and attached to every prompt that references them.
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
        <button
          onClick={() => name.trim() && (addAsset(name, kind), setName(''))}
          data-testid="add-asset"
          className="btn-grad rounded-xl px-5 py-2.5 text-sm font-semibold"
        >
          Add asset
        </button>
      </div>

      {doc.assets.length === 0 ? (
        <div className="glass grid place-items-center rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-neutral-400">No assets yet</p>
          <p className="mt-1 max-w-sm text-xs text-neutral-600">Start with the product: name it, add its photo or generate a sheet, then lock it.</p>
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
            <div className="flex gap-1.5">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={a.imageUrl ? 'refine: turn the photo into a clean sheet…' : 'describe it, or upload a photo…'}
                className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
              />
            </div>
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

/* ---------------- Stage 2: Shotlist ---------------- */

function ShotlistPanel() {
  const { doc, setStylePrefix, setSceneOverride, planShotlist, updatePrompt, addPrompt, addScene, removeScene, shiftScene, busy, setTab } = usePipeline();
  const [beats, setBeats] = useState('');
  const lockedSlugs = doc.assets.filter((a) => a.locked && a.imageUrl).map((a) => a.slug);

  return (
    <section className="mx-auto max-w-5xl px-6 py-8">
      <h2 className="text-lg font-bold text-neutral-100">Connected shotlist</h2>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-neutral-500">
        One document. The global Style Prefix is glued to every prompt; each prompt has a name and lists its required
        assets by registry slug. Edits are surgical, by name.
      </p>

      <div className="glass mb-6 rounded-2xl p-4">
        <div className="grad-text mb-1.5 text-[10px] font-bold tracking-wide uppercase">Global Style Prefix</div>
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
            <button
              onClick={() => beats.trim() && void planShotlist(beats)}
              disabled={busy !== null || !beats.trim()}
              data-testid="draft-shotlist"
              className="btn-grad rounded-lg px-5 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {busy ? 'Planning…' : 'Draft shotlist'}
            </button>
            <button onClick={addScene} className="rounded-lg border border-white/12 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5">Start blank</button>
          </div>
        </div>
      ) : (
        <>
          {doc.scenes.map((scene, si) => (
            <div key={si} className="glass mb-4 rounded-2xl p-4" data-testid={`scene-${si + 1}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-bold text-neutral-200">
                  {scene.title}
                  <button onClick={() => shiftScene(si, -1)} disabled={si === 0} title="Move scene up" data-testid={`scene-up-${si}`} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-white/5 disabled:opacity-30">▲</button>
                  <button onClick={() => shiftScene(si, 1)} disabled={si === doc.scenes.length - 1} title="Move scene down" data-testid={`scene-down-${si}`} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-white/5 disabled:opacity-30">▼</button>
                  <button onClick={() => { if (confirm(`Delete ${scene.title} and its takes?`)) removeScene(si); }} title="Delete scene (its prompts and takes go with it)" data-testid={`scene-delete-${si}`} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-rose-300/80 hover:bg-rose-950/40">✕</button>
                </span>
                <input
                  value={scene.styleOverride ?? ''}
                  onChange={(e) => setSceneOverride(si, e.target.value)}
                  placeholder="scoped style override for this scene only (optional)…"
                  className="w-1/2 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-amber-200/90 outline-none placeholder:text-neutral-600"
                />
              </div>
              {scene.prompts.map((p) => (
                <div key={p.name} className="mb-3 rounded-xl border border-white/8 bg-black/20 p-3">
                  <div className="mb-1.5 flex items-center gap-2">
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
                  </div>
                  <textarea
                    value={p.text}
                    onChange={(e) => updatePrompt(p.name, { text: e.target.value })}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-neutral-200 outline-none focus:border-[color:var(--c2)]"
                  />
                  <input
                    value={p.dialogue ?? ''}
                    onChange={(e) => updatePrompt(p.name, { dialogue: e.target.value || undefined })}
                    placeholder="🔊 spoken line for this beat (optional, drama)…"
                    className="mt-1.5 w-full rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-pink-200/90 outline-none placeholder:text-neutral-700"
                  />
                  <p className="mt-1.5 line-clamp-2 font-mono text-[10px] leading-relaxed text-neutral-600" title={compilePromptText(doc, p.name)}>
                    → {compilePromptText(doc, p.name)}
                  </p>
                </div>
              ))}
              <button onClick={() => addPrompt(si)} className="text-[11px] text-neutral-500 hover:text-neutral-300">＋ prompt</button>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button onClick={addScene} className="rounded-lg border border-white/12 px-4 py-2 text-sm text-neutral-300 hover:bg-white/5">＋ Scene</button>
            <button onClick={() => setTab('takes')} data-testid="to-takes" className="btn-grad rounded-lg px-5 py-2 text-sm font-semibold">Iterate takes →</button>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------------- Stage 3: Takes ---------------- */

function TakesPanel() {
  const { doc, runPrompt, voicePrompt, judgeTake, animateTake, removeTake, setKeeper, busy } = usePipeline();
  const prompts = doc.scenes.flatMap((s) => s.prompts);
  const [selected, setSelected] = useState<string | null>(prompts[0]?.name ?? null);
  const current = selected ?? prompts[0]?.name ?? null;
  const takes = current ? takesFor(doc, current) : [];
  const assets = current ? resolveAssets(doc, current) : [];

  return (
    <section className="grid h-full grid-cols-[15rem_1fr]">
      <aside className="overflow-y-auto border-r border-white/8 p-3">
        <div className="mb-2 px-1 text-[10px] font-bold tracking-wide text-neutral-500 uppercase">Prompts</div>
        {prompts.map((p) => {
          const n = takesFor(doc, p.name);
          const best = n.reduce<number | undefined>((m, t) => (t.score !== undefined && (m === undefined || t.score > m) ? t.score : m), undefined);
          return (
            <button
              key={p.name}
              onClick={() => setSelected(p.name)}
              data-testid={`prompt-${p.name}`}
              className={`mb-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs ${current === p.name ? 'bg-white/8 text-neutral-100' : 'text-neutral-400 hover:bg-white/4'}`}
            >
              <span className="font-mono font-bold">{p.name}</span>
              <span className="flex items-center gap-1.5">
                {best !== undefined && (
                  <span className={`rounded px-1 py-0.5 text-[10px] font-semibold tabular-nums ${best >= 0.7 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>{best.toFixed(2)}</span>
                )}
                <span className="text-[10px] text-neutral-600">{n.length} take{n.length === 1 ? '' : 's'}</span>
              </span>
            </button>
          );
        })}
      </aside>

      <div className="overflow-y-auto p-6">
        {current ? (
          <>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-mono text-lg font-black text-neutral-100">{current}</h2>
                <p className="mt-1 max-w-2xl font-mono text-[11px] leading-relaxed text-neutral-500">{compilePromptText(doc, current)}</p>
                {assets.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-[10px] text-neutral-600 uppercase">refs</span>
                    {assets.map((a) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={a.id} src={a.imageUrl} alt={a.slug} title={a.slug} className="h-8 w-11 rounded border border-white/10 object-cover" />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {prompts.find((p) => p.name === current)?.dialogue && (
                  <button
                    onClick={() => void voicePrompt(current)}
                    disabled={busy !== null}
                    data-testid="voice-prompt"
                    title="Synthesize the spoken line as a voice take"
                    className="rounded-lg border border-pink-500/40 bg-pink-500/10 px-4 py-2.5 text-sm font-semibold text-pink-200 hover:bg-pink-500/20 disabled:opacity-50"
                  >
                    🔊 Voice line
                  </button>
                )}
                <button
                  onClick={() => void runPrompt(current)}
                  disabled={busy !== null}
                  data-testid="run-prompt"
                  className="btn-grad rounded-lg px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  {busy?.startsWith('running') ? 'Generating…' : takes.length ? '↻ New take' : '▶ Generate take'}
                </button>
              </div>
            </div>

            {takes.length === 0 ? (
              <div className="glass grid place-items-center rounded-2xl px-6 py-16 text-center">
                <p className="text-sm text-neutral-500">No takes yet. Generate the first one.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="takes-grid">
                {takes.map((t) => (
                  <div key={t.id} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                    {t.kind === 'audio' ? (
                      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-black/40">
                        <span className="text-3xl">🔊</span>
                        <audio src={t.url} controls className="w-4/5" />
                      </div>
                    ) : t.kind === 'video' ? (
                      <video src={t.url} controls muted loop playsInline className="aspect-video w-full bg-black object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.url} alt={t.promptName} className="aspect-video w-full object-cover" />
                    )}
                    <div className="flex items-center justify-between gap-2 p-2.5">
                      <div className="flex items-center gap-2">
                        {t.score !== undefined ? (
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${t.score >= 0.7 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                            ◎ {t.score.toFixed(2)}
                          </span>
                        ) : (
                          t.kind === 'image' && (
                            <button onClick={() => void judgeTake(t.id)} disabled={busy !== null} className="rounded-md border border-white/12 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-50">
                              ◎ Judge
                            </button>
                          )
                        )}
                        {t.repairInstruction && t.score !== undefined && t.score < 0.7 && (
                          <span className="line-clamp-1 max-w-[14rem] text-[10px] text-amber-300/80" title={t.repairInstruction}>{t.repairInstruction}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {t.kind === 'video' && (
                          <button
                            onClick={() => setKeeper(t.id)}
                            title="Keeper: this take represents the prompt in the film"
                            data-testid={`keeper-${t.id}`}
                            className={`rounded-md border px-2 py-1 text-[11px] ${t.keeper ? 'border-amber-400/60 bg-amber-400/15 text-amber-200' : 'border-white/12 text-neutral-400 hover:bg-white/5'}`}
                          >
                            {t.keeper ? '★ Keeper' : '☆ Keeper'}
                          </button>
                        )}
                        {t.kind === 'image' && (
                          <button onClick={() => void animateTake(t.id)} disabled={busy !== null} className="rounded-md border border-white/12 px-2 py-1 text-[11px] text-neutral-300 hover:bg-white/5 disabled:opacity-50">
                            🎬 Animate
                          </button>
                        )}
                        <button onClick={() => removeTake(t.id)} className="rounded-md px-1.5 py-1 text-[11px] text-neutral-600 hover:text-rose-300">✕</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-neutral-500">Write the shotlist first.</p>
        )}
      </div>
    </section>
  );
}

/* ---------------- Stage 4: Film ---------------- */

function FilmPanel() {
  const { doc, lut, vertical, setLut, setVertical, exportFilm, exporting, filmUrl } = usePipeline();
  const cut = keeperClips(doc);
  const voices = voiceTracks(doc);

  return (
    <section className="mx-auto max-w-5xl px-6 py-8">
      <h2 className="text-lg font-bold text-neutral-100">The film</h2>
      <p className="mt-1 mb-6 max-w-2xl text-sm text-neutral-500">
        The cut assembles each prompt's ★ keeper clip in scene order, mixes the voice takes over it, and bakes the
        look on export. Change keepers in Takes; change order in the Shotlist.
      </p>

      {cut.length === 0 ? (
        <div className="glass grid place-items-center rounded-2xl px-6 py-16 text-center">
          <p className="text-sm text-neutral-500">No clips yet. Animate a take in Stage 3 first.</p>
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
                    <video src={c.url} muted playsInline className="h-20 w-32 rounded-lg border border-white/10 bg-black object-cover" />
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
