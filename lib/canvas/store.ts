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

export type RecutNodeKind = 'text2image' | 'upload' | 'edit' | 'video' | 'critique';

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
  score?: number;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  // demo mode: read-only node with pre-filled fixtures + an inspectable detail block
  demo?: boolean;
  step?: number;
  detail?: DemoDetail;
  [key: string]: unknown;
}

export type RecutNode = Node<RecutNodeData>;

/** Node kind → the gateway capability it represents, for typed-port validation. */
export const KIND_CAPABILITY: Record<RecutNodeKind, Capability> = {
  text2image: 'image.generate',
  upload: 'image.generate',
  edit: 'image.edit',
  video: 'video.i2v',
  critique: 'vision.critique',
};

const KIND_TITLE: Record<RecutNodeKind, string> = {
  text2image: 'Text → Image',
  upload: 'Upload',
  edit: 'Edit',
  video: 'Image → Video',
  critique: 'Continuity',
};

export interface CanvasState {
  nodes: RecutNode[];
  edges: Edge[];
  nextId: number;
  spentUsd: number;
  lastError: string | null;

  onNodesChange: (c: NodeChange[]) => void;
  onEdgesChange: (c: EdgeChange[]) => void;
  onConnect: (c: Connection) => void;
  addNode: (kind: RecutNodeKind, position: { x: number; y: number }) => void;
  updateNode: (id: string, patch: Partial<RecutNodeData>) => void;
  runNode: (id: string) => Promise<void>;
  load: (nodes: RecutNode[], edges: Edge[]) => void;
  reset: () => void;
}

export const useCanvas = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  nextId: 1,
  spentUsd: 0,
  lastError: null,

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) as RecutNode[] }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),

  onConnect: (conn) => {
    const nodes = get().nodes;
    const from = nodes.find((n) => n.id === conn.source);
    const to = nodes.find((n) => n.id === conn.target);
    if (!from || !to) return;
    const check = canConnect(KIND_CAPABILITY[from.data.kind], KIND_CAPABILITY[to.data.kind]);
    if (!check.ok) {
      set({ lastError: check.reason ?? 'invalid connection' });
      return;
    }
    set({ edges: addEdge({ ...conn, animated: true }, get().edges), lastError: null });
  },

  addNode: (kind, position) => {
    const id = `n${get().nextId}`;
    const node: RecutNode = {
      id,
      type: 'recut',
      position,
      data: { kind, title: KIND_TITLE[kind], prompt: '', status: 'idle' },
    };
    set({ nodes: [...get().nodes, node], nextId: get().nextId + 1 });
  },

  updateNode: (id, patch) =>
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)) }),

  runNode: async (id) => {
    const { nodes, edges, updateNode } = get();
    const node = nodes.find((n) => n.id === id);
    if (!node) return;

    // resolve the input image from the connected upstream node's output
    const inEdge = edges.find((e) => e.target === id);
    const upstream = inEdge ? nodes.find((n) => n.id === inEdge.source) : undefined;
    const inputImage = upstream?.data.imageUrl;

    if ((node.data.kind === 'edit' || node.data.kind === 'video' || node.data.kind === 'critique') && !inputImage) {
      updateNode(id, { status: 'error', error: 'connect an image node to this input first' });
      return;
    }

    updateNode(id, { status: 'running', error: undefined });
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: node.data.kind, prompt: node.data.prompt, image: inputImage }),
      });
      const j = (await res.json()) as { imageUrl?: string; videoUrl?: string; score?: number; error?: string; spentUsd?: number };
      if (!res.ok) {
        updateNode(id, { status: 'error', error: j.error ?? `HTTP ${res.status}` });
        return;
      }
      updateNode(id, { status: 'done', imageUrl: j.imageUrl, videoUrl: j.videoUrl, score: j.score });
      if (typeof j.spentUsd === 'number') set({ spentUsd: j.spentUsd });
    } catch (e) {
      updateNode(id, { status: 'error', error: String(e).slice(0, 120) });
    }
  },

  load: (nodes, edges) => set({ nodes, edges, nextId: nodes.length + 1 }),
  reset: () => set({ nodes: [], edges: [], nextId: 1, lastError: null }),
}));
