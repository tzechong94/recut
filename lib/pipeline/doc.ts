// The pipeline document: the single connected artifact behind the three-stage wizard
// (PIPELINE-SPEC.md). Stage 1 assets are named by registry slug; Stage 2 is one connected
// shotlist (global Style Prefix, named prompts, per-scene overrides); Stage 3 takes are
// keyed by prompt name. PURE module: types + merge/derive helpers only, no I/O.

export type AssetKind = 'product' | 'character' | 'location' | 'prop';

export interface AssetDoc {
  id: string;
  /** stable registry name, used verbatim in prompts (spec 1.1): `hero`, `sofa`, `hero_wet` */
  slug: string;
  kind: AssetKind;
  imageUrl?: string;
  /** locked = motion-tested + immutable; only locked assets may be referenced by prompts */
  locked: boolean;
  /** state variant (spec 1.8): `hero_wet` is a variant of `hero` with state 'wet' */
  variantOf?: string;
  state?: string;
  /** judge scores recorded at lock time (motion test, spec 1.6) */
  judge?: { identity?: number; lighting?: number; realism?: number };
  /** freeform board position (Figma-style curation); undefined = grid fallback */
  x?: number;
  y?: number;
}

/** A generated candidate in the tray; dragging to the board creates an asset INSTANCE from it.
 *  The candidate stays in the tray (it is a palette, not a queue) and is marked used. */
export interface CandidateDoc {
  id: string;
  kind: AssetKind;
  url: string;
  prompt: string;
  /** at least one board asset was created from this candidate */
  used?: boolean;
}

export interface PromptDoc {
  /** the prompt's name: scene number + letter, e.g. `1A`, `2C`. Edits are surgical by name. */
  name: string;
  text: string;
  /** asset registry slugs this prompt requires; refs are attached from these at run time */
  assetSlugs: string[];
  /** whether this beat gets animated (i2v) after the keyframe is approved */
  animate?: boolean;
  /** spoken line for this beat (drama generation); becomes a voice take via TTS */
  dialogue?: string;
  // cinematography presets (from the main-branch inspector): appended to the compiled prompt,
  // so regenerating a cut at a new angle is a dropdown change, not a prose rewrite
  shotSize?: string;
  angle?: string;
  lens?: string;
  light?: string;
}

export interface SceneDoc {
  title: string;
  /** scoped override: replaces/extends the global Style Prefix for this scene only */
  styleOverride?: string;
  prompts: PromptDoc[];
}

export interface TakeDoc {
  id: string;
  promptName: string;
  kind: 'image' | 'video' | 'audio';
  url: string;
  /** the harvested keeper for its prompt (spec Stage 3: pull keeper phases across takes) */
  keeper?: boolean;
  /** VLM judge output for this take */
  score?: number;
  verdict?: Record<string, unknown>;
  repairInstruction?: string;
}

export interface PipelineDoc {
  projectId: string;
  /** the film's script / beat sheet (the Script stage feeds the director skill with this) */
  script?: string;
  /** global Style Prefix (spec Stage 2): glued to every prompt; change once, changes everywhere */
  stylePrefix: string;
  /** user has committed the style (UI lock: read-only until unlocked) */
  styleLocked?: boolean;
  assets: AssetDoc[];
  /** candidate tray: batch-generated options not yet shortlisted onto the board */
  candidates?: CandidateDoc[];
  scenes: SceneDoc[];
  takes: TakeDoc[];
  /** manual film order (prompt names); scene order when absent */
  filmOrder?: string[];
}

export function emptyPipeline(projectId: string): PipelineDoc {
  return { projectId, stylePrefix: '', assets: [], scenes: [], takes: [] };
}

/** Prompt name for scene index s (0-based) and prompt index p: 1A, 1B, 2A … */
export function promptName(sceneIdx: number, promptIdx: number): string {
  return `${sceneIdx + 1}${String.fromCharCode(65 + promptIdx)}`;
}

/** Find a prompt (and its scene) by name across the shotlist. */
export function findPrompt(doc: PipelineDoc, name: string): { scene: SceneDoc; prompt: PromptDoc } | undefined {
  for (const scene of doc.scenes) {
    const prompt = scene.prompts.find((p) => p.name === name);
    if (prompt) return { scene, prompt };
  }
  return undefined;
}

/**
 * The compiled text for a named prompt. Merge order (spec Stage 2): global Style Prefix,
 * then the scene's scoped override, then the prompt body, then explicit asset anchors.
 * Deterministic: identical doc + name gives byte-identical output.
 */
export function compilePromptText(doc: PipelineDoc, name: string): string {
  const hit = findPrompt(doc, name);
  if (!hit) return '';
  const parts: string[] = [];
  const prefix = hit.scene.styleOverride?.trim() || doc.stylePrefix.trim();
  if (prefix) parts.push(prefix);
  parts.push(hit.prompt.text.trim());
  const cine = [hit.prompt.shotSize, hit.prompt.angle, hit.prompt.lens, hit.prompt.light].filter(Boolean).join(', ');
  if (cine) parts.push(cine);
  if (hit.prompt.assetSlugs.length) {
    parts.push(`Use the attached reference images for: ${hit.prompt.assetSlugs.join(', ')}. Keep each exactly on-model.`);
  }
  return parts.filter(Boolean).join('. ');
}

