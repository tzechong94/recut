'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useCanvas, type RecutNodeData, type RecutNodeKind, type CanonKind, CONSUMES, PRODUCES_IMAGE } from '../../lib/canvas/store';
import { TTS_VOICES } from '../../manifests/qwen-tts';

const ACCENT: Record<RecutNodeKind, string> = {
  text2image: 'text-emerald-300',
  upload: 'text-neutral-300',
  edit: 'text-sky-300',
  compose: 'text-cyan-300',
  inpaint: 'text-teal-300',
  video: 'text-violet-300',
  critique: 'text-amber-300',
  dialogue: 'text-pink-300',
  canon: 'text-fuchsia-300',
};

const CANON_KINDS: CanonKind[] = ['character', 'location', 'prop', 'style'];

const STATUS_CLS: Record<RecutNodeData['status'], string> = {
  idle: 'bg-neutral-800 text-neutral-400',
  running: 'bg-[#ff3d8b]/20 text-[#ff9ac4] animate-pulse',
  done: 'bg-emerald-500/15 text-emerald-300',
  error: 'bg-rose-500/20 text-rose-300',
};

const PROMPT_PLACEHOLDER: Partial<Record<RecutNodeKind, string>> = {
  text2image: 'describe the image…',
  edit: 'how to edit the incoming image…',
  compose: 'how to combine the connected images…',
  inpaint: 'what to change in the region…',
  video: 'motion hint (optional): slow drift, push-in…',
  critique: 'shot intent (optional)…',
  dialogue: 'the spoken line…',
};

function runLabel(kind: RecutNodeKind, status: RecutNodeData['status']): string {
  if (status === 'running') return kind === 'video' ? 'Rendering video… ~1–2 min' : kind === 'dialogue' ? 'Synthesizing…' : 'Generating…';
  if (kind === 'critique') return 'Score';
  if (kind === 'video') return 'Animate (i2v)';
  if (kind === 'dialogue') return 'Speak';
  if (kind === 'compose') return 'Compose';
  return 'Generate';
}

