import { create } from 'zustand';
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import type { Capability } from '../gateway/types';
import { canConnect } from './node';

export type RecutNodeKind = 'text2image' | 'upload' | 'edit' | 'compose' | 'inpaint' | 'video' | 'critique' | 'dialogue' | 'canon';

export type CanonKind = 'character' | 'location' | 'prop' | 'style';

export interface DemoDetail {
  caption: string;
  rows: Array<{ k: string; v: string }>;
  axes?: Array<{ label: string; score: number }>;
}

export interface RecutNodeData {
  kind: RecutNodeKind;
  title: string;
  prompt: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  score?: number;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  // per-node params (editable in the inspector)
  seed?: number;
  negative?: string;
  aspect?: '1:1' | '9:16' | '16:9';
  voice?: string;
  // canon entity (locked reference) fields
  entityKind?: CanonKind;
  name?: string;
  locked?: boolean;
  // stale = an upstream input changed after this node last ran
  stale?: boolean;
  // demo mode: read-only node with pre-filled fixtures + an inspectable detail block
  demo?: boolean;
  step?: number;
  detail?: DemoDetail;
  [key: string]: unknown;
}

export type RecutNode = Node<RecutNodeData>;

export const KIND_CAPABILITY: Record<RecutNodeKind, Capability> = {
  text2image: 'image.generate',
  upload: 'image.generate',
  edit: 'image.edit',
  compose: 'image.edit',
  inpaint: 'image.edit',
  video: 'video.i2v',
  critique: 'vision.critique',
  dialogue: 'audio.tts',
  canon: 'image.generate',
};

const KIND_TITLE: Record<RecutNodeKind, string> = {
  text2image: 'Text → Image',
  upload: 'Upload',
  edit: 'Edit',
  compose: 'Compose',
  inpaint: 'Inpaint',
  video: 'Image → Video',
  critique: 'Continuity',
  dialogue: 'Dialogue → Voice',
  canon: 'Canon',
};

/** kinds that take an incoming connection (consume an upstream output) */
export const CONSUMES: RecutNodeKind[] = ['edit', 'compose', 'inpaint', 'video', 'critique'];
/** kinds that emit an image (can be an upstream source) */
export const PRODUCES_IMAGE: RecutNodeKind[] = ['text2image', 'upload', 'edit', 'compose', 'inpaint', 'canon'];

interface Snapshot {
  nodes: RecutNode[];
  edges: Edge[];
}

export interface CanvasState {
  nodes: RecutNode[];
  edges: Edge[];
  nextId: number;
  spentUsd: number;
  lastError: string | null;
  selectedId: string | null;
  past: Snapshot[];
  future: Snapshot[];

  onNodesChange: (c: NodeChange[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;
  select: (id: string | null) => void;
  addNode: (kind: RecutNodeKind, position: { x: number; y: number }) => void;
  /** add a fully-configured node (used by the showrunner agent); returns its id */
  addConfiguredNode: (kind: RecutNodeKind, position: { x: number; y: number }, data: Partial<RecutNodeData>) => string;
  connectIds: (source: string, target: string) => void;
  updateNode: (id: string, patch: Partial<RecutNodeData>) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  runNode: (id: string) => Promise<void>;
  setCanonRef: (id: string, dataUri: string) => void;
  undo: () => void;
  redo: () => void;
  load: (nodes: RecutNode[], edges: Edge[]) => void;
  reset: () => void;
}

function snapshot(s: CanvasState): Snapshot {
  return { nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data } })), edges: s.edges.map((e) => ({ ...e })) };
}

/** All nodes reachable downstream from `id` (following edges source→target). */
function descendants(id: string, edges: Edge[]): Set<string> {
  const out = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.source === cur && !out.has(e.target)) {
        out.add(e.target);
        queue.push(e.target);
      }
    }
  }
  return out;
}

/** The nearest upstream canon node's locked reference image, if any. */
function nearestCanonRef(id: string, nodes: RecutNode[], edges: Edge[]): string | undefined {
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const e of edges) {
      if (e.target === cur && !seen.has(e.source)) {
        seen.add(e.source);
        const src = nodes.find((n) => n.id === e.source);
        if (src?.data.kind === 'canon' && src.data.imageUrl) return src.data.imageUrl;
        queue.push(e.source);
      }
    }
  }
  return undefined;
}

