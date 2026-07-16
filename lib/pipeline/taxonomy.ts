// Failure-taxonomy classifier (PIPELINE-SPEC.md, Stage 3). Maps a judge verdict onto the
// spec's symptom > root-cause-layer > fix table so a failing take tells the user WHERE to
// fix, not just that it failed. PURE: verdict in, diagnoses out.

export type FailureLayer = 'asset' | 'global-style' | 'scene-style' | 'prompt' | 'routing';

export interface Diagnosis {
  axis: string;
  score: number;
  symptom: string;
  layer: FailureLayer;
  fix: string;
  /** a one-click executable fix exists (append the judge's repair instruction to the prompt, re-run) */
  autoFixable: boolean;
}

const AXIS_THRESHOLD = 0.7;

interface AxisRule {
  axis: string;
  symptom: string;
  layer: FailureLayer;
  fix: string;
  autoFixable: boolean;
}

// One row per verdict axis, straight from the spec's table.
const RULES: AxisRule[] = [
  {
    axis: 'identity_match',
    symptom: 'Face/identity drifts from the locked reference',
    layer: 'asset',
    fix: 'Fix at the asset layer: erase extra faces from the sheet or re-lock a stronger one. Never fix identity with prompt words.',
    autoFixable: false,
  },
  {
    axis: 'wardrobe_match',
    symptom: 'Character state/wardrobe is wrong for this beat',
    layer: 'routing',
    fix: 'Build a second state sheet (e.g. hero_wet) and route it explicitly in this prompt instead of describing the change.',
    autoFixable: true,
  },
  {
    axis: 'prop_match',
    symptom: 'The product/prop looks different from its reference',
    layer: 'prompt',
    fix: 'Add an explicit lock line naming the exact reference details, or give the prop its own attached sheet.',
    autoFixable: true,
  },
  {
    axis: 'location_match',
    symptom: 'The location does not match its locked reference',
    layer: 'asset',
    fix: 'Attach the locked location sheet to this prompt; if it keeps breaking spatially, build a layout map from it.',
    autoFixable: true,
  },
  {
    axis: 'palette_match',
    symptom: 'Colour/mood is off in this take',
    layer: 'scene-style',
    fix: 'Scoped fix: set this scene’s style override. If EVERY scene is off, edit the global Style Prefix once instead.',
    autoFixable: true,
  },
  {
    axis: 'framing_match',
    symptom: 'Framing/camera is wrong (dead, rushed, or miscomposed)',
    layer: 'prompt',
    fix: 'Edit this prompt only: motivated camera from frame one, one action per prompt, choreograph move by move.',
    autoFixable: true,
  },
];

/** Classify a judge verdict into per-axis diagnoses (only failing axes, worst first). */
export function classifyVerdict(verdict: Record<string, unknown> | undefined): Diagnosis[] {
  if (!verdict) return [];
  const out: Diagnosis[] = [];
  for (const rule of RULES) {
    const raw = Number(verdict[rule.axis]);
    if (!Number.isFinite(raw) || raw >= AXIS_THRESHOLD) continue;
    out.push({ axis: rule.axis, score: raw, symptom: rule.symptom, layer: rule.layer, fix: rule.fix, autoFixable: rule.autoFixable });
  }
  return out.sort((a, b) => a.score - b.score);
}

/** The layer to name in the one-line summary: the worst failing axis wins. */
export function primaryLayer(diagnoses: Diagnosis[]): FailureLayer | null {
  return diagnoses[0]?.layer ?? null;
}
