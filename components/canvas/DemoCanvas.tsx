'use client';

import '@xyflow/react/dist/style.css';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ReactFlow, ReactFlowProvider, useReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import { RecutNode } from './RecutNode';
import type { RecutNodeData } from '../../lib/canvas/store';
import { DEMO_STEPS } from '../../lib/demo/graph';

const nodeTypes = { recut: RecutNode };

function Inner({ allNodes, allEdges }: { allNodes: Node<RecutNodeData>[]; allEdges: Edge[] }) {
  const rf = useReactFlow();
  const maxStep = Math.max(...allNodes.map((n) => n.data.step ?? 0));
  const [step, setStep] = useState(0);
  const [selectedId, setSelectedId] = useState<string>(allNodes[0]?.id ?? '');

  const { nodes, edges } = useMemo(() => {
    const visible = allNodes.filter((n) => (n.data.step ?? 0) <= step);
    const ids = new Set(visible.map((n) => n.id));
    return {
      nodes: visible.map((n) => ({ ...n, selected: n.id === selectedId, draggable: false })),
      edges: allEdges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    };
  }, [allNodes, allEdges, step, selectedId]);

  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ duration: 400, padding: 0.25 }), 50);
    return () => clearTimeout(t);
  }, [step, rf]);

  const selected = allNodes.find((n) => n.id === selectedId);
  const detail = selected?.data.detail;

  const next = () => {
    if (step >= maxStep) return;
    const ns = step + 1;
    setStep(ns);
    const revealed = allNodes.find((n) => (n.data.step ?? 0) === ns);
    if (revealed) setSelectedId(revealed.id);
  };
  const prev = () => setStep((s) => Math.max(0, s - 1));

  return (
    <main className="flex h-screen flex-col">
      <header className="z-10 flex items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-950 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold text-neutral-100">Recut</Link>
          <span className="text-xs text-neutral-500">/ The Letter · guided demo</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-neutral-500" data-testid="demo-step">step {step + 1}/{maxStep + 1}</span>
          <span className="hidden max-w-md truncate text-xs text-neutral-400 md:block">{DEMO_STEPS[step]}</span>
          <button onClick={prev} disabled={step === 0} className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800 disabled:opacity-40">Prev</button>
          <button onClick={next} disabled={step >= maxStep} data-testid="demo-next" className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-sky-400 disabled:opacity-40">
            {step >= maxStep ? 'Done' : 'Next →'}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            nodesDraggable={false}
            fitView
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Inspector */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-5" data-testid="demo-inspector">
          <h2 className="text-xs font-semibold tracking-widest text-neutral-500 uppercase">{selected?.data.title ?? 'Inspector'}</h2>
          {detail ? (
            <div className="mt-3 space-y-4">
              <p className="text-sm leading-relaxed text-neutral-300">{detail.caption}</p>

              {selected?.data.prompt ? (
                <div>
                  <div className="mb-1 text-[10px] font-medium tracking-wide text-neutral-500 uppercase">Prompt</div>
                  <p className="rounded-md border border-neutral-800 bg-neutral-900 p-2.5 font-mono text-[11px] leading-relaxed text-neutral-300" data-testid="inspect-prompt">
                    {selected.data.prompt}
                  </p>
                </div>
              ) : null}

              <dl className="space-y-1.5">
                {detail.rows.map((r) => (
                  <div key={r.k} className="flex items-baseline justify-between gap-3 text-sm">
                    <dt className="shrink-0 text-neutral-500">{r.k}</dt>
                    <dd className="text-right text-neutral-200">{r.v}</dd>
                  </div>
                ))}
              </dl>

              {detail.axes ? (
                <div>
                  <div className="mb-2 text-[10px] font-medium tracking-wide text-neutral-500 uppercase">Continuity axes</div>
                  <div className="space-y-1.5">
                    {detail.axes.map((a) => (
                      <div key={a.label} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[11px] text-neutral-400">{a.label}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
                          <div className={`h-full ${a.score >= 0.7 ? 'bg-emerald-400' : a.score >= 0.5 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${a.score * 100}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-neutral-300">{a.score.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-neutral-600">Click a node to inspect its prompt, model, and scores.</p>
          )}
        </aside>
      </div>
    </main>
  );
}

export function DemoCanvas({ nodes, edges }: { nodes: Node<RecutNodeData>[]; edges: Edge[] }) {
  return (
    <ReactFlowProvider>
      <Inner allNodes={nodes} allEdges={edges} />
    </ReactFlowProvider>
  );
}