/** Resolve a prompt's asset slugs to locked assets, preserving slug order. Unlocked/missing are skipped. */
export function resolveAssets(doc: PipelineDoc, name: string): AssetDoc[] {
  const hit = findPrompt(doc, name);
  if (!hit) return [];
  const bySlug = new Map(doc.assets.map((a) => [a.slug, a]));
  return hit.prompt.assetSlugs
    .map((s) => bySlug.get(s))
    .filter((a): a is AssetDoc => Boolean(a && a.locked && a.imageUrl));
}

/** Stage gating: shotlist opens with one locked asset; takes with one prompt; film with one clip. */
export function stageReady(doc: PipelineDoc): { shotlist: boolean; takes: boolean; film: boolean } {
  return {
    shotlist: doc.assets.some((a) => a.locked && a.imageUrl),
    takes: doc.scenes.some((s) => s.prompts.length > 0),
    film: doc.takes.some((t) => t.kind === 'video'),
  };
}

/** Takes for one prompt, newest first (ids are monotonic per doc). */
export function takesFor(doc: PipelineDoc, name: string): TakeDoc[] {
  return doc.takes.filter((t) => t.promptName === name).reverse();
}

/**
 * Renumber every prompt to its canonical name (scene order + letter) and remap takes to the
 * new names. Prompt names encode scene position, so any structural change (delete, move)
 * must renumber; takes follow their prompt through the rename. Pure.
 */
export function renumberScenes(doc: PipelineDoc): PipelineDoc {
  const rename = new Map<string, string>();
  const scenes = doc.scenes.map((scene, si) => ({
    ...scene,
    title: `Scene ${si + 1}`,
    prompts: scene.prompts.map((p, pi) => {
      const next = promptName(si, pi);
      rename.set(p.name, next);
      return { ...p, name: next };
    }),
  }));
  const takes = doc.takes
    .filter((t) => rename.has(t.promptName)) // takes of deleted prompts are dropped
    .map((t) => ({ ...t, promptName: rename.get(t.promptName)! }));
  return { ...doc, scenes, takes };
}

/** Delete a scene: its prompts (and their takes) go with it; the rest renumber. Pure. */
export function deleteScene(doc: PipelineDoc, sceneIdx: number): PipelineDoc {
  if (sceneIdx < 0 || sceneIdx >= doc.scenes.length) return doc;
  return renumberScenes({ ...doc, scenes: doc.scenes.filter((_, i) => i !== sceneIdx) });
}

/** Delete a single cut by name; a scene emptied of cuts is removed; renumber, takes follow. Pure. */
export function deletePrompt(doc: PipelineDoc, name: string): PipelineDoc {
  const scenes = doc.scenes
    .map((s) => ({ ...s, prompts: s.prompts.filter((p) => p.name !== name) }))
    .filter((s) => s.prompts.length > 0);
  if (scenes.length === doc.scenes.length && scenes.every((s, i) => s.prompts.length === doc.scenes[i]!.prompts.length)) return doc;
  return renumberScenes({ ...doc, scenes });
}

/** Move a scene up (-1) or down (+1); prompts renumber and takes follow. Pure. */
export function moveScene(doc: PipelineDoc, sceneIdx: number, dir: -1 | 1): PipelineDoc {
  const j = sceneIdx + dir;
  if (sceneIdx < 0 || sceneIdx >= doc.scenes.length || j < 0 || j >= doc.scenes.length) return doc;
  const scenes = [...doc.scenes];
  [scenes[sceneIdx], scenes[j]] = [scenes[j]!, scenes[sceneIdx]!];
  return renumberScenes({ ...doc, scenes });
}

/**
 * The film cut, in scene order: for each prompt, its keeper video take (else the newest
 * video take). Prompts with no video takes contribute nothing. Pure.
 */
export function keeperClips(doc: PipelineDoc): Array<{ promptName: string; url: string }> {
  const out: Array<{ promptName: string; url: string }> = [];
  for (const scene of doc.scenes) {
    for (const p of scene.prompts) {
      const vids = doc.takes.filter((t) => t.promptName === p.name && t.kind === 'video');
      if (vids.length === 0) continue;
      const pick = vids.find((t) => t.keeper) ?? vids[vids.length - 1]!;
      out.push({ promptName: p.name, url: pick.url });
    }
  }
  // manual film order wins where present: listed names first (that have clips), rest follow scene order
  if (doc.filmOrder?.length) {
    const byName = new Map(out.map((c) => [c.promptName, c]));
    const ordered: typeof out = [];
    for (const n of doc.filmOrder) {
      const hit = byName.get(n);
      if (hit) { ordered.push(hit); byName.delete(n); }
    }
    for (const c of out) if (byName.has(c.promptName)) ordered.push(c);
    return ordered;
  }
  return out;
}

/** Voice takes in scene order, mixed over the cut at export. Pure. */
export function voiceTracks(doc: PipelineDoc): string[] {
  const out: string[] = [];
  for (const scene of doc.scenes) {
    for (const p of scene.prompts) {
      for (const t of doc.takes) if (t.promptName === p.name && t.kind === 'audio') out.push(t.url);
    }
  }
  return out;
}

/** Slugify a display name into a registry slug: 'Mr Bean SOY' -> 'mr_bean_soy'. */
export function toSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'asset';
}
