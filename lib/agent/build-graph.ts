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

  // cast column: each character is a locked Canon entity generated from its description
  const charKey = new Map<string, string>();
  plan.characters.forEach((c, i) => {
    const key = `c${i}`;
    charKey.set(c.name, key);
    nodes.push({ key, kind: 'text2image', prompt: `${c.description}. Character portrait, consistent, photorealistic.`, name: c.name, x: 40, y: 80 + i * 240, inputs: [], note: `Cast ${c.name}` });
  });

  plan.shots.forEach((shot, j) => {
    const y = 60 + j * 280;
    const featured = shot.characters.map((n) => charKey.get(n)).filter((k): k is string => Boolean(k));
    const shotKey = `s${j}`;
    let kind: RecutNodeKind;
    if (featured.length >= 2) kind = 'compose';
    else if (featured.length === 1) kind = 'edit';
    else kind = 'text2image';
    nodes.push({ key: shotKey, kind, prompt: shot.description, x: 420, y, inputs: featured, note: `Shot ${j + 1}: ${shot.description.slice(0, 40)}` });
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
