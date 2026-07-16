'use client';

import { useRef, useState } from 'react';
import { useCanvas } from '../../lib/canvas/store';
import type { PlanGraph } from '../../lib/agent/build-graph';

type Phase = 'idle' | 'planning' | 'stepping' | 'error';

export function ShowrunBar() {
  const addConfiguredNode = useCanvas((s) => s.addConfiguredNode);
  const connectIds = useCanvas((s) => s.connectIds);
  const runAll = useCanvas((s) => s.runAll);
  const runNode = useCanvas((s) => s.runNode);

  const [premise, setPremise] = useState('');
  const [autonomous, setAutonomous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<PlanGraph | null>(null);
  const [index, setIndex] = useState(0);
  const [draftPrompt, setDraftPrompt] = useState('');
  const keyToId = useRef<Record<string, string>>({});

  function applyNode(key: string, prompt: string): void {
    const g = graph!;
    const pn = g.nodes.find((n) => n.key === key)!;
    const id = addConfiguredNode(pn.kind, { x: pn.x, y: pn.y }, { prompt, name: pn.name, entityKind: pn.entityKind, styleAnchor: pn.styleAnchor, status: 'idle' });
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
        // Agent mode: build the whole graph now, then generate every node autonomously.
        const map: Record<string, string> = {};
        for (const pn of j.graph.nodes) {
          map[pn.key] = addConfiguredNode(pn.kind, { x: pn.x, y: pn.y }, { prompt: pn.prompt, name: pn.name, entityKind: pn.entityKind, styleAnchor: pn.styleAnchor, status: 'idle' });
        }
        for (const e of j.graph.edges) if (map[e.from] && map[e.to]) connectIds(map[e.from]!, map[e.to]!);
        setPhase('idle');
        setGraph(null);
        void runAll(); // fire the full generation run (budget guard applies)
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

  // human-in-the-loop: confirm/edit this step's prompt → add it → GENERATE it → next.
  async function approve() {
    if (!graph || busy) return;
    const key = graph.nodes[index]!.key;
    applyNode(key, draftPrompt);
    const id = keyToId.current[key];
    if (id) {
      setBusy(true);
      await runNode(id);
      setBusy(false);
    }
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
      <div className="flex items-center gap-2 border-b border-white/8 bg-[#0b0a11]/80 px-4 py-2 backdrop-blur">
        <span className="grad-text text-xs font-bold tracking-tight">Showrun</span>
        <input
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && phase === 'idle' && showrun()}
          placeholder="Describe your film in a sentence… (the agent plans the shots)"
          data-testid="premise"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-neutral-100 outline-none transition placeholder:text-neutral-500 focus:border-[color:var(--c2)]"
        />
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-400" title="Off = agent asks you to confirm/edit every step. On = it builds AND generates the whole film without stopping.">
          <input type="checkbox" checked={autonomous} onChange={(e) => setAutonomous(e.target.checked)} data-testid="autonomous" className="accent-[#ff3d8b]" />
          ⚡ Fully autonomous
        </label>
        <button onClick={showrun} disabled={phase === 'planning'} data-testid="showrun" className="btn-grad rounded-lg px-3.5 py-1.5 text-xs font-semibold disabled:opacity-60">
          {phase === 'planning' ? 'Planning…' : 'Showrun'}
        </button>
        {error && <span className="text-[11px] text-rose-400">{error}</span>}
      </div>

      {proposal && (
        <div className="absolute bottom-6 left-1/2 z-30 w-96 -translate-x-1/2 rounded-2xl border border-white/12 bg-[#0e0d15]/95 p-4 shadow-2xl backdrop-blur" data-testid="proposal">
          <div className="mb-2 flex items-center justify-between">
            <span className="grad-text text-xs font-bold">Step {index + 1}/{graph!.nodes.length}</span>
            <span className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-neutral-400">{proposal.kind}</span>
          </div>
          <p className="mb-2 text-sm text-neutral-200">{proposal.note}</p>
          <div className="mb-1 text-[10px] font-medium tracking-wide text-neutral-500 uppercase">Prompt — edit before generating</div>
          <textarea value={draftPrompt} onChange={(e) => setDraftPrompt(e.target.value)} rows={3} className="mb-3 w-full resize-none rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-[color:var(--c2)]" />
          <div className="flex gap-2">
            <button onClick={approve} disabled={busy} data-testid="approve-step" className="btn-grad flex-1 rounded-lg py-1.5 text-xs font-semibold disabled:opacity-60">
              {busy ? 'Generating…' : 'Approve & generate →'}
            </button>
            <button onClick={skip} disabled={busy} className="rounded-lg border border-white/12 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5 disabled:opacity-40">Skip</button>
          </div>
        </div>
      )}
    </>
  );
}
