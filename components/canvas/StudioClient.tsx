'use client';

import '@xyflow/react/dist/style.css';
import { useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, type Node, type Edge, type NodeProps } from '@xyflow/react';
import type { Project } from '../../lib/domain/types';
import { editEntity, staleTakeIds } from '../../lib/bible/version';

type ShotData = { title: string; capability: string; cost: number; thumb: string | null; stale: boolean; seed: number | null };
type EntityData = { name: string; kind: string; thumb: string; version: number; wardrobe: string; dot: string };

function EntityNode({ data }: NodeProps) {
  const d = data as unknown as EntityData;
  return (
    <div className="w-56 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-lg">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-fuchsia-300 uppercase">{d.kind}</span>
        <span className="text-[10px] tabular-nums text-neutral-500">bible v{d.version}</span>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={d.thumb} alt={d.name} className="h-32 w-full object-cover" />
      <div className="space-y-1 px-3 py-2">
        <div className="text-sm font-semibold text-neutral-100">{d.name}</div>
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: d.dot }} />
          {d.wardrobe}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-fuchsia-400" />
    </div>
  );
}

function ShotNode({ data }: NodeProps) {
  const d = data as unknown as ShotData;
  const status = d.stale ? 'stale' : 'accepted';
  const statusCls = d.stale ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40' : 'bg-emerald-500/15 text-emerald-300';
  return (
    <div className={`w-60 overflow-hidden rounded-lg border bg-neutral-900 shadow-lg ${d.stale ? 'border-amber-500/60' : 'border-neutral-700'}`}>
      <Handle type="target" position={Position.Left} className="!bg-sky-400" />
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">{d.capability}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusCls}`} data-testid="shot-status">{status}</span>
      </div>
      {d.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.thumb} alt="take" className={`h-32 w-full object-cover ${d.stale ? 'opacity-60 saturate-50' : ''}`} />
      ) : (
        <div className="flex h-32 items-center justify-center text-xs text-neutral-600">no take</div>
      )}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-medium text-neutral-200">{d.title}</span>
        <span className="text-[11px] tabular-nums text-neutral-500">${d.cost.toFixed(2)}</span>
      </div>
    </div>
  );
}

const nodeTypes = { entity: EntityNode, shot: ShotNode };

export function StudioClient({ initialProject }: { initialProject: Project }) {
  const [project, setProject] = useState(initialProject);
  const [scarf, setScarf] = useState('red');

  const stale = useMemo(() => new Set(staleTakeIds(project)), [project]);
  const entity = project.bible.entities[0]!;

  const nodes: Node[] = useMemo(() => {
    const entityNode: Node = {
      id: `entity-${entity.id}`,
      type: 'entity',
      position: { x: 40, y: 120 },
      data: { name: entity.name, kind: entity.kind, thumb: '/refs/mei.png', version: project.bible.version, wardrobe: entity.attributes.wardrobe ?? '', dot: scarf } satisfies EntityData as unknown as Record<string, unknown>,
    };
    const shotNodes: Node[] = project.shots.map((shot, i) => {
      const accepted = project.takes.find((t) => t.shotId === shot.id && t.accepted) ?? project.takes.find((t) => t.shotId === shot.id);
      const isStale = accepted ? stale.has(accepted.id) : false;
      return {
        id: `shot-${shot.id}`,
        type: 'shot',
        position: { x: 400, y: 40 + i * 220 },
        data: {
          title: shot.action.length > 28 ? shot.action.slice(0, 28) + '…' : shot.action,
          capability: 'image.edit',
          cost: accepted?.provenance.costUsd ?? 0,
          thumb: accepted?.assetUrl ?? null,
          stale: isStale,
          seed: accepted?.provenance.seed ?? null,
        } satisfies ShotData as unknown as Record<string, unknown>,
      };
    });
    return [entityNode, ...shotNodes];
  }, [project, stale, entity, scarf]);

  const edges: Edge[] = useMemo(
    () =>
      project.shots
        .filter((s) => s.entityIds.includes(entity.id))
        .map((s) => ({ id: `e-${s.id}`, source: `entity-${entity.id}`, target: `shot-${s.id}`, animated: true, style: { stroke: '#a855f7' } })),
    [project, entity],
  );

  function changeScarf(colour: string) {
    setScarf(colour);
    setProject((p) => ({ ...p, bible: editEntity(p.bible, entity.id, { attributes: { wardrobe: `${colour} wool scarf, charcoal jacket` } }) }));
  }

  const staleCount = stale.size;

  return (
    <div className="flex h-full">
      <aside className="w-80 shrink-0 overflow-y-auto border-r border-neutral-900 bg-neutral-950 p-5">
        <h1 className="text-sm font-semibold tracking-wide text-neutral-100">Series Bible</h1>
        <p className="mt-1 text-xs text-neutral-500">Edit an entity → every take that used it flags stale, instantly.</p>

        <div className="mt-5 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/refs/mei.png" alt="Mei" className="h-40 w-full object-cover" />
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-neutral-100">{entity.name}</span>
              <span className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-300">{entity.kind}</span>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium tracking-wide text-neutral-500 uppercase">Wardrobe · scarf colour</div>
              <div className="flex gap-2">
                {['red', 'blue', 'green'].map((c) => (
                  <button
                    key={c}
                    data-testid={`scarf-${c}`}
                    onClick={() => changeScarf(c)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium capitalize transition ${scarf === c ? 'border-sky-400 bg-sky-500/15 text-sky-200' : 'border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-neutral-800 pt-3 text-xs">
              <span className="text-neutral-500">Bible version</span>
              <span className="tabular-nums text-neutral-200" data-testid="bible-version">v{project.bible.version}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-neutral-500">Stale takes</span>
              <span className={`tabular-nums ${staleCount ? 'text-amber-300' : 'text-neutral-200'}`} data-testid="stale-count">{staleCount}</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }} colorMode="dark">
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
