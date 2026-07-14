'use client';

import { useEffect, useRef, useState } from 'react';
import { useCanvas, type RecutNodeKind } from '../../lib/canvas/store';

const GROUPS: Array<{ label: string; items: Array<{ kind: RecutNodeKind; name: string; desc: string; icon: string }> }> = [
  {
    label: 'Reference',
    items: [{ kind: 'canon', name: 'Canon', desc: 'Lock a character / style / prop to reuse across shots', icon: '🔒' }],
  },
  {
    label: 'Create an image',
    items: [
      { kind: 'text2image', name: 'Text → Image', desc: 'Describe an image and generate it', icon: '🎨' },
      { kind: 'upload', name: 'Upload', desc: 'Bring in your own image', icon: '⬆️' },
    ],
  },
  {
    label: 'Change an image',
    items: [
      { kind: 'edit', name: 'Edit', desc: 'Change a connected image with a prompt', icon: '✏️' },
      { kind: 'compose', name: 'Compose', desc: 'Merge 2+ connected images into one', icon: '🧩' },
      { kind: 'inpaint', name: 'Inpaint', desc: 'Change just one region of an image', icon: '🖌️' },
    ],
  },
  {
    label: 'Bring it to life',
    items: [
      { kind: 'video', name: 'Image → Video', desc: 'Animate a connected image (i2v)', icon: '🎬' },
      { kind: 'dialogue', name: 'Dialogue', desc: 'Turn a line of text into a spoken voice', icon: '🔊' },
    ],
  },
  {
    label: 'Keep it on-model',
    items: [{ kind: 'critique', name: 'Continuity', desc: 'Score how on-model a shot is vs. your Canon', icon: '✅' }],
  },
];

export function AddNodeMenu() {
  const addNode = useCanvas((s) => s.addNode);
  const count = useCanvas((s) => s.nodes.length);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const add = (kind: RecutNodeKind) => {
    addNode(kind, { x: 180 + (count % 6) * 44, y: 120 + (count % 6) * 44 });
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="add-node"
        className="flex items-center gap-1.5 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-sky-400"
      >
        ＋ Add node <span className="text-[9px] opacity-70">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-40 mt-1 w-72 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
          {GROUPS.map((g) => (
            <div key={g.label} className="border-b border-neutral-800 last:border-0">
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">{g.label}</div>
              {g.items.map((it) => (
                <button
                  key={it.kind}
                  onClick={() => add(it.kind)}
                  data-testid={`add-${it.kind}`}
                  className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-neutral-800"
                >
                  <span className="mt-0.5 text-sm">{it.icon}</span>
                  <span>
                    <span className="block text-xs font-medium text-neutral-100">{it.name}</span>
                    <span className="block text-[11px] leading-tight text-neutral-500">{it.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