export function RecutNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as RecutNodeData;
  const updateNode = useCanvas((s) => s.updateNode);
  const runNode = useCanvas((s) => s.runNode);
  const setCanonRef = useCanvas((s) => s.setCanonRef);
  const repairFrom = useCanvas((s) => s.repairFrom);

  const onUpload = (file: File, asCanon = false) => {
    const reader = new FileReader();
    reader.onload = () => (asCanon ? setCanonRef(id, String(reader.result)) : updateNode(id, { imageUrl: String(reader.result), status: 'done' }));
    reader.readAsDataURL(file);
  };

  const showsPrompt = !d.demo && d.kind !== 'upload' && d.kind !== 'canon';
  const producesSource = PRODUCES_IMAGE.includes(d.kind) || d.kind === 'video';
  const borderCls = selected ? 'border-[#ff3d8b] ring-2 ring-[#ff3d8b]/35' : d.stale ? 'border-amber-500/60' : d.kind === 'canon' ? 'border-fuchsia-500/40' : 'border-white/12';

  return (
    <div className={`w-64 overflow-hidden rounded-xl border bg-[#0e0d15] shadow-xl shadow-black/40 ${borderCls}`}>
      {CONSUMES.includes(d.kind) && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-sky-400" />}

      <header className="flex items-center justify-between border-b border-white/8 px-3 py-2">
        <span className={`flex items-center gap-1 text-xs font-semibold ${ACCENT[d.kind]}`}>
          {d.kind === 'canon' && <span title="locked reference">🔒</span>}
          {d.kind === 'canon' ? d.name || 'Canon' : d.title}
        </span>
        {d.stale ? (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">stale</span>
        ) : (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLS[d.status]}`}>{d.status}</span>
        )}
      </header>

      {/* nodrag: interacting with the controls (esp. native <select>) must never start a node
          drag; nowheel: scrolling a textarea shouldn't zoom the canvas. Drag from the header. */}
      <div className="nodrag nowheel space-y-2 p-3">
        {/* output preview */}
        {d.videoUrl ? (
          <video src={d.videoUrl} autoPlay muted loop playsInline controls className="h-32 w-full rounded bg-black object-cover" />
        ) : d.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.imageUrl} alt="output" className="h-32 w-full rounded object-cover" />
        ) : d.audioUrl ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded bg-neutral-950 px-3">
            <span className="text-2xl">🔊</span>
            <audio src={d.audioUrl} controls className="w-full" />
          </div>
        ) : d.kind === 'critique' && typeof d.score === 'number' ? (
          <div className="flex h-32 flex-col items-center justify-center rounded bg-neutral-950">
            <div className={`text-3xl font-bold tabular-nums ${d.score >= 0.7 ? 'text-emerald-300' : d.score >= 0.5 ? 'text-amber-300' : 'text-rose-300'}`}>{d.score.toFixed(2)}</div>
            <div className="text-[10px] text-neutral-500">continuity score</div>
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center rounded border border-dashed border-neutral-800 text-[11px] text-neutral-600">
            {d.kind === 'upload' ? 'upload an image ↓' : d.kind === 'canon' ? 'lock a reference ↓' : d.kind === 'compose' ? 'connect 2+ images' : 'no output yet'}
          </div>
        )}

        {/* controls */}
        {d.demo ? (
          d.prompt ? (
            <p className="line-clamp-3 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-neutral-400">{d.prompt}</p>
          ) : null
        ) : d.kind === 'canon' ? (
          <>
            <input
              value={d.name ?? ''}
              onChange={(e) => updateNode(id, { name: e.target.value })}
              placeholder="entity name"
              className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600"
            />
            <select
              value={d.entityKind ?? 'character'}
              onChange={(e) => updateNode(id, { entityKind: e.target.value as CanonKind })}
              className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-300 outline-none"
            >
              {CANON_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <label className="block cursor-pointer rounded-md border border-fuchsia-700/50 px-3 py-1.5 text-center text-xs text-fuchsia-200 hover:bg-fuchsia-950/30">
              {d.imageUrl ? 'Replace reference' : 'Lock reference'}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0], true)} />
            </label>
          </>
        ) : d.kind === 'upload' ? (
          <label className="block cursor-pointer rounded-md border border-neutral-700 px-3 py-1.5 text-center text-xs text-neutral-300 hover:bg-neutral-800">
            Choose image
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          </label>
        ) : (
          <>
            {showsPrompt && (
              <textarea
                value={d.prompt}
                onChange={(e) => updateNode(id, { prompt: e.target.value })}
                placeholder={PROMPT_PLACEHOLDER[d.kind]}
                rows={2}
                className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600"
              />
            )}
            {d.kind === 'dialogue' && (
              <select
                value={d.voice ?? 'Cherry'}
                onChange={(e) => updateNode(id, { voice: e.target.value })}
                className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-300 outline-none"
              >
                {TTS_VOICES.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            )}
            <button
              onClick={() => runNode(id)}
              disabled={d.status === 'running'}
              className="btn-grad w-full rounded-md py-1.5 text-xs font-semibold disabled:opacity-60"
            >
              {runLabel(d.kind, d.status)}
            </button>
          </>
        )}

        {!d.demo && d.kind === 'critique' && typeof d.score === 'number' && d.score < 0.7 && d.repairInstruction && (
          <button
            onClick={() => repairFrom(id)}
            data-testid="auto-repair"
            className="w-full rounded-md border border-amber-600/50 bg-amber-950/30 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-950/60"
          >
            ↻ Auto-repair
          </button>
        )}

        {d.error && <p className="text-[10px] text-rose-400">{d.error}</p>}
      </div>

      {producesSource && <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-emerald-400" />}
    </div>
  );
}
