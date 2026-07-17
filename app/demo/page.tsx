'use client';

// The judge demo index: pick a film, step through how the agent made it.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listProjects, type ProjectMeta } from '../../lib/projects';

export default function DemoIndex() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  useEffect(() => {
    listProjects().then((ps) => setProjects(ps.filter((p) => p.clipCount > 0)));
  }, []);

  return (
    <main className="brand-ambience min-h-screen">
      <header className="border-b border-white/8 px-6 py-3.5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="brand-mark h-7 w-7 text-sm font-black">R</span>
          <span className="text-[15px] font-extrabold tracking-tight">Recut</span>
          <span className="text-xs text-neutral-500">/ demos</span>
        </Link>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-16">
        <p className="text-[11px] font-bold tracking-[0.18em] text-neutral-500 uppercase">Judge demos</p>
        <h1 className="mt-3 text-5xl leading-[1.03] font-extrabold tracking-tight">
          Watch the agent make a <span className="serif-em grad-text">film</span>.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] text-neutral-400">
          Each demo opens the REAL product on a real project with a guided tour: popups point at the actual controls
          while you step through cast → script → shots → the cut.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="demo-list">
          {projects.map((p) => (
            <Link key={p.id} href={`/project/${p.id}/pipeline?tour=1`} className="card-ring group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] transition hover:-translate-y-1" data-testid={`demo-${p.id}`}>
              <div className="relative aspect-video w-full overflow-hidden bg-neutral-900">
                {p.thumbUrl?.endsWith('.mp4') ? (
                  <video src={p.thumbUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
                <div className="absolute inset-0 grid place-items-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                  <span className="rounded-full bg-white/90 px-4 py-2 text-sm font-bold text-black">▶ Step through</span>
                </div>
              </div>
              <div className="px-3.5 py-3">
                <h3 className="line-clamp-1 text-sm font-semibold text-neutral-100">{p.title}</h3>
                <p className="text-[11px] text-neutral-500">🎬 {p.clipCount} clips</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
