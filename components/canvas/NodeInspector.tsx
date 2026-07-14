'use client';

import { useCanvas, KIND_CAPABILITY, PRODUCES_IMAGE, effectivePrompt, type RecutNodeData } from '../../lib/canvas/store';
import { selectModel } from '../../lib/gateway/router';
import { TTS_VOICES } from '../../manifests/qwen-tts';

function resolvedModel(cap: string): string {
  try {
    return selectModel(cap as never).id;
  } catch {
    return '—';
  }
}

// Cinematography presets (the camera/lighting/lens vocabulary) — appended to the prompt.
const SHOT = ['', 'extreme close-up', 'close-up', 'medium close-up', 'medium shot', 'wide shot', 'extreme wide shot'];
const ANGLE = ['', 'low angle', 'eye level', 'high angle', 'overhead', 'three-quarter view', 'profile view'];
const LENS = ['', '24mm wide-angle lens', '35mm lens', '50mm lens', '85mm portrait lens', '135mm telephoto lens'];
const LIGHT = ['', 'Rembrandt lighting', 'split lighting', 'butterfly lighting', 'loop lighting', 'high-key soft light', 'low-key dramatic light', 'natural window light', 'golden hour'];

const USES_CINE = ['text2image', 'edit', 'compose', 'inpaint', 'video'];

export function NodeInspector({ nodeId, onDelete, onDuplicate }: { nodeId: string; onDelete: () => void; onDuplicate: () => void }) {
  const node = useCanvas((s) => s.nodes.find((n) => n.id === nodeId));
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const updateNode = useCanvas((s) => s.updateNode);
  if (!node) return null;
  const d = node.data as RecutNodeData;
  if (d.demo) return null;

  const isImage = PRODUCES_IMAGE.includes(d.kind);
  const output = d.imageUrl ?? d.videoUrl ?? d.audioUrl;
  const inputs = edges
    .filter((e) => e.target === nodeId)
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is NonNullable<typeof n> => Boolean(n?.data.imageUrl));

  const set = (patch: Partial<RecutNodeData>) => updateNode(nodeId, patch);

  return (
    <aside className="h-full w-72 shrink-0 overflow-y-auto border-l border-neutral-800 bg-neutral-950 p-4 text-sm" data-testid="node-inspector">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-widest text-neutral-500 uppercase">{d.kind === 'canon' ? d.name || 'Canon' : d.title}</h2>
        <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">{KIND_CAPABILITY[d.kind]}</span>
      </div>

      <div className="space-y-3.5">
        <Field label="Model">
          <span className="font-mono text-[11px] text-neutral-400">{resolvedModel(KIND_CAPABILITY[d.kind])}</span>
        </Field>

        {/* Inputs — what's wired into this node */}
        {inputs.length > 0 && (
          <div>
            <Label>Input{inputs.length > 1 ? 's' : ''} ({inputs.length})</Label>
            <div className="flex gap-1.5">
              {inputs.map((n) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={n.id} src={n.data.imageUrl} alt="input" title={n.data.title} className="h-12 w-16 rounded border border-neutral-800 object-cover" />
              ))}
            </div>
          </div>
        )}

        {d.kind !== 'upload' && d.kind !== 'canon' && (
          <div>
            <Label>Prompt</Label>
            <textarea value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} rows={3} className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600" />
          </div>
        )}

        {/* Cinematography presets */}
        {USES_CINE.includes(d.kind) && (
          <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-2.5">
            <div className="mb-2 text-[10px] font-semibold tracking-wide text-sky-300 uppercase">🎬 Camera &amp; light</div>
            <div className="grid grid-cols-2 gap-2">
              <Preset label="Shot size" value={d.shotSize ?? ''} options={SHOT} onChange={(v) => set({ shotSize: v })} />
              <Preset label="Angle" value={d.angle ?? ''} options={ANGLE} onChange={(v) => set({ angle: v })} />
              <Preset label="Lens" value={d.lens ?? ''} options={LENS} onChange={(v) => set({ lens: v })} />
              <Preset label="Lighting" value={d.lighting ?? ''} options={LIGHT} onChange={(v) => set({ lighting: v })} />
            </div>
            {(d.shotSize || d.angle || d.lens || d.lighting) && (
              <p className="mt-2 rounded bg-neutral-950 px-2 py-1.5 font-mono text-[10px] leading-tight text-neutral-500">→ {effectivePrompt(d)}</p>
            )}
          </div>
        )}

        {isImage && d.kind !== 'canon' && (
          <div className="flex gap-3">
            <div className="flex-1">
              <Label>Seed</Label>
              <input type="number" value={d.seed ?? ''} onChange={(e) => set({ seed: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="random" className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs tabular-nums text-neutral-200 outline-none focus:border-neutral-600" />
            </div>
            <div className="flex-1">
              <Label>Aspect</Label>
              <select value={d.aspect ?? '1:1'} onChange={(e) => set({ aspect: e.target.value as RecutNodeData['aspect'] })} className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none">
                <option value="1:1">1:1</option>
                <option value="9:16">9:16</option>
                <option value="16:9">16:9</option>
              </select>
            </div>
          </div>
        )}

        {isImage && d.kind !== 'canon' && (
          <div>
            <Label>Negative</Label>
            <input value={d.negative ?? ''} onChange={(e) => set({ negative: e.target.value })} placeholder="things to avoid" className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600" />
          </div>
        )}

        {d.kind === 'dialogue' && (
          <div>
            <Label>Voice</Label>
            <select value={d.voice ?? 'Cherry'} onChange={(e) => set({ voice: e.target.value })} className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 outline-none">
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

function Preset({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] text-neutral-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-neutral-800 bg-neutral-950 px-1.5 py-1 text-[11px] text-neutral-200 outline-none">
        {options.map((o) => (
          <option key={o} value={o}>{o === '' ? '—' : o}</option>
        ))}
      </select>
    </label>
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
