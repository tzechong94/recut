'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useCanvas, type RecutNodeData, type RecutNodeKind } from '../../lib/canvas/store';

const ACCENT: Record<RecutNodeKind, string> = {
  text2image: 'text-emerald-300',
  upload: 'text-neutral-300',
  edit: 'text-sky-300',
  video: 'text-violet-300',
  critique: 'text-amber-300',
};

const STATUS_CLS: Record<RecutNodeData['status'], string> = {
  idle: 'bg-neutral-800 text-neutral-400',
  running: 'bg-sky-500/20 text-sky-300 animate-pulse',
  done: 'bg-emerald-500/15 text-emerald-300',
  error: 'bg-rose-500/20 text-rose-300',
};

const CONSUMES: RecutNodeKind[] = ['edit', 'video', 'critique'];
const PRODUCES_IMAGE: RecutNodeKind[] = ['text2image', 'upload', 'edit'];

export function RecutNode({ id, data }: NodeProps) {
  const d = data as unknown as RecutNodeData;
  const updateNode = useCanvas((s) => s.updateNode);
  const runNode = useCanvas((s) => s.runNode);

  const onUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => updateNode(id, { imageUrl: String(reader.result), status: 'done' });
    reader.readAsDataURL(file);
  };

  return (
    <div className="w-64 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-900 shadow-xl">
      {CONSUMES.includes(d.kind) && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-sky-400" />}

      <header className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className={`text-xs font-semibold ${ACCENT[d.kind]}`}>{d.title}</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLS[d.status]}`}>{d.status}</span>
      </header>

      <div className="space-y-2 p-3">
        {/* output preview */}
        {d.videoUrl ? (
          <video src={d.videoUrl} autoPlay muted loop playsInline controls className="h-32 w-full rounded bg-black object-cover" />
        ) : d.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.imageUrl} alt="output" className="h-32 w-full rounded object-cover" />
        ) : d.kind === 'critique' && typeof d.score === 'number' ? (
          <div className="flex h-32 flex-col items-center justify-center rounded bg-neutral-950">
            <div className={`text-3xl font-bold tabular-nums ${d.score >= 0.7 ? 'text-emerald-300' : d.score >= 0.5 ? 'text-amber-300' : 'text-rose-300'}`}>{d.score.toFixed(2)}</div>
            <div className="text-[10px] text-neutral-500">continuity score</div>
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center rounded border border-dashed border-neutral-800 text-[11px] text-neutral-600">
            {d.kind === 'upload' ? 'upload an image ↓' : 'no output yet'}
          </div>
        )}

        {/* controls by kind */}
        {d.kind === 'upload' ? (
          <label className="block cursor-pointer rounded-md border border-neutral-700 px-3 py-1.5 text-center text-xs text-neutral-300 hover:bg-neutral-800">
            Choose image
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          </label>
        ) : (
          <>
            {(d.kind === 'text2image' || d.kind === 'edit') && (
              <textarea
                value={d.prompt}
                onChange={(e) => updateNode(id, { prompt: e.target.value })}
                placeholder={d.kind === 'edit' ? 'how to edit the incoming image…' : 'describe the image…'}
                rows={2}
                className="w-full resize-none rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 outline-none focus:border-neutral-600"
              />
            )}
            <button
              onClick={() => runNode(id)}
              disabled={d.status === 'running'}
              className="w-full rounded-md bg-sky-500 py-1.5 text-xs font-semibold text-black hover:bg-sky-400 disabled:opacity-60"
            >
              {d.status === 'running' ? 'Generating…' : d.kind === 'critique' ? 'Score' : d.kind === 'video' ? 'Animate' : 'Generate'}
            </button>
          </>
        )}

        {d.error && <p className="text-[10px] text-rose-400">{d.error}</p>}
      </div>

      {(PRODUCES_IMAGE.includes(d.kind) || d.kind === 'video') && (
        <Handle type="source" position={Position.Right} className="!h-3 !w-3 !bg-emerald-400" />
      )}
    </div>
  );
}
