'use client';

import '@xyflow/react/dist/style.css';
import { useEffect } from 'react';
import Link from 'next/link';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import { useCanvas, type RecutNodeKind } from '../../lib/canvas/store';
import { RecutNode } from './RecutNode';

const nodeTypes = { recut: RecutNode };

const TOOLS: Array<{ kind: RecutNodeKind; label: string }> = [
  { kind: 'text2image', label: '＋ Text→Image' },
  { kind: 'upload', label: '＋ Upload' },
  { kind: 'edit', label: '＋ Edit' },
  { kind: 'video', label: '＋ Video' },
  { kind: 'critique', label: '＋ Continuity' },
];

export function Editor({ projectId, title }: { projectId: string; title: string }) {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, load, reset, spentUsd, lastError } = useCanvas();
  const key = `recut:project:${projectId}`;

  // load once on mount
  useEffect(() => {
    reset();
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const g = JSON.parse(raw) as { nodes: never[]; edges: never[] };
        if (g.nodes?.length) load(g.nodes, g.edges ?? []);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // persist on change
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify({ nodes, edges }));
    } catch {
      /* ignore */
    }
  }, [nodes, edges, key]);

  const add = (kind: RecutNodeKind) => addNode(kind, { x: 140 + (nodes.length % 6) * 36, y: 120 + (nodes.length % 6) * 36 });

  return (
    <div className="flex h-screen flex-col">
      <header className="z-10 flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-950 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold text-neutral-100">Recut</Link>
          <span className="text-xs text-neutral-500">/ {title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {TOOLS.map((t) => (
            <button
              key={t.kind}
              onClick={() => add(t.kind)}
              data-testid={`add-${t.kind}`}
              className="rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs font-medium text-neutral-300 hover:border-neutral-500 hover:bg-neutral-800"
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="text-xs tabular-nums text-neutral-500" data-testid="spend">
          spend ${spentUsd.toFixed(3)}
        </div>
      </header>

      {lastError && (
        <div className="border-b border-rose-900 bg-rose-950/60 px-4 py-1.5 text-xs text-rose-300">{lastError}</div>
      )}

      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          colorMode="dark"
          defaultEdgeOptions={{ animated: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable className="!bg-neutral-900" />
        </ReactFlow>
      </div>
    </div>
  );
}
