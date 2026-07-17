'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { listProjects, createProject, deleteProject, type ProjectMeta } from '../lib/projects';

function relativeTime(ms: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function ProjectCard({ p, onDelete }: { p: ProjectMeta; onDelete: (id: string) => void }) {
  return (
    <Link
      href={`/project/${p.id}/pipeline`}
      className="card-ring group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] transition hover:-translate-y-1"
    >
      {/* poster */}
      <div className="relative aspect-video w-full overflow-hidden bg-neutral-900">
        {p.thumbUrl?.endsWith('.mp4') ? (
          <video src={p.thumbUrl} muted playsInline preload="metadata" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
        ) : p.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.thumbUrl} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
        ) : (
          <div className="grid h-full w-full place-items-center" style={{ background: 'var(--grad-soft)' }}>
            <span className="text-3xl opacity-70">🎬</span>
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        {p.clipCount > 0 && (
          <span className="absolute bottom-2 left-2.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-neutral-200 backdrop-blur">
            🎬 {p.clipCount} {p.clipCount === 1 ? 'clip' : 'clips'}
          </span>
        )}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(p.id);
          }}
          aria-label="Delete project"
          className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-md bg-black/55 text-neutral-300 opacity-0 backdrop-blur transition hover:bg-rose-500/80 hover:text-white group-hover:opacity-100"
        >
          ✕
        </button>
      </div>
      {/* meta */}
      <div className="flex flex-1 flex-col gap-1 px-3.5 py-3">
        <h3 className="line-clamp-1 text-sm font-semibold text-neutral-100">{p.title}</h3>
        <p className="text-[11px] text-neutral-500">Edited {relativeTime(p.updatedAt)}</p>
      </div>
    </Link>
  );
}

export function ProjectsHome() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    listProjects().then(setProjects);
  }, []);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    const meta = await createProject(title);
    router.push(`/project/${meta.id}/pipeline`);
  };
  const remove = async (id: string) => {
    await deleteProject(id);
    setProjects(await listProjects());
  };

  return (
    <main className="brand-ambience min-h-screen">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#07070c]/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="brand-mark h-7 w-7 text-sm font-black">R</span>
            <span className="text-[15px] font-extrabold tracking-tight">Recut</span>
          </div>
          <Link href="/demo" className="text-xs font-medium text-neutral-400 transition hover:text-neutral-100">
            See a live example →
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6">
        {/* hero + create */}
        <section className="pt-16 pb-10">
          <p className="text-[11px] font-bold tracking-[0.18em] text-neutral-500 uppercase">Your studio</p>
          <h1 className="mt-3 max-w-2xl text-5xl leading-[1.03] font-extrabold tracking-tight text-balance">
            Every tool gives you shots.<br />
            Recut gives you a <span className="serif-em grad-text">series</span>.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] text-neutral-400">
            Cast locked references, let the director skill write the shots, generate takes, and cut the film: one
            pipeline that keeps every frame on-model.
          </p>

          <div className="mt-8 flex max-w-xl gap-2.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="Name a new film…"
              data-testid="new-project-title"
              className="glass flex-1 rounded-xl px-4 py-3 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-500 focus:border-[color:var(--c2)]"
            />
            <button
              onClick={create}
              disabled={creating}
              data-testid="create-project"
              className="btn-grad shrink-0 rounded-xl px-6 py-3 text-sm font-semibold"
            >
              {creating ? 'Opening…' : 'New project →'}
            </button>
          </div>
        </section>

        {/* gallery */}
        <section className="pb-24">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-[0.14em] text-neutral-500 uppercase">
              Your projects{projects.length > 0 ? ` · ${projects.length}` : ''}
            </h2>
          </div>

          {projects.length === 0 ? (
            <div className="glass grid place-items-center rounded-2xl px-6 py-20 text-center">
              <span className="mb-3 text-4xl opacity-60">🎬</span>
              <p className="text-sm font-medium text-neutral-300">No films yet</p>
              <p className="mt-1 max-w-xs text-xs text-neutral-500">
                Name one above to open a blank canvas, or start from a live example.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {projects.map((p) => (
                <ProjectCard key={p.id} p={p} onDelete={remove} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
