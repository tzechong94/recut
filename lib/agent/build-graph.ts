// Deterministically compile a StoryPlan into a canvas graph spec. Pure + testable. The Showrun
// UI applies this (all at once in autonomous mode, or one proposal at a time in step mode).

import type { StoryPlan } from './planner';
import type { RecutNodeKind, CanonKind } from '../canvas/store';

export interface PlanNode {
  key: string;
  kind: RecutNodeKind;
  prompt: string;
  name?: string;
  entityKind?: CanonKind;
  styleAnchor?: boolean; // the Style plate — its image anchors the look of every other shot
  x: number;
  y: number;
  inputs: string[]; // upstream keys
  note: string; // human label for the step-approval UI
}

export interface PlanGraph {
  title: string;
  nodes: PlanNode[];
  edges: { from: string; to: string }[];
}

export function buildGraphFromPlan(plan: StoryPlan): PlanGraph {
  const nodes: PlanNode[] = [];
  const edges: { from: string; to: string }[] = [];
  // one style spine appended to every image prompt → consistent look across the whole film
  const styleSuffix = plan.style ? `. ${plan.style}` : '';

  // Style plate FIRST: a representative frame that fixes the film's look. Flagged as the Style
  // Anchor, so the store injects its image as a style reference into every character and shot.
  const hasStyle = Boolean(plan.style);
  if (hasStyle) {
    nodes.push({
      key: 'style',
      kind: 'text2image',
      prompt: `${plan.style}. A single representative frame that establishes the film's visual style: composition, colour palette, lighting, and rendering technique.`,
      name: 'Style plate',
      styleAnchor: true,
      x: 40,
      y: 40,
      inputs: [],
      note: 'Generate the style plate — anchors every shot to one look',
    });
  }

  // cast column: each character generated from its description (inherits the style plate's look)
  const charKey = new Map<string, string>();
  const castY0 = hasStyle ? 320 : 80;
  plan.characters.forEach((c, i) => {
    const key = `c${i}`;
    charKey.set(c.name, key);
    nodes.push({ key, kind: 'text2image', prompt: `${c.description}. Full-body character portrait, plain background${styleSuffix}`, name: c.name, x: 40, y: castY0 + i * 240, inputs: [], note: `Cast ${c.name}` });
  });

  plan.shots.forEach((shot, j) => {
    const y = 60 + j * 280;
    const featured = shot.characters.map((n) => charKey.get(n)).filter((k): k is string => Boolean(k));
    const shotKey = `s${j}`;
    let kind: RecutNodeKind;
    if (featured.length >= 2) kind = 'compose';
    else if (featured.length === 1) kind = 'edit';
    else kind = 'text2image';
    nodes.push({ key: shotKey, kind, prompt: `${shot.description}${styleSuffix}`, x: 420, y, inputs: featured, note: `Shot ${j + 1}: ${shot.description.slice(0, 40)}` });
    for (const f of featured) edges.push({ from: f, to: shotKey });

    if (shot.animate) {
      const vKey = `v${j}`;
      nodes.push({ key: vKey, kind: 'video', prompt: 'subtle natural motion, gentle camera move, cinematic', x: 800, y, inputs: [shotKey], note: `Animate shot ${j + 1}` });
      edges.push({ from: shotKey, to: vKey });
    }
    if (shot.dialogue) {
      nodes.push({ key: `d${j}`, kind: 'dialogue', prompt: shot.dialogue, x: 800, y: y + 150, inputs: [], note: `Dialogue: “${shot.dialogue.slice(0, 30)}”` });
    }
  });

  return { title: plan.title, nodes, edges };
}
