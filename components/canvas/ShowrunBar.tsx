'use client';

import { useRef, useState } from 'react';
import { useCanvas } from '../../lib/canvas/store';
import type { PlanGraph } from '../../lib/agent/build-graph';

type Phase = 'idle' | 'planning' | 'stepping' | 'error';

export function ShowrunBar() {
  const addConfiguredNode = useCanvas((s) => s.addConfiguredNode);
  const connectIds = useCanvas((s) => s.connectIds);

  const [premise, setPremise] = useState('');
  const [autonomous, setAutonomous] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<PlanGraph | null>(null);
  const [index, setIndex] = useState(0);
  const [draftPrompt, setDraftPrompt] = useState('');
  const keyToId = useRef<Record<string, string>>({});

  function applyNode(key: string, prompt: string): void {
    const g = graph!;
    const pn = g.nodes.find((n) => n.key === key)!;
    const id = addConfiguredNode(pn.kind, { x: pn.x, y: pn.y }, { prompt, name: pn.name, entityKind: pn.entityKind, status: 'idle' });
    keyToId.current[key] = id;
    for (const e of g.edges) if (e.to === key && keyToId.current[e.from]) connectIds(keyToId.current[e.from]!, id);
  }

  async function showrun() {
    if (!premise.trim()) return;
    setPhase('planning');
    setError(null);
    keyToId.current = {};
    try {
      const res = await fetch('/api/agent/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ premise }) });
      const j = (await res.json()) as { graph?: PlanGraph; error?: string };
      if (!res.ok || !j.graph) {
        setError(j.error ?? `HTTP ${res.status}`);
        setPhase('error');
        return;
      }
      setGraph(j.graph);
      if (autonomous) {
        // apply the whole graph now, using j.graph directly (state not yet flushed this tick)
        const map: Record<string, string> = {};
        for (const pn of j.graph.nodes) {
          map[pn.key] = addConfiguredNode(pn.kind, { x: pn.x, y: pn.y }, { prompt: pn.prompt, name: pn.name, entityKind: pn.entityKind, status: 'idle' });
        }
        for (const e of j.graph.edges) if (map[e.from] && map[e.to]) connectIds(map[e.from]!, map[e.to]!);
        setPhase('idle');
        setGraph(null);
      } else {
        setIndex(0);
        setDraftPrompt(j.graph.nodes[0]?.prompt ?? '');
        setPhase('stepping');
      }
    } catch (e) {
      setError(String(e).slice(0, 160));
      setPhase('error');
    }
  }

  function approve() {
    if (!graph) return;
    applyNode(graph.nodes[index]!.key, draftPrompt);
    advance();
  }
  function skip() {
    advance();
  }
  function advance() {
    if (!graph) return;
    const next = index + 1;
    if (next >= graph.nodes.length) {
      setPhase('idle');
      setGraph(null);
      return;
    }
    setIndex(next);
    setDraftPrompt(graph.nodes[next]!.prompt);
  }

  const proposal = phase === 'stepping' && graph ? graph.nodes[index] : null;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-neutral-800 bg-neutral-900/80 px-4 py-2">
        <span className="text-xs font-semibold text-sky-300">Showrun</span>
        <input
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && phase === 'idle' && showrun()}
          placeholder="Describe your film in a sentence… (the agent plans the shots)"
          data-testid="premise"
          className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-100 outline-none focus:border-neutral-600"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-400">
          <input type="checkbox" checked={autonomous} onChange={(e) => setAutonomous(e.target.checked)} data-testid="autonomous" className="accent-sky-400" />
          Fully autonomous
        </label>
        <button onClick={showrun} disabled={phase === 'planning'} data-testid="showrun" className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-sky-400 disabled:opacity-60">
          {phase === 'planning' ? 'Planning…' : 'Showrun'}
        </button>
        {error && <span className="text-[11px] text-rose-400">{error}</span>}
      </div>

      {proposal && (
        <div className="absolute bottom-6 left-1/2 z-30 w-96 -translate-x-1/2 rounded-xl border border-sky-500/40 bg-neutral-900 p-4 shadow-2xl" data-testid="proposal">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-sky-300">Step {index + 1}/{graph!.nodes.length}</span>
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">{proposal.kind}</span>
          </div>
          <p className="mb-2 text-sm text-neutral-200">{proposal.note}</p>
          {proposal.kind !== 'video' && (
            <textarea value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)} rows={3} className="mb-3 w-full resize-none rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600" />
          )}
          <div className="flex gap-2">
            <button onClick={approve} data-testid="approve-step" className="flex-1 rounded-md bg-emerald-500 py-1.5 text-xs font-semibold text-black hover:bg-emerald-400">Approve & next</button>
            <button onClick={skip} className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">Skip</button>
          </div>
        </div>
      )}
    </>
  );
}
