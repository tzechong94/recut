import type { Node, Edge } from '@xyflow/react';
import type { RecutNodeData } from '../canvas/store';

// The curated demo as a node graph — "The Letter". All outputs come from committed fixtures
// (replay, zero cost). Nodes are revealed by `step` as the user clicks Next, and each carries an
// inspectable `detail` block (prompt, model, seed, continuity axes).

function n(
  id: string,
  step: number,
  position: { x: number; y: number },
  data: Partial<RecutNodeData> & Pick<RecutNodeData, 'kind' | 'title'>,
): Node<RecutNodeData> {
  return { id, type: 'recut', position, data: { prompt: '', status: 'done', demo: true, step, ...data } };
}

export function buildDemoGraph(keyframePrompt: string): { nodes: Node<RecutNodeData>[]; edges: Edge[] } {
  const nodes: Node<RecutNodeData>[] = [
    n('cast', 0, { x: 40, y: 220 }, {
      kind: 'upload',
      title: 'Cast · Mei',
      imageUrl: '/refs/mei.png',
      detail: {
        caption: 'Cast a character into the Series Bible. One locked reference — every shot inherits it, no copying.',
        rows: [
          { k: 'Name', v: 'Mei' },
          { k: 'Kind', v: 'character' },
          { k: 'Hair', v: 'black bob' },
          { k: 'Wardrobe', v: 'red wool scarf, charcoal jacket' },
          { k: 'Model', v: 'qwen-image-plus' },
        ],
      },
    }),
    n('keyframe', 1, { x: 360, y: 220 }, {
      kind: 'edit',
      title: 'Keyframe · Take',
      imageUrl: '/takes/1000.png',
      prompt: keyframePrompt,
      detail: {
        caption: 'Compile the shot from the rig + bible, render 4 candidates, accept one as the Take. The prompt is a typed object, not a string.',
        rows: [
          { k: 'Model', v: 'qwen-image-edit' },
          { k: 'Seed', v: '1000' },
          { k: 'Shot size', v: 'MS' },
          { k: 'Capability', v: 'image.edit' },
          { k: 'Candidates', v: '4 (1 accepted)' },
        ],
      },
    }),
    n('break', 2, { x: 680, y: 60 }, {
      kind: 'edit',
      title: 'Edit · wardrobe',
      imageUrl: '/takes/blue.png',
      prompt: 'Change ONLY the scarf colour from red to BLUE. Keep the same person, face, pose, jacket, and background identical.',
      detail: {
        caption: 'Edit the wardrobe — red scarf → blue. A deliberate continuity break to show the critic works.',
        rows: [
          { k: 'Model', v: 'qwen-image-edit' },
          { k: 'Change', v: 'scarf red → blue' },
        ],
      },
    }),
    n('continuity', 3, { x: 1000, y: 60 }, {
      kind: 'critique',
      title: 'Continuity',
      score: 0.67,
      detail: {
        caption: 'The critic scores the take against the locked reference. Wardrobe collapses to 0.30 — visibly off-model. Never fake-passes.',
        rows: [
          { k: 'Model', v: 'qwen3-vl-plus' },
          { k: 'Verdict', v: 'reject' },
          { k: 'Repair', v: 'the scarf is blue; it must be red. Preserve pose and lighting.' },
        ],
        axes: [
          { label: 'identity', score: 1.0 },
          { label: 'wardrobe', score: 0.3 },
          { label: 'framing', score: 0.9 },
          { label: 'location', score: 1.0 },
          { label: 'palette', score: 0.2 },
          { label: 'prop', score: 0.0 },
        ],
      },
    }),
    n('repair', 4, { x: 1320, y: 60 }, {
      kind: 'edit',
      title: 'Auto-repair',
      imageUrl: '/takes/repaired.png',
      prompt: 'Change ONLY the scarf colour from blue back to RED wool. Keep pose, face, jacket, and background identical.',
      detail: {
        caption: 'Auto-repair: append the critic’s instruction, re-render, re-critique. Continuity recovers above threshold.',
        rows: [
          { k: 'Model', v: 'qwen-image-edit' },
          { k: 'Continuity', v: '0.88 (recovered, +0.21)' },
          { k: 'Wardrobe', v: '1.00' },
        ],
      },
    }),
    n('video', 5, { x: 680, y: 360 }, {
      kind: 'video',
      title: 'Image → Video',
      videoUrl: '/clips/1000.mp4',
      prompt: 'Mei looks up, subtle breath and hair movement, gentle push-in',
      detail: {
        caption: 'Animate the approved keyframe — true image-to-video. Video is animation of an approved frame, never a cold call.',
        rows: [
          { k: 'Model', v: 'wan2.6-i2v' },
          { k: 'Duration', v: '3s' },
          { k: 'Capability', v: 'video.i2v' },
        ],
      },
    }),
  ];

  const edges: Edge[] = [
    { id: 'e1', source: 'cast', target: 'keyframe', animated: true },
    { id: 'e2', source: 'keyframe', target: 'break', animated: true },
    { id: 'e3', source: 'break', target: 'continuity', animated: true },
    { id: 'e4', source: 'continuity', target: 'repair', animated: true },
    { id: 'e5', source: 'keyframe', target: 'video', animated: true },
  ];

  return { nodes, edges };
}

export const DEMO_STEPS = [
  'Cast Mei into the Series Bible',
  'Compile the shot → 4 candidates → accept a Take',
  'Break continuity: recolour the scarf blue',
  'Run the continuity critic — wardrobe 0.30, off-model',
  'Auto-repair — continuity recovers to 0.88',
  'Animate the approved keyframe (true i2v)',
];
