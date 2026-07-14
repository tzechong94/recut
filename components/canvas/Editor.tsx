'use client';

import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import { useCanvas, type RecutNode as RecutNodeType } from '../../lib/canvas/store';
import type { Edge } from '@xyflow/react';
import { loadGraph, saveGraph } from '../../lib/projects';
import { RecutNode } from './RecutNode';
import { NodeInspector } from './NodeInspector';
import { ShowrunBar } from './ShowrunBar';
import { TimelinePanel } from './TimelinePanel';
import { AddNodeMenu } from './AddNodeMenu';

const nodeTypes = { recut: RecutNode };

export function Editor({ projectId, title }: { projectId: string; title: string }) {
  const {
    nodes, edges, onNodesChange, onEdgesChange, onConnect, addNode, load, reset, spentUsd, lastError,
    selectedId, select, deleteNode, duplicateNode, undo, redo, past, future,
    runAll, runningAll, pausedReason, capUsd,
  } = useCanvas();
  // Tracks WHICH project we've finished loading. Autosave only runs once this matches the
  // current projectId — so the empty initial canvas can never be saved over a real graph.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    loadedFor.current = null;
    reset();
    loadGraph(projectId).then((g) => {
      if (g && g.nodes.length) load(g.nodes as RecutNodeType[], g.edges as Edge[]);
      loadedFor.current = projectId;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (loadedFor.current !== projectId) return; // haven't loaded THIS project yet
    if (nodes.length === 0) return; // never autosave an empty graph over a saved project
    const t = setTimeout(() => void saveGraph(projectId, nodes, edges), 800);
    return () => clearTimeout(t);
  }, [nodes, edges, projectId]);

  // keyboard: delete / duplicate / undo / redo
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (meta && e.key.toLowerCase() === 'd' && selectedId) {
        e.preventDefault();
        duplicateNode(selectedId);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedId) {
        e.preventDefault();
        deleteNode(selectedId);
      }
    },
    [selectedId, undo, redo, duplicateNode, deleteNode],
  );
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  return (
    <div className="relative flex h-screen flex-col">
      <header className="z-10 flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-950 px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold text-neutral-100">Recut</Link>
          <span className="text-xs text-neutral-500">/ {title}</span>
        </div>
        <div className="flex items-center gap-2">
          <AddNodeMenu />
          <span className="h-4 w-px bg-neutral-800" />
          <button onClick={undo} disabled={past.length === 0} title="Undo (⌘Z)" className="rounded-md border border-neutral-700 px-2 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-40">↶</button>
          <button onClick={redo} disabled={future.length === 0} title="Redo (⌘⇧Z)" className="rounded-md border border-neutral-700 px-2 py-1.5 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-40">↷</button>
          <span className="h-4 w-px bg-neutral-800" />
          {(() => {
            const hasWork = nodes.some((n) => n.data.kind !== 'upload' && n.data.kind !== 'canon' && (n.data.status !== 'done' || n.data.stale));
            return (
              <button
                onClick={runAll}
                disabled={runningAll || !hasWork}
                data-testid="run-all"
                title={hasWork ? 'Generate every node that still needs it, in order' : 'Everything is already generated'}
                className="rounded-md bg-emerald-500 px-2.5 py-1.5 text-[11px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
              >
                {runningAll ? 'Generating…' : hasWork ? '▶ Generate all' : '✓ All generated'}
              </button>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 text-xs tabular-nums text-neutral-500" data-testid="spend">
          <span>${spentUsd.toFixed(3)}{capUsd !== null ? ` / $${capUsd.toFixed(0)}` : ''}</span>
          {capUsd !== null && (
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-800">
              <div className={`h-full ${spentUsd > 0.8 * capUsd ? 'bg-rose-400' : 'bg-emerald-400'}`} style={{ width: `${Math.min(100, (spentUsd / capUsd) * 100)}%` }} />
            </div>
          )}
        </div>
      </header>

      <ShowrunBar />

      {lastError && <div className="border-b border-rose-900 bg-rose-950/60 px-4 py-1.5 text-xs text-rose-300">{lastError}</div>}
      {pausedReason && <div className="border-b border-amber-900 bg-amber-950/50 px-4 py-1.5 text-xs text-amber-300" data-testid="paused">⏸ {pausedReason}</div>}

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-center" data-testid="empty-hint">
              <p className="text-sm font-medium text-neutral-400">Blank canvas</p>
              <p className="max-w-sm text-xs text-neutral-600">
                Type a premise up top and hit <span className="text-sky-400">Showrun</span> — the agent builds the shots for you.
                Or click <span className="text-sky-400">＋ Add node</span> to build it by hand.
              </p>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => select(node.id)}
            onPaneClick={() => select(null)}
            nodeTypes={nodeTypes}
            fitView
            nodeDragThreshold={5}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
            defaultEdgeOptions={{ animated: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable className="!bg-neutral-900" />
          </ReactFlow>
        </div>
        {selectedId && (
          <div className="absolute top-0 right-0 bottom-0 z-20 shadow-2xl">
            <NodeInspector nodeId={selectedId} onDelete={() => deleteNode(selectedId)} onDuplicate={() => duplicateNode(selectedId)} />
          </div>
        )}
      </div>
      <TimelinePanel />
    </div>
  );
}
