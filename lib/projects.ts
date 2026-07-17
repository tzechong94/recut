// Client project API — talks to the server store (durable + shareable). Replaces localStorage.

export interface ProjectMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  clipCount: number;
  thumbUrl: string | null;
  demoHidden?: boolean;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) return [];
  return ((await res.json()) as { projects: ProjectMeta[] }).projects;
}

export async function getProject(id: string): Promise<{ id: string; title: string; createdAt: number } | undefined> {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) return undefined;
  const p = (await res.json()) as { id: string; title: string; createdAt: number };
  return { id: p.id, title: p.title, createdAt: p.createdAt };
}

export async function createProject(title: string): Promise<ProjectMeta> {
  const res = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
  return (await res.json()) as ProjectMeta;
}

export async function deleteProject(id: string): Promise<void> {
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
}

export async function loadGraph(id: string): Promise<{ nodes: unknown[]; edges: unknown[] } | null> {
  const res = await fetch(`/api/projects/${id}`);
  if (!res.ok) return null;
  const p = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
  return { nodes: p.nodes ?? [], edges: p.edges ?? [] };
}

export async function saveGraph(id: string, nodes: unknown[], edges: unknown[]): Promise<void> {
  await fetch(`/api/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes, edges }) });
}
