'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { listProjects, createProject, deleteProject, type ProjectMeta } from '../lib/projects';

export function ProjectsHome() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [title, setTitle] = useState('');

  useEffect(() => setProjects(listProjects()), []);

  const create = () => {
    const meta = createProject(title, Date.now());
    router.push(`/project/${meta.id}`);
  };
  const remove = (id: string) => {
    deleteProject(id);
    setProjects(listProjects());
  };

  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <p className="text-sm font-medium tracking-widest text-neutral-500 uppercase">Recut</p>
      <h1 className="mt-2 text-4xl font-semibold text-balance">Every other tool gives you shots. Recut gives you a series.</h1>
      <p className="mt-3 max-w-xl text-neutral-400">
        A node canvas for AI film: generate, upload, edit, and animate — wire outputs into inputs,
        with a Series Bible and a continuity critic keeping every shot on-model.
      </p>

      <div className="mt-8 flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
          placeholder="New project name…"
          data-testid="new-project-title"
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-2.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
        />
        <button
          onClick={create}
          data-testid="create-project"
          className="rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-sky-400"
        >
          New project →
        </button>
      </div>

      <div className="mt-8">
        <h2 className="mb-3 text-xs font-semibold tracking-widest text-neutral-500 uppercase">Your projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-neutral-600">No projects yet. Name one above to open a blank canvas.</p>
        ) : (
          <ul className="divide-y divide-neutral-900 rounded-xl border border-neutral-800">
            {projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-3">
                <Link href={`/project/${p.id}`} className="text-sm font-medium text-neutral-200 hover:text-sky-300">
                  {p.title}
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] tabular-nums text-neutral-600">{p.id}</span>
                  <button onClick={() => remove(p.id)} className="text-[11px] text-neutral-600 hover:text-rose-400">delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-10 text-xs text-neutral-700">
        Prefer the guided tour? <Link href="/demo" className="underline hover:text-neutral-400">Open the curated demo →</Link>
      </p>
    </main>
  );
}
