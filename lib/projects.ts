// Client-side project registry (localStorage). Each project owns a canvas graph stored under
// recut:project:<id> by the canvas store.

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: number;
}

const KEY = 'recut:projects';

export function listProjects(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ProjectMeta[]).sort((a, b) => b.createdAt - a.createdAt) : [];
  } catch {
    return [];
  }
}

export function getProject(id: string): ProjectMeta | undefined {
  return listProjects().find((p) => p.id === id);
}

export function createProject(title: string, now: number): ProjectMeta {
  const meta: ProjectMeta = { id: crypto.randomUUID().slice(0, 8), title: title.trim() || 'Untitled project', createdAt: now };
  const all = [meta, ...listProjects()];
  localStorage.setItem(KEY, JSON.stringify(all));
  return meta;
}

export function deleteProject(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(listProjects().filter((p) => p.id !== id)));
  localStorage.removeItem(`recut:project:${id}`);
}
