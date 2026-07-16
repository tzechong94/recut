'use client';

// Client store for the three-stage pipeline wizard. The doc is the single source of truth;
// every mutation edits the doc and autosaves (guarded so an unloaded doc never overwrites
// a saved one, same lesson as the canvas autosave bug).

import { create } from 'zustand';
import {
  compilePromptText,
  emptyPipeline,
  promptName,
  resolveAssets,
  toSlug,
  type AssetDoc,
  type AssetKind,
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
  tab: 'assets' | 'shotlist' | 'takes';
  busy: string | null; // human label of the in-flight operation
  error: string | null;
  spentUsd: number;
  capUsd: number | null;

  load: (projectId: string) => Promise<void>;
  save: () => Promise<void>;
  setTab: (tab: PipelineState['tab']) => void;
  patchDoc: (patch: Partial<PipelineDoc>) => void;

  // Stage 1
  addAsset: (name: string, kind: AssetKind) => AssetDoc;
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
  addScene: () => void;

  // Stage 3
  runPrompt: (name: string) => Promise<void>;
  judgeTake: (takeId: string) => Promise<void>;
  animateTake: (takeId: string) => Promise<void>;
  removeTake: (takeId: string) => void;
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

    load: async (projectId) => {
      set({ loadedFor: null, doc: emptyPipeline(projectId), tab: 'assets', error: null });
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
      await fetch(`/api/pipeline/${doc.projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
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
          plan?: { style: string; shots: Array<{ description: string; characters: string[]; animate: boolean }> };
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
        // one beat per scene (spec: the ideal ad structure)
        const scenes = j.plan.shots.map((shot, i) => ({
          title: `Scene ${i + 1}`,
          prompts: [
            {
              name: promptName(i, 0),
              text: shot.description,
              assetSlugs: matchSlugs(shot.characters),
              animate: shot.animate,
            },
          ],
        }));
        mutate((d) => ({ ...d, stylePrefix: d.stylePrefix || j.plan!.style, scenes }));
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
  };
});
