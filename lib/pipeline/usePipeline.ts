'use client';

// Client store for the three-stage pipeline wizard. The doc is the single source of truth;
// every mutation edits the doc and autosaves (guarded so an unloaded doc never overwrites
// a saved one, same lesson as the canvas autosave bug).

import { create } from 'zustand';
import {
  compilePromptText,
  deletePrompt,
  deleteScene,
  emptyPipeline,
  keeperClips,
  moveScene,
  voiceTracks,
  promptName,
  resolveAssets,
  toSlug,
  type AssetDoc,
  type AssetKind,
  type CandidateDoc,
  type PipelineDoc,
  type PromptDoc,
  type TakeDoc,
} from './doc';

interface GenerateResponse {
  imageUrl?: string;
  videoUrl?: string;
  taskId?: string;
  score?: number;
  verdict?: { repair_instruction?: string } & Record<string, unknown>;
  error?: string;
  spentUsd?: number;
  capUsd?: number | null;
}

async function callGenerate(body: Record<string, unknown>): Promise<GenerateResponse> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await res.json().catch(() => ({}))) as GenerateResponse;
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j;
}

interface PipelineState {
  doc: PipelineDoc;
  loadedFor: string | null;
  tab: 'assets' | 'scenes' | 'film';
  busy: string | null; // human label of the in-flight operation
  error: string | null;
  spentUsd: number;
  capUsd: number | null;
  // Stage 4: film
  filmUrl: string | null;
  exporting: boolean;
  lut: string;
  vertical: boolean;

  load: (projectId: string) => Promise<void>;
  save: () => Promise<void>;
  setTab: (tab: PipelineState['tab']) => void;
  patchDoc: (patch: Partial<PipelineDoc>) => void;

  // Stage 1
  addAsset: (name: string, kind: AssetKind) => AssetDoc;
  /** batch-generate n candidates into the tray (Figma-style curation: generate many, shortlist) */
  generateCandidates: (kind: AssetKind, prompt: string, n: number, fromImage?: string) => Promise<void>;
  /** drag a candidate onto the board: it becomes an (unlocked) asset at that position */
  promoteCandidate: (candidateId: string, pos?: { x: number; y: number }) => void;
  discardCandidate: (candidateId: string) => void;
  moveAsset: (id: string, pos: { x: number; y: number }) => void;
  updateAsset: (id: string, patch: Partial<AssetDoc>) => void;
  removeAsset: (id: string) => void;
  generateAsset: (id: string, prompt: string, fromImage?: string) => Promise<void>;
  setAssetImage: (id: string, dataUri: string) => void;
  lockAsset: (id: string, locked: boolean) => void;

  // Stage 2
  setStylePrefix: (prefix: string) => void;
  setSceneOverride: (sceneIdx: number, override: string) => void;
  planShotlist: (beats: string) => Promise<void>;
  updatePrompt: (name: string, patch: Partial<PromptDoc>) => void;
  addPrompt: (sceneIdx: number) => void;
  /** coverage cut: duplicate the scene's master cut at the next shot size (editorial coverage) */
  addCoverage: (sceneIdx: number) => void;
  addScene: () => void;
  removeScene: (sceneIdx: number) => void;
  removePrompt: (name: string) => void;
  shiftScene: (sceneIdx: number, dir: -1 | 1) => void;
  setScript: (script: string) => void;

