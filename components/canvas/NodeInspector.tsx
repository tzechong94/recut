'use client';

import { useCanvas, KIND_CAPABILITY, PRODUCES_IMAGE, type RecutNodeData } from '../../lib/canvas/store';
import { selectModel } from '../../lib/gateway/router';
import { TTS_VOICES } from '../../manifests/qwen-tts';

function resolvedModel(cap: string): string {
  try {
    return selectModel(cap as never).id;
  } catch {
    return '—';
  }
}

export function NodeInspector({ nodeId, onDelete, onDuplicate }: { nodeId: string; onDelete: () => void; onDuplicate: () => void }) {
  const node = useCanvas((s) => s.nodes.find((n) => n.id === nodeId));
  const updateNode = useCanvas((s) => s.updateNode);
  if (!node) return null;
  const d = node.data as RecutNodeData;
  if (d.demo) return null;

  const isImage = PRODUCES_IMAGE.includes(d.kind);
  const output = d.imageUrl ?? d.videoUrl ?? d.audioUrl;

  return (
    <aside className="h-full w-72 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-4 text-sm" data-testid="node-inspector">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-widest text-neutral-500 uppercase">{d.title}</h2>
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">{KIND_CAPABILITY[d.kind]}</span>
      </div>

      <div className="space-y-3">
        <Field label="Model">
          <span className="font-mono text-[11px] text-neutral-400">{resolvedModel(KIND_CAPABILITY[d.kind])}</span>
        </Field>

        {d.kind !== 'upload' && (
          <div>
            <Label>Prompt</Label>
            <textarea value={d.prompt} onChange={(e) => updateNode(nodeId, { prompt: e.target.value })} rows={3} className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600" />
          </div>
        )}

        {isImage && (
          <>
            <div>
              <Label>Negative</Label>
              <input value={d.negative ?? ''} onChange={(e) => updateNode(nodeId, { negative: e.target.value })} placeholder="things to avoid" className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <Label>Seed</Label>
                <input type="number" value={d.seed ?? ''} onChange={(e) => updateNode(nodeId, { seed: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="random" className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs tabular-nums text-neutral-200 outline-none focus:border-neutral-600" />
              </div>
              <div className="flex-1">
                <Label>Aspect</Label>
                <select value={d.aspect ?? '1:1'} onChange={(e) => updateNode(nodeId, { aspect: e.target.value as RecutNodeData['aspect'] })} className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none">
                  <option value="1:1">1:1</option>
                  <option value="9:16">9:16</option>
                  <option value="16:9">16:9</option>
                </select>
              </div>
            </div>
          </>
        )}

        {d.kind === 'dialogue' && (
          <div>
            <Label>Voice</Label>
            <select value={d.voice ?? 'Cherry'} onChange={(e) => updateNode(nodeId, { voice: e.target.value })} className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none">
              {TTS_VOICES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
        )}

        {output && (
          <Field label="Output">
            <a href={output} download className="text-[11px] text-sky-300 hover:underline">download</a>
          </Field>
        )}
        {d.error && <p className="rounded-md bg-rose-950/50 px-2 py-1.5 text-[11px] text-rose-300">{d.error}</p>}

        <div className="flex gap-2 border-t border-neutral-800 pt-3">
          <button onClick={onDuplicate} className="flex-1 rounded-md border border-neutral-700 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800">Duplicate</button>
          <button onClick={onDelete} className="flex-1 rounded-md border border-rose-900 py-1.5 text-xs text-rose-300 hover:bg-rose-950/50">Delete</button>
        </div>
      </div>
    </aside>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] font-medium tracking-wide text-neutral-500 uppercase">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-medium tracking-wide text-neutral-500 uppercase">{label}</span>
      {children}
    </div>
  );
}