export const useCanvas = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  nextId: 1,
  spentUsd: 0,
  lastError: null,
  selectedId: null,
  past: [],
  future: [],

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) as RecutNode[] }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  select: (id) => set({ selectedId: id }),

  onConnect: (conn) => {
    const s = get();
    const from = s.nodes.find((n) => n.id === conn.source);
    const to = s.nodes.find((n) => n.id === conn.target);
    if (!from || !to) return;
    const check = canConnect(KIND_CAPABILITY[from.data.kind], KIND_CAPABILITY[to.data.kind]);
    if (!check.ok) {
      set({ lastError: check.reason ?? 'invalid connection' });
      return;
    }
    set({ past: [...s.past, snapshot(s)], future: [], edges: addEdge({ ...conn, animated: true }, s.edges), lastError: null });
  },

  addNode: (kind, position) => {
    const s = get();
    const id = `n${s.nextId}`;
    const extra: Partial<RecutNodeData> = kind === 'canon' ? { entityKind: 'character', name: 'New entity', locked: true } : {};
    const node: RecutNode = { id, type: 'recut', position, data: { kind, title: KIND_TITLE[kind], prompt: '', status: 'idle', ...extra } };
    set({ past: [...s.past, snapshot(s)], future: [], nodes: [...s.nodes, node], nextId: s.nextId + 1, selectedId: id });
  },

  addConfiguredNode: (kind, position, data) => {
    const s = get();
    const id = `n${s.nextId}`;
    const node: RecutNode = { id, type: 'recut', position, data: { kind, title: KIND_TITLE[kind], prompt: '', status: 'idle', ...data } };
    set({ past: [...s.past, snapshot(s)], future: [], nodes: [...s.nodes, node], nextId: s.nextId + 1 });
    return id;
  },

  connectIds: (source, target) => {
    const s = get();
    const from = s.nodes.find((n) => n.id === source);
    const to = s.nodes.find((n) => n.id === target);
    if (!from || !to) return;
    if (!canConnect(KIND_CAPABILITY[from.data.kind], KIND_CAPABILITY[to.data.kind]).ok) return;
    set({ edges: addEdge({ source, target, animated: true, id: `e-${source}-${target}` }, s.edges) });
  },

  updateNode: (id, patch) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) }),

  deleteNode: (id) => {
    const s = get();
    set({
      past: [...s.past, snapshot(s)],
      future: [],
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    });
  },

  duplicateNode: (id) => {
    const s = get();
    const src = s.nodes.find((n) => n.id === id);
    if (!src) return;
    const nid = `n${s.nextId}`;
    const copy: RecutNode = { ...src, id: nid, position: { x: src.position.x + 40, y: src.position.y + 40 }, data: { ...src.data } };
    set({ past: [...s.past, snapshot(s)], future: [], nodes: [...s.nodes, copy], nextId: s.nextId + 1, selectedId: nid });
  },

  runNode: async (id) => {
    const { nodes, edges, updateNode } = get();
    const node = nodes.find((n) => n.id === id);
    if (!node) return;

    // resolve ALL connected upstream image outputs (compose consumes several)
    const inEdges = edges.filter((e) => e.target === id);
    const images = inEdges
      .map((e) => nodes.find((n) => n.id === e.source)?.data.imageUrl)
      .filter((u): u is string => typeof u === 'string');
    const needsInput: RecutNodeKind[] = ['edit', 'compose', 'inpaint', 'video', 'critique'];
    if (needsInput.includes(node.data.kind) && images.length === 0) {
      updateNode(id, { status: 'error', error: 'connect an image node to this input first' });
      return;
    }

    // continuity scores against the nearest upstream canon reference, if wired
    const canonRef = node.data.kind === 'critique' ? nearestCanonRef(id, nodes, edges) : undefined;

    updateNode(id, { status: 'running', error: undefined });
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: node.data.kind,
          prompt: node.data.prompt,
          image: images[0],
          images,
          refs: canonRef ? [canonRef] : undefined,
          seed: node.data.seed,
          negative: node.data.negative,
          aspect: node.data.aspect,
          voice: node.data.voice,
        }),
      });
      const j = (await res.json()) as { imageUrl?: string; videoUrl?: string; audioUrl?: string; score?: number; error?: string; spentUsd?: number };
      if (!res.ok) {
        updateNode(id, { status: 'error', error: j.error ?? `HTTP ${res.status}` });
        return;
      }
      updateNode(id, { status: 'done', stale: false, imageUrl: j.imageUrl, videoUrl: j.videoUrl, audioUrl: j.audioUrl, score: j.score });
      // an upstream output changed → everything downstream is now stale until re-run
      const stale = descendants(id, get().edges);
      if (stale.size) set({ nodes: get().nodes.map((n) => (stale.has(n.id) ? { ...n, data: { ...n.data, stale: true } } : n)) });
      if (typeof j.spentUsd === 'number') set({ spentUsd: j.spentUsd });
    } catch (e) {
      updateNode(id, { status: 'error', error: String(e).slice(0, 120) });
    }
  },

  setCanonRef: (id, dataUri) => {
    const s = get();
    const stale = descendants(id, s.edges);
    set({
      nodes: s.nodes.map((n) => {
        if (n.id === id) return { ...n, data: { ...n.data, imageUrl: dataUri, status: 'done', stale: false } };
        if (stale.has(n.id)) return { ...n, data: { ...n.data, stale: true } };
        return n;
      }),
    });
  },

  undo: () => {
    const s = get();
    if (s.past.length === 0) return;
    const prev = s.past[s.past.length - 1]!;
    set({ past: s.past.slice(0, -1), future: [snapshot(s), ...s.future], nodes: prev.nodes, edges: prev.edges });
  },
  redo: () => {
    const s = get();
    if (s.future.length === 0) return;
    const next = s.future[0]!;
    set({ future: s.future.slice(1), past: [...s.past, snapshot(s)], nodes: next.nodes, edges: next.edges });
  },

  load: (nodes, edges) => set({ nodes, edges, nextId: nodes.length + 1, past: [], future: [], selectedId: null }),
  reset: () => set({ nodes: [], edges: [], nextId: 1, lastError: null, past: [], future: [], selectedId: null }),
}));