  // Stage 3
  runPrompt: (name: string) => Promise<void>;
  /** batch: n image takes for a cut (images are cheap; shortlist, then animate the keeper) */
  batchTakes: (name: string, n: number) => Promise<void>;
  setFilmOrder: (names: string[]) => void;
  /** taxonomy auto-fix: append the judge's repair instruction to the prompt (surgical, by name), re-run */
  applyRepair: (takeId: string) => Promise<void>;
  voicePrompt: (name: string) => Promise<void>;
  judgeTake: (takeId: string) => Promise<void>;
  animateTake: (takeId: string) => Promise<void>;
  removeTake: (takeId: string) => void;
  setKeeper: (takeId: string) => void;
  // Stage 4
  setLut: (lut: string) => void;
  setVertical: (vertical: boolean) => void;
  exportFilm: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const usePipeline = create<PipelineState>((set, get) => {
  const mutate = (fn: (doc: PipelineDoc) => PipelineDoc) => {
    const s = get();
    if (s.loadedFor !== s.doc.projectId) return; // never mutate before load completes
    set({ doc: fn(s.doc) });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().save(), 800);
  };
  const trackSpend = (j: GenerateResponse) => {
    if (typeof j.spentUsd === 'number') set({ spentUsd: j.spentUsd });
    if (j.capUsd !== undefined) set({ capUsd: j.capUsd });
  };

  return {
    doc: emptyPipeline(''),
    loadedFor: null,
    tab: 'assets',
    busy: null,
    error: null,
    spentUsd: 0,
    capUsd: null,
    filmUrl: null,
    exporting: false,
    lut: 'warm-film',
    vertical: false,

    load: async (projectId) => {
      set({ loadedFor: null, doc: emptyPipeline(projectId), tab: 'assets', error: null, filmUrl: null });
      try {
        const res = await fetch(`/api/pipeline/${projectId}`);
        if (res.ok) set({ doc: (await res.json()) as PipelineDoc });
      } finally {
        set({ loadedFor: projectId });
      }
    },
    save: async () => {
      const { doc, loadedFor } = get();
      if (loadedFor !== doc.projectId || !doc.projectId) return;
      // keepalive: a flush on tab-hide/unload still lands even as the page goes away
      await fetch(`/api/pipeline/${doc.projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
        keepalive: true,
      }).catch(() => undefined);
    },
    setTab: (tab) => set({ tab }),
    patchDoc: (patch) => mutate((d) => ({ ...d, ...patch })),

    addAsset: (name, kind) => {
      const asset: AssetDoc = { id: crypto.randomUUID().slice(0, 8), slug: toSlug(name), kind, locked: false };
      mutate((d) => ({ ...d, assets: [...d.assets, asset] }));
      return asset;
    },
    updateAsset: (id, patch) =>
      mutate((d) => ({ ...d, assets: d.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    removeAsset: (id) => mutate((d) => ({ ...d, assets: d.assets.filter((a) => a.id !== id) })),

    generateAsset: async (id, prompt, fromImage) => {
      const { doc } = get();
      const asset = doc.assets.find((a) => a.id === id);
      if (!asset) return;
      set({ busy: `generating ${asset.slug}`, error: null });
      try {
        const style = doc.stylePrefix ? `${doc.stylePrefix}. ` : '';
        const j = fromImage
          ? await callGenerate({ kind: 'edit', image: fromImage, prompt: `${style}${prompt}`, aspect: '16:9' })
          : await callGenerate({ kind: 'text2image', prompt: `${style}${prompt}`, aspect: '16:9' });
        trackSpend(j);
        if (j.imageUrl) get().updateAsset(id, { imageUrl: j.imageUrl, locked: false });
      } catch (e) {
        set({ error: String(e).slice(0, 160) });
      } finally {
        set({ busy: null });
      }
    },
    generateCandidates: async (kind, prompt, n, fromImage) => {
      const { doc } = get();
      const style = doc.stylePrefix ? `${doc.stylePrefix}. ` : '';
      for (let i = 0; i < n; i++) {
        set({ busy: `candidate ${i + 1}/${n}`, error: null });
        try {
          const j = fromImage
            ? await callGenerate({ kind: 'edit', image: fromImage, prompt: `${style}${prompt}`, aspect: '16:9' })
            : await callGenerate({ kind: 'text2image', prompt: `${style}${prompt}`, aspect: '16:9' });
          trackSpend(j);
          if (j.imageUrl) {
            const cand: CandidateDoc = { id: crypto.randomUUID().slice(0, 8), kind, url: j.imageUrl, prompt };
            mutate((d) => ({ ...d, candidates: [...(d.candidates ?? []), cand] }));
          }
        } catch (e) {
          set({ error: String(e).slice(0, 160) });
          break; // a failed call (e.g. budget refusal) stops the batch, never loops on errors
        }
      }
      set({ busy: null });
    },

    promoteCandidate: (candidateId, pos) =>
      mutate((d) => {
        const cand = (d.candidates ?? []).find((c) => c.id === candidateId);
        if (!cand) return d;
        const base = toSlug(cand.prompt.split(/[,.]/)[0] ?? cand.kind).slice(0, 24) || cand.kind;
        let slug = base;
        let i = 2;
        while (d.assets.some((a) => a.slug === slug)) slug = `${base}_${i++}`;
        // fresh asset id: the same candidate can be crowned more than once; the tray keeps it
        const asset: AssetDoc = { id: crypto.randomUUID().slice(0, 8), slug, kind: cand.kind, imageUrl: cand.url, locked: false, x: pos?.x, y: pos?.y };
        return {
          ...d,
          assets: [...d.assets, asset],
          candidates: (d.candidates ?? []).map((c) => (c.id === candidateId ? { ...c, used: true } : c)),
        };
      }),

    discardCandidate: (candidateId) =>
      mutate((d) => ({ ...d, candidates: (d.candidates ?? []).filter((c) => c.id !== candidateId) })),

    moveAsset: (id, pos) =>
      mutate((d) => ({ ...d, assets: d.assets.map((a) => (a.id === id ? { ...a, x: pos.x, y: pos.y } : a)) })),

    setAssetImage: (id, dataUri) => get().updateAsset(id, { imageUrl: dataUri, locked: false }),
    lockAsset: (id, locked) => get().updateAsset(id, { locked }),

    setStylePrefix: (stylePrefix) => mutate((d) => ({ ...d, stylePrefix })),
    setSceneOverride: (sceneIdx, override) =>
      mutate((d) => ({
        ...d,
        scenes: d.scenes.map((s, i) => (i === sceneIdx ? { ...s, styleOverride: override || undefined } : s)),
      })),

    planShotlist: async (beats) => {
      set({ busy: 'planning shotlist', error: null });
      try {
        const res = await fetch('/api/agent/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ premise: beats }),
        });
        const j = (await res.json()) as {
          plan?: {
            style: string;
            characters?: Array<{ name: string; description: string }>;
            shots: Array<{ description: string; characters: string[]; animate: boolean; dialogue?: string; shotSize?: string; angle?: string; lens?: string; light?: string }>;
          };
          error?: string;
          spentUsd?: number;
        };
        if (!res.ok || !j.plan) throw new Error(j.error ?? `HTTP ${res.status}`);
        if (typeof j.spentUsd === 'number') set({ spentUsd: j.spentUsd });
        const { doc } = get();
        const slugByName = new Map(doc.assets.map((a) => [a.slug, a.slug]));
        const matchSlugs = (names: string[]): string[] => {
          const out: string[] = [];
          for (const n of names) {
            const slug = toSlug(n);
            // exact slug, else any registered slug that contains/is contained by the name
            const hit = slugByName.get(slug) ?? doc.assets.find((a) => a.slug.includes(slug) || slug.includes(a.slug))?.slug;
            if (hit && !out.includes(hit)) out.push(hit);
          }
          return out;
        };
        // drama generalisation: planned characters with no matching asset become unlocked
        // character stubs in the registry, ready to generate + lock in Stage 1
        const stubs = (j.plan.characters ?? [])
          .filter((c) => matchSlugs([c.name]).length === 0)
          .map((c) => ({ id: crypto.randomUUID().slice(0, 8), slug: toSlug(c.name), kind: 'character' as const, locked: false }));
        const allSlugs = (names: string[]): string[] => {
          const matched = matchSlugs(names);
          for (const n of names) {
            const stub = stubs.find((st) => st.slug === toSlug(n));
            if (stub && !matched.includes(stub.slug)) matched.push(stub.slug);
          }
          return matched;
        };
        // one beat per scene (the ideal structure for ads and dramas alike)
        const scenes = j.plan.shots.map((shot, i) => ({
          title: `Scene ${i + 1}`,
          prompts: [
            {
              name: promptName(i, 0),
              text: shot.description,
              assetSlugs: allSlugs(shot.characters),
              animate: shot.animate,
              dialogue: shot.dialogue || undefined,
              shotSize: shot.shotSize,
              angle: shot.angle,
              lens: shot.lens,
              light: shot.light,
            },
          ],
        }));
        mutate((d) => ({ ...d, script: beats, stylePrefix: d.stylePrefix || j.plan!.style, assets: [...d.assets, ...stubs], scenes }));
      } catch (e) {
        set({ error: String(e).slice(0, 160) });
      } finally {
        set({ busy: null });
      }
    },

    updatePrompt: (name, patch) =>
      mutate((d) => ({
        ...d,
        scenes: d.scenes.map((s) => ({
          ...s,
          prompts: s.prompts.map((p) => (p.name === name ? { ...p, ...patch } : p)),
        })),
      })),
    addCoverage: (sceneIdx) =>
      mutate((d) => {
        const scene = d.scenes[sceneIdx];
        const master = scene?.prompts[0];
        if (!scene || !master) return d;
        const LADDER = ['wide shot', 'medium shot', 'close-up', 'extreme close-up'];
        const used = new Set(scene.prompts.map((p) => p.shotSize).filter(Boolean));
        const next = LADDER.find((x) => !used.has(x)) ?? 'close-up';
        const cut = {
          name: promptName(sceneIdx, scene.prompts.length),
          text: master.text,
          assetSlugs: [...master.assetSlugs],
          animate: master.animate,
          shotSize: next,
          angle: master.angle,
          lens: master.lens,
          light: master.light,
        };
        return { ...d, scenes: d.scenes.map((sc, i) => (i === sceneIdx ? { ...sc, prompts: [...sc.prompts, cut] } : sc)) };
      }),

    addPrompt: (sceneIdx) =>
      mutate((d) => ({
        ...d,
        scenes: d.scenes.map((s, i) =>
          i === sceneIdx
            ? { ...s, prompts: [...s.prompts, { name: promptName(i, s.prompts.length), text: '', assetSlugs: [] }] }
            : s,
        ),
      })),
    addScene: () =>
      mutate((d) => ({
        ...d,
        scenes: [...d.scenes, { title: `Scene ${d.scenes.length + 1}`, prompts: [{ name: promptName(d.scenes.length, 0), text: '', assetSlugs: [] }] }],
      })),

    removeScene: (sceneIdx) => mutate((d) => deleteScene(d, sceneIdx)),
    removePrompt: (name) => mutate((d) => deletePrompt(d, name)),
    setScript: (script) => mutate((d) => ({ ...d, script })),
    shiftScene: (sceneIdx, dir) => mutate((d) => moveScene(d, sceneIdx, dir)),

    // drama: a prompt's dialogue line becomes a voice take via TTS
    batchTakes: async (name, n) => {
      for (let i = 0; i < n; i++) {
        await get().runPrompt(name);
        if (get().error) break; // budget refusal or API error stops the batch
      }
    },

    setFilmOrder: (names) => mutate((d) => ({ ...d, filmOrder: names })),

    applyRepair: async (takeId) => {
      const { doc } = get();
      const take = doc.takes.find((t) => t.id === takeId);
      const instruction = take?.repairInstruction?.trim();
      if (!take || !instruction) return;
      const hit = doc.scenes.flatMap((s) => s.prompts).find((p) => p.name === take.promptName);
      if (!hit) return;
      // one surgical edit: the repair rides on THIS prompt only, nothing else changes
      if (!hit.text.includes(instruction)) {
        get().updatePrompt(take.promptName, { text: `${hit.text} ${instruction}` });
      }
      await get().runPrompt(take.promptName);
    },

    voicePrompt: async (name) => {
      const { doc } = get();
      const hit = doc.scenes.flatMap((s) => s.prompts).find((p) => p.name === name);
      if (!hit?.dialogue?.trim()) return;
      set({ busy: `voicing ${name}`, error: null });
      try {
        const j = await callGenerate({ kind: 'dialogue', prompt: hit.dialogue });
        trackSpend(j);
        const url = (j as { audioUrl?: string }).audioUrl;
        if (url) {
          const take: TakeDoc = { id: crypto.randomUUID().slice(0, 8), promptName: name, kind: 'audio', url };
          mutate((d) => ({ ...d, takes: [...d.takes, take] }));
        }
      } catch (e) {
        set({ error: String(e).slice(0, 160) });
      } finally {
        set({ busy: null });
      }
    },

    runPrompt: async (name) => {
      const { doc } = get();
      const text = compilePromptText(doc, name);
      if (!text) return;
      const assets = resolveAssets(doc, name);
      const imgs = assets.map((a) => a.imageUrl!) ;
      set({ busy: `running ${name}`, error: null });
      try {
        const j =
          imgs.length >= 2
            ? await callGenerate({ kind: 'compose', images: imgs.slice(0, 3), prompt: text, aspect: '16:9' })
            : imgs.length === 1
              ? await callGenerate({ kind: 'edit', image: imgs[0], prompt: text, aspect: '16:9' })
              : await callGenerate({ kind: 'text2image', prompt: text, aspect: '16:9' });
        trackSpend(j);
        if (j.imageUrl) {
          const take: TakeDoc = { id: crypto.randomUUID().slice(0, 8), promptName: name, kind: 'image', url: j.imageUrl };
          mutate((d) => ({ ...d, takes: [...d.takes, take] }));
        }
      } catch (e) {
        set({ error: String(e).slice(0, 160) });
      } finally {
        set({ busy: null });
      }
    },

    judgeTake: async (takeId) => {
      const { doc } = get();
      const take = doc.takes.find((t) => t.id === takeId);
      if (!take) return;
      const refs = resolveAssets(doc, take.promptName).map((a) => a.imageUrl!);
      set({ busy: `judging ${take.promptName}`, error: null });
      try {
        const j = await callGenerate({
          kind: 'critique',
          image: take.url,
          refs: refs.length ? refs : undefined,
          prompt: compilePromptText(doc, take.promptName),
        });
        trackSpend(j);
        mutate((d) => ({
          ...d,
          takes: d.takes.map((t) =>
            t.id === takeId
              ? { ...t, score: j.score, verdict: j.verdict, repairInstruction: j.verdict?.repair_instruction }
              : t,
          ),
        }));
      } catch (e) {
        set({ error: String(e).slice(0, 160) });
      } finally {
        set({ busy: null });
      }
    },

    animateTake: async (takeId) => {
      const { doc } = get();
      const take = doc.takes.find((t) => t.id === takeId);
      if (!take || take.kind !== 'image') return;
      const hit = doc.scenes.flatMap((s) => s.prompts).find((p) => p.name === take.promptName);
      set({ busy: `animating ${take.promptName} (1-2 min)`, error: null });
      try {
        const j = await callGenerate({ kind: 'video', image: take.url, prompt: hit?.text ?? 'subtle natural motion, cinematic' });
        trackSpend(j);
        let videoUrl = j.videoUrl;
        if (j.taskId) {
          const deadline = Date.now() + 6 * 60_000;
          while (Date.now() < deadline && !videoUrl) {
            await new Promise((r) => setTimeout(r, 5000));
            const sres = await fetch(`/api/generate/status?taskId=${j.taskId}`);
            const sj = (await sres.json()) as { status?: string; videoUrl?: string; error?: string };
            if (sj.status === 'done' && sj.videoUrl) videoUrl = sj.videoUrl;
            if (sj.status === 'failed') throw new Error(sj.error ?? 'i2v failed');
          }
          if (!videoUrl) throw new Error('i2v timed out');
        }
        if (videoUrl) {
          const take2: TakeDoc = { id: crypto.randomUUID().slice(0, 8), promptName: take.promptName, kind: 'video', url: videoUrl };
          mutate((d) => ({ ...d, takes: [...d.takes, take2] }));
        }
      } catch (e) {
        set({ error: String(e).slice(0, 160) });
      } finally {
        set({ busy: null });
      }
    },

    removeTake: (takeId) => mutate((d) => ({ ...d, takes: d.takes.filter((t) => t.id !== takeId) })),

    // exactly one crowned take per prompt PER KIND: a crowned image is the keyframe of record
    // (what Animate uses); a crowned video is the film keeper. Crowning un-crowns siblings.
    setKeeper: (takeId) =>
      mutate((d) => {
        const target = d.takes.find((t) => t.id === takeId);
        if (!target) return d;
        return {
          ...d,
          takes: d.takes.map((t) =>
            t.promptName === target.promptName && t.kind === target.kind
              ? { ...t, keeper: t.id === takeId ? !t.keeper : false }
              : t,
          ),
        };
      }),

    setLut: (lut) => set({ lut, filmUrl: null }),
    setVertical: (vertical) => set({ vertical, filmUrl: null }),

    exportFilm: async () => {
      const { doc, lut, vertical } = get();
      const clips = keeperClips(doc).map((c) => c.url);
      if (clips.length === 0) return;
      set({ exporting: true, error: null, filmUrl: null });
      try {
        const res = await fetch('/api/assemble', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clips, audio: voiceTracks(doc), lut, vertical }),
        });
        const j = (await res.json().catch(() => ({}))) as { videoUrl?: string; error?: string };
        if (!res.ok || !j.videoUrl) throw new Error(j.error ?? `HTTP ${res.status}`);
        set({ filmUrl: j.videoUrl });
      } catch (e) {
        set({ error: String(e).slice(0, 160) });
      } finally {
        set({ exporting: false });
      }
    },
  };
});
